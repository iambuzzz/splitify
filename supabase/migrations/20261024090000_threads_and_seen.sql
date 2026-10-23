-- Conversation stays about money (plan Rev 3, refined 2026-10-23 with the user):
--   * an expense's thread is for the people in that expense only;
--   * two members can keep a private thread about settling up between them;
--   * "seen" is recorded for money items only (an expense version, a payment, a pair thread):
--     no online status and no per-message delivery ticks.

-- ---------- who is in an expense ----------

-- The creator, and anyone who paid or owed in any version (they keep the history they were part of).
create function app.is_in_expense(p_expense uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.expenses e join app.members m on m.id = e.created_by
     where e.id = p_expense and m.user_id = app.current_user_id()
  ) or exists (
    select 1 from app.expense_version_lines l join app.members m on m.id = l.member_id
     where l.expense_id = p_expense and m.user_id = app.current_user_id()
  )
$$;
revoke all on function app.is_in_expense(uuid) from public, anon, authenticated;
grant execute on function app.is_in_expense(uuid) to app_api;

-- ---------- private thread between two members ----------

alter table app.messages
  add column pair_a uuid,
  add column pair_b uuid,
  add foreign key (group_id, pair_a) references app.members (group_id, id),
  add foreign key (group_id, pair_b) references app.members (group_id, id),
  -- One pair, stored in a fixed order, so both people find the same thread.
  add check ((pair_a is null) = (pair_b is null)),
  add check (pair_a < pair_b),
  add check (num_nonnulls(expense_id, settlement_id, pair_a) <= 1),
  add check (pair_a is null or author_id in (pair_a, pair_b));
create index messages_pair on app.messages (group_id, pair_a, pair_b, created_at) where pair_a is not null;
create index messages_group_created on app.messages (group_id, created_at);

-- Who can see a message: a pair thread, only its two people (even after leaving, to settle up);
-- an expense thread, current members who are in the expense; anything else, current members.
create function app.can_see_message(p_group uuid, p_expense uuid, p_pair_a uuid, p_pair_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_pair_a is not null then app.is_my_member(p_pair_a) or app.is_my_member(p_pair_b)
    when p_expense is not null then app.is_active_member(p_group) and app.is_in_expense(p_expense)
    else app.is_active_member(p_group)
  end
$$;
revoke all on function app.can_see_message(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.can_see_message(uuid, uuid, uuid, uuid) to app_api;

drop policy messages_members on app.messages;
create policy messages_read on app.messages for select to app_api
  using (app.can_see_message(group_id, expense_id, pair_a, pair_b));
create policy messages_write on app.messages for insert to app_api
  with check (app.is_my_member(author_id) and app.can_see_message(group_id, expense_id, pair_a, pair_b));
create policy messages_update on app.messages for update to app_api
  using (app.can_see_message(group_id, expense_id, pair_a, pair_b))
  with check (app.can_see_message(group_id, expense_id, pair_a, pair_b));

-- ---------- seen ----------

create table app.seen (
  member_id uuid not null,
  group_id uuid not null references app.groups (id),
  entity_type text not null check (entity_type in ('expense', 'settlement', 'pair')),
  -- The expense, the payment, or (for a pair thread) the other member.
  entity_id uuid not null,
  -- For an expense: the version this person has seen.
  version int,
  seen_at timestamptz not null default now(),
  primary key (member_id, entity_type, entity_id),
  foreign key (group_id, member_id) references app.members (group_id, id)
);
create index seen_group on app.seen (group_id, seen_at);
alter table app.seen enable row level security;

-- Seen on an expense is visible to the people in it; on a pair thread, to the two people; on a
-- payment, to current members. Everyone sees their own.
create policy seen_read on app.seen for select to app_api using (
  app.is_my_member(member_id) or case entity_type
    when 'pair' then app.is_my_member(entity_id)
    when 'expense' then app.is_active_member(group_id) and app.is_in_expense(entity_id)
    else app.is_active_member(group_id)
  end
);
create policy seen_write on app.seen for insert to app_api with check (app.is_my_member(member_id));
create policy seen_update on app.seen for update to app_api using (app.is_my_member(member_id)) with check (app.is_my_member(member_id));
create policy worker_seen on app.seen for select to app_worker using (true);
grant select, insert, update on app.seen to app_api;
grant select on app.seen to app_worker;
