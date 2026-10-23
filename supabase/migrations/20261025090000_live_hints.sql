-- Live updates over Supabase Realtime (plan §7.1: Realtime is only a "something changed" hint).
--
-- When a change commits, each affected person gets a broadcast on their own private channel,
-- topic `user:<auth user id>`, with the payload {"g": <group id>}. The app then reloads that group
-- through the API. The hint carries no amounts, names or text, and what the app may read is still
-- decided by the API's RLS. realtime.send() writes into realtime.messages inside the transaction,
-- so a hint goes out only if the change commits, and its own failures are only a warning.
--
-- Who hears what follows who can see it:
--   * group activity (expenses, payments, members, suggestions): current members;
--   * an expense's thread and its "seen" marks: current members who are in that expense;
--   * a pair thread and its "seen" marks: the two people (even after leaving);
--   * a member added, changed or removed: that member too, so a removed person's app drops the group.
-- The app also checks /pulse every 30 s (every 3 s while the channel is down), so a lost hint only
-- delays an update.

-- ---------- sending ----------

-- One hint per person per group per transaction, however many rows the change touched.
create function app.hint(p_group uuid, p_members uuid[] default null, p_active_only boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  sent text := coalesce(current_setting('app.hinted', true), '');
  k text;
begin
  -- Only Supabase has Realtime; plain Postgres (tests, local) skips the hint.
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return;
  end if;
  for u in
    select distinct m.user_id from app.members m
     where m.group_id = p_group
       and m.user_id is not null
       and (p_members is null or m.id = any (p_members))
       and (not p_active_only or m.status = 'active')
  loop
    k := p_group::text || '/' || u::text;
    continue when position(k in sent) > 0;
    sent := sent || ' ' || k;
    perform set_config('app.hinted', sent, true);
    -- A hint must never undo the change it announces: if sending fails, the app's /pulse check
    -- still finds the change.
    begin
      execute 'select realtime.send($1, $2, $3, true)' using jsonb_build_object('g', p_group), 'changed', 'user:' || u::text;
    exception when others then
      raise warning 'live hint not sent: %', sqlerrm;
    end;
  end loop;
end $$;
revoke all on function app.hint(uuid, uuid[], boolean) from public, anon, authenticated;

-- The people in an expense: its creator and everyone who paid or owed in any version.
create function app.expense_people(p_expense uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select e.created_by as x from app.expenses e where e.id = p_expense
    union
    select l.member_id from app.expense_version_lines l where l.expense_id = p_expense
  ) people
$$;
revoke all on function app.expense_people(uuid) from public, anon, authenticated;

-- ---------- what triggers a hint ----------

create function app.hint_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A thread's messages are hinted from app.messages, to the thread's people only.
  if new.entity_type = 'message' then
    return null;
  end if;
  perform app.hint(new.group_id);
  if new.entity_type = 'member' then
    perform app.hint(new.group_id, array[new.entity_id], false);
  end if;
  return null;
end $$;
revoke all on function app.hint_activity() from public, anon, authenticated;
create trigger activity_events_hint after insert on app.activity_events
  for each row execute function app.hint_activity();

create function app.hint_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pair_a is not null then
    perform app.hint(new.group_id, array[new.pair_a, new.pair_b], false);
  elsif new.expense_id is not null then
    perform app.hint(new.group_id, app.expense_people(new.expense_id));
  else
    perform app.hint(new.group_id);
  end if;
  return null;
end $$;
revoke all on function app.hint_message() from public, anon, authenticated;
create trigger messages_hint after insert or update on app.messages
  for each row execute function app.hint_message();

create function app.hint_seen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  case new.entity_type
    when 'pair' then perform app.hint(new.group_id, array[new.member_id, new.entity_id], false);
    when 'expense' then perform app.hint(new.group_id, app.expense_people(new.entity_id));
    else perform app.hint(new.group_id);
  end case;
  return null;
end $$;
revoke all on function app.hint_seen() from public, anon, authenticated;
create trigger seen_hint after insert or update on app.seen
  for each row execute function app.hint_seen();

-- ---------- who may listen ----------

-- A signed-in person may join only their own channel; nobody may broadcast from the app (no insert
-- policy), so hints come only from the database.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists splitify_own_hints on realtime.messages';
    execute $p$
      create policy splitify_own_hints on realtime.messages for select to authenticated
        using (
          realtime.messages.extension = 'broadcast'
          and (select realtime.topic()) = 'user:' || (select auth.uid())::text
        )
    $p$;
  end if;
end $$;
