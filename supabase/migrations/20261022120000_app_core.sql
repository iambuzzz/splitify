-- Splitify core schema (R1 M2).
--
-- Domain data lives in the private `app` schema, which the Supabase Data API does not expose.
-- Only the Node API writes it, by switching to the `app_api` role inside each transaction
-- (`set local role app_api; select set_config('app.user_id', <auth user id>, true)`), so Row
-- Level Security applies to every API query as a second line of defence (see the access migration).
--
-- Written for Postgres 17 (Supabase); avoid Postgres 18-only features.
-- Money is bigint minor units (paise for INR), max 10^12 per amount, never floats.

create schema if not exists app;
revoke all on schema app from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_worker') then
    create role app_worker nologin;
  end if;
end
$$;
-- The connecting user (postgres on Supabase) may switch into these roles.
grant app_api, app_worker to current_user;

create type app.group_role as enum ('owner', 'admin', 'member');
create type app.member_status as enum ('active', 'left', 'removed');
create type app.expense_status as enum ('draft', 'in_review', 'active', 'deleted');
create type app.expense_kind as enum ('expense', 'refund');
create type app.split_method as enum ('equal', 'exact', 'percent', 'shares');
create type app.suggestion_status as enum ('open', 'accepted', 'declined', 'withdrawn', 'outdated');
create type app.review_decision as enum ('approve', 'decline');
-- 'verified' is deliberately absent: it needs payment-provider evidence, which v1 does not have.
create type app.settlement_status as enum ('awaiting_confirmation', 'confirmed', 'declined', 'withdrawn', 'voided');
create type app.settlement_method as enum ('upi', 'cash', 'bank', 'other');

create domain app.money as bigint check (value > 0 and value <= 1000000000000);

-- Rejects any UPDATE/DELETE/TRUNCATE; used for append-only and immutable tables.
create function app.reject_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end
$$;

create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------- people and groups ----------

create table app.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table app.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null default 'other' check (kind in ('trip', 'home', 'couple', 'event', 'food', 'other')),
  -- One ledger currency per group; foreign expenses store their own currency plus a rate.
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- Review mode: expenses at or above the threshold need `review_required` OKs. Null = off.
  review_threshold_minor app.money,
  review_required int not null default 1 check (review_required between 1 and 10),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger groups_touch before update on app.groups for each row execute function app.touch_updated_at();

-- The ledger references members, not users: placeholders, account claims and account deletion
-- only change `user_id`, never financial history (I12).
create table app.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app.groups (id),
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  role app.group_role not null default 'member',
  status app.member_status not null default 'active',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  -- Target for composite foreign keys, so every member reference stays inside its group.
  unique (group_id, id),
  check ((status = 'active') = (left_at is null))
);
create unique index members_one_per_user on app.members (group_id, user_id) where user_id is not null;
create unique index members_unique_active_name on app.members (group_id, lower(btrim(display_name))) where status = 'active';

create function app.members_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.group_id <> old.group_id then
    raise exception 'a member cannot move to another group' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger members_guard before update on app.members for each row execute function app.members_guard();

create table app.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app.groups (id),
  -- SHA-256 of the random token in the link; the token itself is never stored.
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_by uuid not null,
  expires_at timestamptz not null,
  max_uses int check (max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (group_id, created_by) references app.members (group_id, id),
  check (max_uses is null or uses <= max_uses)
);

-- ---------- expenses ----------

create table app.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app.groups (id),
  created_by uuid not null,
  kind app.expense_kind not null default 'expense',
  status app.expense_status not null default 'draft',
  -- Latest saved version; versions are numbered 1, 2, 3… without gaps.
  current_version int not null default 1 check (current_version >= 1),
  -- Version whose postings are in the ledger, or null when not counted (drafts, new expenses in review, deleted).
  posted_version int check (posted_version >= 1),
  -- Set on delete when a version was posted, so restore can repost it.
  restorable_version int,
  expense_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, id),
  foreign key (group_id, created_by) references app.members (group_id, id),
  check (posted_version is null or posted_version <= current_version),
  check (status not in ('draft', 'deleted') or posted_version is null),
  check (status <> 'active' or posted_version = current_version),
  -- A material edit under review keeps the old version counted until it is approved.
  check (status <> 'in_review' or posted_version is null or posted_version < current_version)
);
create index expenses_group on app.expenses (group_id, expense_date desc);
create trigger expenses_touch before update on app.expenses for each row execute function app.touch_updated_at();

create function app.expenses_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.group_id <> old.group_id or new.created_by <> old.created_by or new.kind <> old.kind then
    raise exception 'group, creator and kind of an expense cannot change' using errcode = 'check_violation';
  end if;
  if new.current_version < old.current_version then
    raise exception 'expense versions only move forward' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger expenses_guard before update on app.expenses for each row execute function app.expenses_guard();

-- Immutable snapshots: an edit is a new version, never an update (history and diffs come from here).
create table app.expense_versions (
  expense_id uuid not null references app.expenses (id),
  version int not null check (version >= 1),
  group_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  notes text check (char_length(notes) <= 2000),
  category text check (char_length(category) <= 40),
  -- What was actually paid, in its own currency.
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  original_total_minor app.money not null,
  -- Ledger-currency units per 1 unit of `currency` (decimal, 10 dp); null when it is the group currency.
  rate numeric(30, 10) check (rate > 0),
  rate_source text,
  rate_at timestamptz,
  -- Total in the group's ledger currency; shares and payer amounts below add up to it exactly (I1).
  ledger_total_minor app.money not null,
  split_method app.split_method not null,
  -- The inputs the split was computed from (who was in, exact amounts, %, shares/nights).
  split_input jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (expense_id, version),
  foreign key (group_id, expense_id) references app.expenses (group_id, id),
  foreign key (group_id, created_by) references app.members (group_id, id),
  check ((rate is null) = (rate_source is null))
);
create trigger expense_versions_immutable before update or delete on app.expense_versions
  for each row execute function app.reject_change();
create trigger expense_versions_no_truncate before truncate on app.expense_versions
  for each statement execute function app.reject_change();

-- Per member: what they paid and what they owe for one version (computed by @app/ledger).
create table app.expense_version_lines (
  expense_id uuid not null,
  version int not null,
  group_id uuid not null,
  member_id uuid not null,
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  owed_minor bigint not null default 0 check (owed_minor >= 0),
  primary key (expense_id, version, member_id),
  foreign key (expense_id, version) references app.expense_versions (expense_id, version),
  foreign key (group_id, expense_id) references app.expenses (group_id, id),
  foreign key (group_id, member_id) references app.members (group_id, id),
  check (paid_minor > 0 or owed_minor > 0)
);
create trigger expense_version_lines_immutable before update or delete on app.expense_version_lines
  for each row execute function app.reject_change();
create trigger expense_version_lines_no_truncate before truncate on app.expense_version_lines
  for each statement execute function app.reject_change();

-- Versions are numbered without gaps; the expense row is locked so concurrent edits serialise.
create function app.expense_versions_next() returns trigger
language plpgsql set search_path = '' as $$
declare
  latest int;
begin
  perform 1 from app.expenses where id = new.expense_id for update;
  select max(version) into latest from app.expense_versions where expense_id = new.expense_id;
  if new.version <> coalesce(latest, 0) + 1 then
    raise exception 'expense % expects version %, got %', new.expense_id, coalesce(latest, 0) + 1, new.version
      using errcode = 'serialization_failure';
  end if;
  return new;
end
$$;
create trigger expense_versions_next before insert on app.expense_versions
  for each row execute function app.expense_versions_next();

-- I1, checked at commit: payers and shares each add up to the ledger total.
create function app.check_version_balanced() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  total bigint;
  paid bigint;
  owed bigint;
begin
  select v.ledger_total_minor, coalesce(sum(l.paid_minor), 0), coalesce(sum(l.owed_minor), 0)
    into total, paid, owed
    from app.expense_versions v
    left join app.expense_version_lines l on l.expense_id = v.expense_id and l.version = v.version
   where v.expense_id = new.expense_id and v.version = new.version
   group by v.ledger_total_minor;
  if paid <> total or owed <> total then
    raise exception 'I1 violated for expense % v%: total %, paid %, owed %', new.expense_id, new.version, total, paid, owed
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
create constraint trigger expense_versions_balanced after insert on app.expense_versions
  deferrable initially deferred for each row execute function app.check_version_balanced();
create constraint trigger expense_version_lines_balanced after insert on app.expense_version_lines
  deferrable initially deferred for each row execute function app.check_version_balanced();

-- Every expense must point at versions that exist (checked at commit, after the versions are inserted).
alter table app.expenses
  add constraint expenses_current_version_fk foreign key (id, current_version)
    references app.expense_versions (expense_id, version) deferrable initially deferred,
  add constraint expenses_posted_version_fk foreign key (id, posted_version)
    references app.expense_versions (expense_id, version) deferrable initially deferred;

create table app.suggestions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null,
  group_id uuid not null,
  author_id uuid not null,
  -- The version the suggestion was written against; accepting it requires it to still be current.
  base_version int not null,
  -- Proposed version content, validated by the API with the same rules as an edit.
  proposal jsonb not null,
  reason text check (char_length(reason) <= 500),
  status app.suggestion_status not null default 'open',
  decided_by uuid,
  decided_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 500),
  applied_version int,
  created_at timestamptz not null default now(),
  foreign key (group_id, expense_id) references app.expenses (group_id, id),
  foreign key (expense_id, base_version) references app.expense_versions (expense_id, version),
  foreign key (group_id, author_id) references app.members (group_id, id),
  foreign key (group_id, decided_by) references app.members (group_id, id),
  check ((status = 'open') = (decided_at is null)),
  check (status <> 'accepted' or applied_version is not null)
);
create index suggestions_open on app.suggestions (expense_id) where status = 'open';

-- I8: one decision per member per version, bound to that exact version.
create table app.review_decisions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null,
  group_id uuid not null,
  version int not null,
  member_id uuid not null,
  decision app.review_decision not null,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique (expense_id, version, member_id),
  foreign key (group_id, expense_id) references app.expenses (group_id, id),
  foreign key (expense_id, version) references app.expense_versions (expense_id, version),
  foreign key (group_id, member_id) references app.members (group_id, id),
  check (decision = 'approve' or reason is not null)
);
create trigger review_decisions_immutable before update or delete on app.review_decisions
  for each row execute function app.reject_change();

-- I8: the author of a version cannot approve or decline their own change.
create function app.review_decisions_not_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from app.expense_versions
     where expense_id = new.expense_id and version = new.version and created_by = new.member_id
  ) then
    raise exception 'the author of a version cannot review it' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger review_decisions_not_author before insert on app.review_decisions
  for each row execute function app.review_decisions_not_author();

create table app.disputes (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null,
  group_id uuid not null,
  member_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text check (close_reason in ('withdrawn', 'resolved')),
  foreign key (group_id, expense_id) references app.expenses (group_id, id),
  foreign key (group_id, member_id) references app.members (group_id, id),
  check ((closed_at is null) = (close_reason is null))
);
create unique index disputes_one_open on app.disputes (expense_id, member_id) where closed_at is null;

-- ---------- settlements ----------

create table app.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app.groups (id),
  from_member uuid not null,
  to_member uuid not null,
  amount_minor app.money not null,
  method app.settlement_method not null,
  status app.settlement_status not null,
  recorded_by uuid not null,
  note text check (char_length(note) <= 500),
  decided_by uuid,
  decided_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (group_id, id),
  foreign key (group_id, from_member) references app.members (group_id, id),
  foreign key (group_id, to_member) references app.members (group_id, id),
  foreign key (group_id, recorded_by) references app.members (group_id, id),
  foreign key (group_id, decided_by) references app.members (group_id, id),
  check (from_member <> to_member),
  check (recorded_by in (from_member, to_member)),
  -- Recorded by the receiver = counts at once; recorded by the payer = waits for the receiver.
  check (recorded_by = from_member or status <> 'awaiting_confirmation')
);
create index settlements_group on app.settlements (group_id, created_at desc);

-- Who, how much and between whom never change; status only moves along the allowed paths.
create function app.settlements_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('awaiting_confirmation', 'confirmed') then
      raise exception 'a new settlement starts as awaiting_confirmation or confirmed' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.group_id, new.from_member, new.to_member, new.amount_minor, new.recorded_by, new.created_at)
     is distinct from (old.group_id, old.from_member, old.to_member, old.amount_minor, old.recorded_by, old.created_at) then
    raise exception 'a settlement''s parties and amount cannot change' using errcode = 'check_violation';
  end if;
  if new.status <> old.status and not (
       (old.status = 'awaiting_confirmation' and new.status in ('confirmed', 'declined', 'withdrawn'))
    or (old.status = 'confirmed' and new.status = 'voided')
  ) then
    raise exception 'settlement cannot go from % to %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger settlements_guard before insert or update on app.settlements
  for each row execute function app.settlements_guard();

-- ---------- conversation (expense questions now; the timeline arrives in R2) ----------

create table app.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app.groups (id),
  author_id uuid not null,
  kind text not null check (kind in ('text', 'question')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  expense_id uuid,
  settlement_id uuid,
  reply_to uuid references app.messages (id),
  resolved_at timestamptz,
  resolved_by uuid,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (group_id, author_id) references app.members (group_id, id),
  foreign key (group_id, expense_id) references app.expenses (group_id, id),
  foreign key (group_id, settlement_id) references app.settlements (group_id, id),
  foreign key (group_id, resolved_by) references app.members (group_id, id),
  check (expense_id is null or settlement_id is null),
  check (kind <> 'question' or expense_id is not null),
  check ((resolved_at is null) = (resolved_by is null))
);
create index messages_expense on app.messages (expense_id, created_at) where expense_id is not null;

-- ---------- activity (audit trail and notification outbox) ----------

create table app.activity_events (
  -- UUIDv7 from the API, so ids sort by time.
  id uuid primary key,
  group_id uuid not null references app.groups (id),
  actor_member_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  entity_version int,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (group_id, actor_member_id) references app.members (group_id, id)
);
create index activity_events_group on app.activity_events (group_id, id);
create trigger activity_events_append_only before update or delete on app.activity_events
  for each row execute function app.reject_change();
create trigger activity_events_no_truncate before truncate on app.activity_events
  for each statement execute function app.reject_change();

-- I7: same key + same payload returns the stored response; same key + different payload is refused (422).
create table app.idempotency_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 8 and 128),
  request_hash bytea not null check (octet_length(request_hash) = 32),
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
