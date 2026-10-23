-- Who can read and write what (RLS), as a second line of defence behind the API's own checks.
--
-- The API runs each request as `app_api` with `app.user_id` set to the signed-in Supabase user:
--   begin; set local role app_api; select set_config('app.user_id', '<uuid>', true); ...; commit;
-- Active members see and change their groups. Former members (left/removed) keep a read-only view of
-- their own balance, their own settlements and the expenses that involved them (I11). Everyone else
-- sees nothing. Fine-grained rules (only the owner edits, who may confirm a payment…) live in the API
-- and @app/workflow; RLS guarantees nobody reaches another group's data even if the API has a bug.
-- `anon` and `authenticated` (the Supabase Data API roles) get no access to the app schema at all.

-- ---------- helpers ----------

create function app.current_user_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function app.is_active_member(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.members m
     where m.group_id = p_group and m.user_id = app.current_user_id() and m.status = 'active'
  )
$$;

-- Member of the group now or in the past.
create function app.is_linked(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.members m where m.group_id = p_group and m.user_id = app.current_user_id())
$$;

create function app.is_my_member(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.members m where m.id = p_member and m.user_id = app.current_user_id())
$$;

-- Active members read every expense; former members only those that involved them.
create function app.can_read_expense(p_group uuid, p_expense uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_member(p_group) or exists (
    select 1
      from app.expense_version_lines l
      join app.members m on m.id = l.member_id
     where l.expense_id = p_expense and m.user_id = app.current_user_id()
  )
$$;

-- Members can be linked only to the signed-in user (joining, claiming a placeholder) or unlinked
-- (leaving, account deletion). Nobody can attach someone else's account to a member.
create or replace function app.members_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.group_id <> old.group_id then
    raise exception 'a member cannot move to another group' using errcode = 'check_violation';
  end if;
  if new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and new.user_id is distinct from app.current_user_id() then
    raise exception 'a member can only be linked to the signed-in user' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
drop trigger members_guard on app.members;
create trigger members_guard before insert or update on app.members
  for each row execute function app.members_guard();

-- ---------- entry points that need more than one table ----------

-- Creates a group with the signed-in user as its owner. Ids come from the client (idempotent retries).
create function app.create_group(
  p_group uuid, p_name text, p_kind text, p_currency char(3), p_member uuid, p_display_name text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.current_user_id();
begin
  if uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  insert into app.groups (id, name, kind, currency) values (p_group, p_name, p_kind, p_currency);
  insert into app.members (id, group_id, user_id, display_name, role)
  values (p_member, p_group, uid, p_display_name, 'owner');
end
$$;

-- Joins a group from an invite link, either as a new member or by claiming a placeholder member
-- (a name added before that friend signed up). Returns the member id.
create function app.accept_invite(p_token_hash bytea, p_claim_member uuid, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.current_user_id();
  inv app.invites;
  existing uuid;
  member uuid;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  select * into inv from app.invites where token_hash = p_token_hash for update;
  if not found or inv.revoked_at is not null or inv.expires_at <= now()
     or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    -- One message for every failure, so links can't be probed.
    raise exception 'this invite link is not valid any more' using errcode = 'invalid_authorization_specification';
  end if;
  select id into existing from app.members where group_id = inv.group_id and user_id = uid;
  if existing is not null then
    return existing; -- already in the group: opening the link again is harmless
  end if;
  if p_claim_member is not null then
    update app.members set user_id = uid
     where id = p_claim_member and group_id = inv.group_id and user_id is null and status = 'active'
    returning id into member;
    if member is null then
      raise exception 'that name is already taken' using errcode = 'unique_violation';
    end if;
  else
    insert into app.members (group_id, user_id, display_name) values (inv.group_id, uid, p_display_name)
    returning id into member;
  end if;
  update app.invites set uses = uses + 1 where id = inv.id;
  return member;
end
$$;

-- ---------- row level security ----------

alter table app.profiles enable row level security;
alter table app.groups enable row level security;
alter table app.members enable row level security;
alter table app.invites enable row level security;
alter table app.expenses enable row level security;
alter table app.expense_versions enable row level security;
alter table app.expense_version_lines enable row level security;
alter table app.suggestions enable row level security;
alter table app.review_decisions enable row level security;
alter table app.disputes enable row level security;
alter table app.settlements enable row level security;
alter table app.messages enable row level security;
alter table app.activity_events enable row level security;
alter table app.idempotency_keys enable row level security;
alter table app.ledger_batches enable row level security;
alter table app.ledger_entries enable row level security;
alter table app.reconciliation_runs enable row level security;

create policy own_profile on app.profiles for all to app_api
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy read_groups on app.groups for select to app_api using (app.is_linked(id));
create policy update_groups on app.groups for update to app_api
  using (app.is_active_member(id)) with check (app.is_active_member(id));

create policy read_members on app.members for select to app_api
  using (app.is_active_member(group_id) or user_id = app.current_user_id());
create policy add_members on app.members for insert to app_api with check (app.is_active_member(group_id));
create policy update_members on app.members for update to app_api
  using (app.is_active_member(group_id)) with check (app.is_linked(group_id) or user_id is null);

create policy invites_members on app.invites for all to app_api
  using (app.is_active_member(group_id)) with check (app.is_active_member(group_id));

create policy read_expenses on app.expenses for select to app_api using (app.can_read_expense(group_id, id));
create policy write_expenses on app.expenses for insert to app_api with check (app.is_active_member(group_id));
create policy update_expenses on app.expenses for update to app_api
  using (app.is_active_member(group_id)) with check (app.is_active_member(group_id));

create policy read_versions on app.expense_versions for select to app_api using (app.can_read_expense(group_id, expense_id));
create policy write_versions on app.expense_versions for insert to app_api with check (app.is_active_member(group_id));

create policy read_lines on app.expense_version_lines for select to app_api using (app.can_read_expense(group_id, expense_id));
create policy write_lines on app.expense_version_lines for insert to app_api with check (app.is_active_member(group_id));

create policy suggestions_members on app.suggestions for all to app_api
  using (app.is_active_member(group_id)) with check (app.is_active_member(group_id));
create policy decisions_read on app.review_decisions for select to app_api using (app.is_active_member(group_id));
create policy decisions_write on app.review_decisions for insert to app_api with check (app.is_active_member(group_id));
create policy disputes_members on app.disputes for all to app_api
  using (app.is_active_member(group_id)) with check (app.is_active_member(group_id));

create policy read_settlements on app.settlements for select to app_api
  using (app.is_active_member(group_id) or app.is_my_member(from_member) or app.is_my_member(to_member));
create policy write_settlements on app.settlements for insert to app_api with check (app.is_active_member(group_id));
create policy update_settlements on app.settlements for update to app_api
  using (app.is_active_member(group_id)) with check (app.is_active_member(group_id));

-- Former members have no chat access.
create policy messages_members on app.messages for all to app_api
  using (app.is_active_member(group_id)) with check (app.is_active_member(group_id));

create policy activity_read on app.activity_events for select to app_api using (app.is_active_member(group_id));
create policy activity_write on app.activity_events for insert to app_api with check (app.is_active_member(group_id));

create policy own_idempotency_keys on app.idempotency_keys for all to app_api
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy read_batches on app.ledger_batches for select to app_api using (app.is_active_member(group_id));
create policy read_entries on app.ledger_entries for select to app_api
  using (app.is_active_member(group_id) or app.is_my_member(member_id));

-- The worker (reconciliation, notifications) reads everything and writes only reconciliation runs.
create policy worker_profiles on app.profiles for select to app_worker using (true);
create policy worker_groups on app.groups for select to app_worker using (true);
create policy worker_members on app.members for select to app_worker using (true);
create policy worker_expenses on app.expenses for select to app_worker using (true);
create policy worker_versions on app.expense_versions for select to app_worker using (true);
create policy worker_lines on app.expense_version_lines for select to app_worker using (true);
create policy worker_suggestions on app.suggestions for select to app_worker using (true);
create policy worker_decisions on app.review_decisions for select to app_worker using (true);
create policy worker_disputes on app.disputes for select to app_worker using (true);
create policy worker_settlements on app.settlements for select to app_worker using (true);
create policy worker_messages on app.messages for select to app_worker using (true);
create policy worker_activity on app.activity_events for select to app_worker using (true);
create policy worker_batches on app.ledger_batches for select to app_worker using (true);
create policy worker_entries on app.ledger_entries for select to app_worker using (true);
create policy worker_runs on app.reconciliation_runs for select to app_worker using (true);

-- ---------- privileges ----------

revoke all on schema app from anon, authenticated;
revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;

grant usage on schema app to app_api, app_worker;

grant select on all tables in schema app to app_api, app_worker;
revoke select on app.reconciliation_runs from app_api;

grant update (name, kind, review_threshold_minor, review_required, archived_at) on app.groups to app_api;
grant insert, update on app.profiles, app.members, app.invites, app.expenses, app.suggestions,
  app.disputes, app.settlements, app.messages, app.idempotency_keys to app_api;
-- Immutable once written: insert only.
grant insert on app.expense_versions, app.expense_version_lines, app.review_decisions, app.activity_events to app_api;
-- Ledger tables: select only. Rows are written by the sync functions, never by the API directly.

-- Helpers used inside policies run with the caller's privileges.
grant execute on function app.current_user_id(), app.is_active_member(uuid), app.is_linked(uuid),
  app.is_my_member(uuid), app.can_read_expense(uuid, uuid) to app_api, app_worker;
grant execute on function app.create_group(uuid, text, text, char, uuid, text),
  app.accept_invite(bytea, uuid, text) to app_api;
grant execute on function app.reconcile(uuid), app.run_reconciliation() to app_worker;
