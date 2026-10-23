-- Append-only ledger (I2, I3, I4) and nightly reconciliation (I5). Mirrors LedgerJournal in @app/ledger.
--
-- Nobody inserts ledger rows directly: they are derived, at commit, from the stored state.
-- A counted expense contributes the postings of its `posted_version` lines; a confirmed
-- settlement contributes +amount for the payer and -amount for the receiver. When that changes
-- (edit, delete, restore, confirm, void) the previous batch is reversed and a new one posted, in
-- the same transaction. Positive balance = the member gets money back.

create type app.ledger_source as enum ('expense', 'settlement');
create type app.ledger_direction as enum ('post', 'reverse');

create table app.ledger_batches (
  id bigint generated always as identity primary key,
  group_id uuid not null references app.groups (id),
  source_type app.ledger_source not null,
  source_id uuid not null,
  source_version int not null,
  direction app.ledger_direction not null,
  -- A reversal names the batch it cancels; each batch can be reversed at most once.
  reverses bigint unique references app.ledger_batches (id),
  created_at timestamptz not null default now(),
  unique (group_id, id),
  check ((direction = 'reverse') = (reverses is not null))
);
create index ledger_batches_source on app.ledger_batches (source_type, source_id, id desc);

create table app.ledger_entries (
  id bigint generated always as identity primary key,
  batch_id bigint not null,
  group_id uuid not null,
  member_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  foreign key (group_id, batch_id) references app.ledger_batches (group_id, id),
  foreign key (group_id, member_id) references app.members (group_id, id),
  unique (batch_id, member_id)
);
create index ledger_entries_member on app.ledger_entries (group_id, member_id);

-- I4: no updates, deletes or truncates, for any role.
create trigger ledger_batches_append_only before update or delete on app.ledger_batches
  for each row execute function app.reject_change();
create trigger ledger_batches_no_truncate before truncate on app.ledger_batches
  for each statement execute function app.reject_change();
create trigger ledger_entries_append_only before update or delete on app.ledger_entries
  for each row execute function app.reject_change();
create trigger ledger_entries_no_truncate before truncate on app.ledger_entries
  for each statement execute function app.reject_change();

-- I2, checked at commit: every batch sums to zero.
create function app.check_batch_balanced() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  total bigint;
begin
  select coalesce(sum(amount_minor), 0) into total from app.ledger_entries where batch_id = new.id;
  if total <> 0 then
    raise exception 'I2 violated: ledger batch % sums to %', new.id, total using errcode = 'check_violation';
  end if;
  return null;
end
$$;
create constraint trigger ledger_batches_balanced after insert on app.ledger_batches
  deferrable initially deferred for each row execute function app.check_batch_balanced();

-- The batch currently in effect for a source: its latest post that has not been reversed.
create function app.effective_batch(p_type app.ledger_source, p_id uuid) returns app.ledger_batches
language sql stable security definer set search_path = '' as $$
  select b.*
    from app.ledger_batches b
   where b.source_type = p_type and b.source_id = p_id and b.direction = 'post'
     and not exists (select 1 from app.ledger_batches r where r.reverses = b.id)
   order by b.id desc
   limit 1
$$;

-- Reverses the effective batch of a source, if there is one.
create function app.reverse_effective(p_type app.ledger_source, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  eff app.ledger_batches;
  rev bigint;
begin
  eff := app.effective_batch(p_type, p_id);
  if eff.id is null then
    return;
  end if;
  insert into app.ledger_batches (group_id, source_type, source_id, source_version, direction, reverses)
  values (eff.group_id, p_type, p_id, eff.source_version, 'reverse', eff.id)
  returning id into rev;
  insert into app.ledger_entries (batch_id, group_id, member_id, amount_minor)
  select rev, group_id, member_id, -amount_minor from app.ledger_entries where batch_id = eff.id;
end
$$;

-- Makes the ledger match one expense: the lines of `posted_version`, or nothing. Idempotent.
create function app.sync_expense_ledger(p_expense uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e app.expenses;
  eff app.ledger_batches;
  batch bigint;
begin
  select * into e from app.expenses where id = p_expense for update;
  if not found then
    return;
  end if;
  eff := app.effective_batch('expense', p_expense);
  if eff.id is not null and eff.source_version is not distinct from e.posted_version then
    return;
  end if;
  perform app.reverse_effective('expense', p_expense);
  if e.posted_version is null then
    return;
  end if;
  insert into app.ledger_batches (group_id, source_type, source_id, source_version, direction)
  values (e.group_id, 'expense', p_expense, e.posted_version, 'post')
  returning id into batch;
  -- A refund (money received back) is the same split with the signs inverted.
  insert into app.ledger_entries (batch_id, group_id, member_id, amount_minor)
  select batch, l.group_id, l.member_id,
         case when e.kind = 'refund' then l.owed_minor - l.paid_minor else l.paid_minor - l.owed_minor end
    from app.expense_version_lines l
   where l.expense_id = p_expense and l.version = e.posted_version and l.paid_minor <> l.owed_minor;
end
$$;

-- Makes the ledger match one settlement: posted while confirmed, reversed when voided. Idempotent.
create function app.sync_settlement_ledger(p_settlement uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s app.settlements;
  eff app.ledger_batches;
  batch bigint;
begin
  select * into s from app.settlements where id = p_settlement for update;
  if not found then
    return;
  end if;
  eff := app.effective_batch('settlement', p_settlement);
  if s.status = 'confirmed' then
    if eff.id is not null then
      return;
    end if;
    insert into app.ledger_batches (group_id, source_type, source_id, source_version, direction)
    values (s.group_id, 'settlement', p_settlement, 1, 'post')
    returning id into batch;
    insert into app.ledger_entries (batch_id, group_id, member_id, amount_minor)
    values (batch, s.group_id, s.from_member, s.amount_minor),
           (batch, s.group_id, s.to_member, -s.amount_minor);
  else
    perform app.reverse_effective('settlement', p_settlement);
  end if;
end
$$;

-- Deferred to commit so the versions and lines written in the same transaction are visible.
create function app.trg_sync_expense() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.sync_expense_ledger(new.id);
  return null;
end
$$;
create constraint trigger expenses_sync_ledger after insert or update on app.expenses
  deferrable initially deferred for each row execute function app.trg_sync_expense();

create function app.trg_sync_settlement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.sync_settlement_ledger(new.id);
  return null;
end
$$;
create constraint trigger settlements_sync_ledger after insert or update on app.settlements
  deferrable initially deferred for each row execute function app.trg_sync_settlement();

-- Balances: one row per member who has any ledger activity. RLS of ledger_entries applies.
create view app.member_balances with (security_invoker = true) as
  select group_id, member_id, sum(amount_minor)::bigint as balance_minor
    from app.ledger_entries
   group by group_id, member_id;

-- ---------- reconciliation (I5) ----------

-- Differences between what the stored state says should be posted and what the ledger holds,
-- per source and member. Empty = consistent. Also reports any group whose balances don't sum to 0 (I3).
create function app.reconcile(p_group uuid default null)
returns table (group_id uuid, source_type text, source_id uuid, member_id uuid, expected_minor bigint, actual_minor bigint)
language sql stable security definer set search_path = '' as $$
  with expected as (
    select e.group_id, 'expense'::text as source_type, e.id as source_id, l.member_id,
           case when e.kind = 'refund' then l.owed_minor - l.paid_minor else l.paid_minor - l.owed_minor end as amount
      from app.expenses e
      join app.expense_version_lines l on l.expense_id = e.id and l.version = e.posted_version
     where e.posted_version is not null
    union all
    select s.group_id, 'settlement', s.id, s.from_member, s.amount_minor
      from app.settlements s where s.status = 'confirmed'
    union all
    select s.group_id, 'settlement', s.id, s.to_member, -s.amount_minor
      from app.settlements s where s.status = 'confirmed'
  ),
  exp as (
    select x.group_id, x.source_type, x.source_id, x.member_id, sum(x.amount)::bigint as amount
      from expected x group by 1, 2, 3, 4
  ),
  act as (
    select b.group_id, b.source_type::text as source_type, b.source_id, le.member_id, sum(le.amount_minor)::bigint as amount
      from app.ledger_batches b
      join app.ledger_entries le on le.batch_id = b.id
     group by 1, 2, 3, 4
  ),
  diffs as (
    select coalesce(x.group_id, a.group_id) as group_id,
           coalesce(x.source_type, a.source_type) as source_type,
           coalesce(x.source_id, a.source_id) as source_id,
           coalesce(x.member_id, a.member_id) as member_id,
           coalesce(x.amount, 0) as expected_minor,
           coalesce(a.amount, 0) as actual_minor
      from exp x
      full join act a
        on a.group_id = x.group_id and a.source_type = x.source_type and a.source_id = x.source_id and a.member_id = x.member_id
     where coalesce(x.amount, 0) <> coalesce(a.amount, 0)
    union all
    select le.group_id, 'group_total', null::uuid, null::uuid, 0::bigint, sum(le.amount_minor)::bigint
      from app.ledger_entries le
     group by le.group_id
    having sum(le.amount_minor) <> 0
  )
  select * from diffs d where p_group is null or d.group_id = p_group
$$;

create table app.reconciliation_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  diff_count int,
  diffs jsonb
);

-- Run by the worker every night (and after incidents). Returns the number of differences; alert if > 0.
create function app.run_reconciliation() returns int
language plpgsql security definer set search_path = '' as $$
declare
  run_id bigint;
  found_diffs jsonb;
  n int;
begin
  insert into app.reconciliation_runs default values returning id into run_id;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb), count(*) into found_diffs, n from app.reconcile() r;
  update app.reconciliation_runs set finished_at = now(), diff_count = n, diffs = found_diffs where id = run_id;
  return n;
end
$$;
