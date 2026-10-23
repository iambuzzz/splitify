-- Someone who has left (or was removed) may still owe or be owed money, so the payer and the
-- receiver can record and settle a payment whatever their membership status. Current members
-- keep the access they had; the API's state machine decides who may take each step.

drop policy write_settlements on app.settlements;
create policy write_settlements on app.settlements for insert to app_api
  with check (app.is_active_member(group_id) or app.is_my_member(recorded_by));

drop policy update_settlements on app.settlements;
create policy update_settlements on app.settlements for update to app_api
  using (app.is_active_member(group_id) or app.is_my_member(from_member) or app.is_my_member(to_member))
  with check (app.is_active_member(group_id) or app.is_my_member(from_member) or app.is_my_member(to_member));

-- Their payment steps still go into the group's activity (the receiver and the other members
-- need to see them). The (group_id, actor_member_id) foreign key keeps the actor in this group.
drop policy activity_write on app.activity_events;
create policy activity_write on app.activity_events for insert to app_api
  with check (app.is_active_member(group_id) or (entity_type = 'settlement' and app.is_my_member(actor_member_id)));

-- Idempotency keys are kept for 30 days (offline retries), then removed by the worker. Never less
-- than a day, so a key cannot be dropped while its retry may still arrive.
create function app.purge_idempotency_keys(p_older_than interval default interval '30 days') returns bigint
language sql security definer set search_path = '' as $$
  with gone as (
    delete from app.idempotency_keys
     where created_at < now() - greatest(p_older_than, interval '1 day')
    returning 1
  )
  select count(*) from gone
$$;
revoke all on function app.purge_idempotency_keys(interval) from public, anon, authenticated;
grant execute on function app.purge_idempotency_keys(interval) to app_worker;
