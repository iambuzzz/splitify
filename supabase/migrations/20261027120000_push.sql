-- Push notifications (plan §10): phones (the Android app, through Expo's push service and Google's
-- FCM) and browsers (Web Push: the website and the installed web app on iPhone, Windows, Mac, Android).
--
-- * app.push_devices: one row per device that turned notifications on, owned by its user. Each
--   device keeps its own settings (prefs): which kinds are off, and which groups are muted.
-- * The API's sender reads new rows of app.activity_events (the outbox written with every change)
--   through app.push_take(), which hands back each event with what a notification needs: names,
--   the expense title, and who should hear about it. It moves a cursor, so each event is read once.
--   What to send, to whom, and when (some are gathered for two minutes) is decided by the API.
-- Notifications never carry amounts by default; what reaches a lock screen is a name and an action.

create table app.push_devices (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expo', 'web')),
  -- The Expo push token, or the browser's Web Push endpoint (a URL at Google, Mozilla, Apple…).
  token text not null unique check (char_length(token) between 10 and 1000),
  -- Web Push only: the browser's public key and auth secret (needed to encrypt for it).
  keys jsonb check (keys is null or (keys ? 'p256dh' and keys ? 'auth')),
  label text not null default '' check (char_length(label) <= 60),
  -- {"off": ["chat", ...], "muted": ["<group id>", ...]}
  prefs jsonb not null default '{}' check (jsonb_typeof(prefs) = 'object'),
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  check (kind <> 'web' or keys is not null)
);
create index push_devices_user on app.push_devices (user_id);
alter table app.push_devices enable row level security;
revoke all on app.push_devices from public, anon, authenticated;
grant select, update, delete on app.push_devices to app_api;
-- People see, change and remove only their own devices. Adding goes through app.push_register.
create policy own_devices on app.push_devices for all to app_api
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

-- Turns notifications on for this device, for the signed-in user. A device (token) belongs to one
-- person at a time: signing in as someone else on the same phone moves it to them.
create function app.push_register(p_id uuid, p_kind text, p_token text, p_keys jsonb, p_label text, p_prefs jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := app.current_user_id();
  out uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from app.push_devices where token = p_token and user_id <> me;
  -- The same device with a new token (tokens change now and then): replace the old one.
  delete from app.push_devices where id = p_id and user_id = me and token <> p_token;
  insert into app.push_devices (id, user_id, kind, token, keys, label, prefs)
  values (p_id, me, p_kind, p_token, p_keys, coalesce(p_label, ''), coalesce(p_prefs, '{}'))
  on conflict (token) do update
    set keys = excluded.keys, label = excluded.label, prefs = excluded.prefs, seen_at = now()
  returning id into out;
  -- A person keeps at most 20 devices; the ones not seen for longest go first.
  delete from app.push_devices where id in (
    select id from app.push_devices where user_id = me order by seen_at desc offset 20
  );
  return out;
end $$;
revoke all on function app.push_register(uuid, text, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function app.push_register(uuid, text, text, jsonb, text, jsonb) to app_api;

-- Where the sender has read up to. Starts at the newest event, so nothing from before is sent.
create table app.push_cursor (
  id boolean primary key default true check (id),
  last_event uuid
);
insert into app.push_cursor (last_event)
  select id from app.activity_events order by id desc limit 1;
-- An empty table above (a fresh database) still needs the row.
insert into app.push_cursor (last_event) select null where not exists (select 1 from app.push_cursor);
alter table app.push_cursor enable row level security;
revoke all on app.push_cursor from public, anon, authenticated;

-- The next events after the cursor (oldest first), each with what a notification needs, and the
-- cursor moved past them. Users are auth user ids; only members who have signed up are listed.
create function app.push_take(p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cur uuid;
  out jsonb;
  last uuid;
begin
  select last_event into cur from app.push_cursor where id for update;
  with ev as (
    select e.* from app.activity_events e
    where cur is null or e.id > cur
    order by e.id
    limit greatest(1, least(p_limit, 1000))
  ), x as (
    select ev.id, ev.type, ev.group_id, ev.entity_type, ev.entity_id, ev.payload,
      g.name as group_name, am.display_name as actor_name, am.user_id as actor_user,
      coalesce(
        case ev.entity_type
          when 'expense' then ev.entity_id
          when 'suggestion' then (select s.expense_id from app.suggestions s where s.id = ev.entity_id)
          when 'message' then (select m.expense_id from app.messages m where m.id = ev.entity_id)
        end,
        nullif(ev.payload ->> 'expenseId', '')::uuid
      ) as expense_id
    from ev
    join app.groups g on g.id = ev.group_id
    left join app.members am on am.id = ev.actor_member_id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'type', x.type,
      'groupId', x.group_id,
      'groupName', x.group_name,
      'actorName', x.actor_name,
      'actorUser', x.actor_user,
      'entityId', x.entity_id,
      'expenseId', x.expense_id,
      'payload', x.payload,
      'expenseTitle', (
        select v.title from app.expenses xe
        join app.expense_versions v on v.expense_id = xe.id and v.version = xe.current_version
        where xe.id = x.expense_id),
      -- Who owns the expense: whoever added it and whoever paid for it.
      'owners', (
        select coalesce(jsonb_agg(distinct m.user_id), '[]') from app.members m
        where m.user_id is not null and m.id in (
          select xe.created_by from app.expenses xe where xe.id = x.expense_id
          union
          select l.member_id from app.expenses xe
          join app.expense_version_lines l on l.expense_id = xe.id and l.version = xe.current_version
          where xe.id = x.expense_id and l.paid_minor > 0)),
      -- Everyone in it: payers and the people it's split between.
      'people', (
        select coalesce(jsonb_agg(distinct m.user_id), '[]') from app.expenses xe
        join app.expense_version_lines l on l.expense_id = xe.id and l.version = xe.current_version
        join app.members m on m.id = l.member_id
        where xe.id = x.expense_id and m.user_id is not null),
      'author', case x.entity_type
        when 'suggestion' then (select m.user_id from app.suggestions s join app.members m on m.id = s.author_id where s.id = x.entity_id)
        when 'message' then (select m.user_id from app.messages s join app.members m on m.id = s.author_id where s.id = x.entity_id)
      end,
      -- A settle-up chat between two people: both of them.
      'pair', case when x.entity_type = 'message' then (
        select coalesce(jsonb_agg(m.user_id), '[]') from app.messages s
        join app.members m on m.id in (s.pair_a, s.pair_b)
        where s.id = x.entity_id and m.user_id is not null)
      end,
      'pairWith', case when x.entity_type = 'message' then (
        select jsonb_object_agg(m.user_id::text, other.id) from app.messages s
        join app.members m on m.id in (s.pair_a, s.pair_b)
        join app.members other on other.id in (s.pair_a, s.pair_b) and other.id <> m.id
        where s.id = x.entity_id and m.user_id is not null)
      end,
      'from', case when x.entity_type = 'settlement' then (
        select m.user_id from app.settlements s join app.members m on m.id = s.from_member where s.id = x.entity_id)
      end,
      'to', case when x.entity_type = 'settlement' then (
        select m.user_id from app.settlements s join app.members m on m.id = s.to_member where s.id = x.entity_id)
      end
    ) order by x.id), '[]'),
    (array_agg(x.id order by x.id desc))[1]
  into out, last
  from x;
  if last is not null then
    update app.push_cursor set last_event = last where id;
  end if;
  return out;
end $$;
revoke all on function app.push_take(int) from public, anon, authenticated;
grant execute on function app.push_take(int) to app_api;

-- The devices that may hear from us, for these users.
create function app.push_devices_of(p_users uuid[]) returns table (id uuid, user_id uuid, kind text, token text, keys jsonb, prefs jsonb)
language sql security definer set search_path = '' stable as $$
  select d.id, d.user_id, d.kind, d.token, d.keys, d.prefs from app.push_devices d where d.user_id = any (p_users)
$$;
revoke all on function app.push_devices_of(uuid[]) from public, anon, authenticated;
grant execute on function app.push_devices_of(uuid[]) to app_api;

-- Devices the push service says are gone (app removed, notifications blocked, subscription expired).
create function app.push_forget(p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  delete from app.push_devices where id = any (p_ids)
$$;
revoke all on function app.push_forget(uuid[]) from public, anon, authenticated;
grant execute on function app.push_forget(uuid[]) to app_api;

-- A settle-up message is written to the activity log (so the other person can be notified). Like
-- payment steps, it may come from someone who has left the group: settling up continues after leaving.
drop policy activity_write on app.activity_events;
create policy activity_write on app.activity_events for insert to app_api
  with check (
    app.is_active_member(group_id)
    or (entity_type = 'settlement' and app.is_my_member(actor_member_id))
    or (entity_type = 'message' and type = 'message.pair' and app.is_my_member(actor_member_id))
  );
