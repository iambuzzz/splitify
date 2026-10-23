-- What the API (R1 M3) needs on top of the M2 schema.

-- Who paid, as entered (in the version's own currency). Lines hold the ledger-currency amounts,
-- which lose the original figures for foreign expenses; edit forms and history need both.
alter table app.expense_versions
  add column payers jsonb not null check (jsonb_typeof(payers) = 'array' and jsonb_array_length(payers) > 0);

-- The version whose material change is waiting for OKs (review mode). Decisions name this
-- version; later non-material edits (title, notes) do not move it.
alter table app.expenses
  add column review_version int,
  add constraint expenses_review_version_fk foreign key (id, review_version)
    references app.expense_versions (expense_id, version) deferrable initially deferred,
  add constraint expenses_review_version_check check ((status = 'in_review') = (review_version is not null));

-- A non-material edit (new title, same money) creates a new version and moves `posted_version`
-- to it. The ledger already holds exactly those amounts, so nothing is reversed or reposted:
-- the sync now compares amounts, not version numbers. Reconciliation compares per expense, so
-- it is unaffected.
create or replace function app.sync_expense_ledger(p_expense uuid) returns void
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
  if eff.id is not null and e.posted_version is not null and not exists (
    (select le.member_id, le.amount_minor from app.ledger_entries le where le.batch_id = eff.id
     except
     select l.member_id,
            case when e.kind = 'refund' then l.owed_minor - l.paid_minor else l.paid_minor - l.owed_minor end
       from app.expense_version_lines l
      where l.expense_id = p_expense and l.version = e.posted_version and l.paid_minor <> l.owed_minor)
    union all
    (select l.member_id,
            case when e.kind = 'refund' then l.owed_minor - l.paid_minor else l.paid_minor - l.owed_minor end
       from app.expense_version_lines l
      where l.expense_id = p_expense and l.version = e.posted_version and l.paid_minor <> l.owed_minor
     except
     select le.member_id, le.amount_minor from app.ledger_entries le where le.batch_id = eff.id)
  ) then
    return;
  end if;
  if eff.id is null and e.posted_version is null then
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

-- What someone opening an invite link may see before joining: the group's name and the names
-- still waiting to be claimed. Nothing for an expired, revoked or unknown link.
create function app.invite_preview(p_token_hash bytea)
returns table (group_id uuid, group_name text, kind text, member_count int, placeholders jsonb)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.kind,
         (select count(*)::int from app.members m where m.group_id = g.id and m.status = 'active'),
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'displayName', m.display_name) order by m.display_name)
                     from app.members m
                    where m.group_id = g.id and m.status = 'active' and m.user_id is null), '[]'::jsonb)
    from app.invites i
    join app.groups g on g.id = i.group_id
   where i.token_hash = p_token_hash and i.revoked_at is null and i.expires_at > now()
     and (i.max_uses is null or i.uses < i.max_uses)
$$;

revoke all on function app.invite_preview(bytea) from public, anon, authenticated;
grant execute on function app.invite_preview(bytea) to app_api;
