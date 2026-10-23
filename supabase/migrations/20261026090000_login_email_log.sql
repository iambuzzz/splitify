-- Sign-in emails are sent by our API (code + button, through Resend), so their rate limits live here.
-- Limits: one email per address per minute, five per address per hour, twenty per network (IP) per hour.
-- Addresses and IPs are stored only as hashes made by the API, and rows are dropped after a day.

create table app.login_email_log (
  id bigint generated always as identity primary key,
  email_hash bytea not null,
  ip_hash bytea not null,
  created_at timestamptz not null default now()
);
create index login_email_log_email on app.login_email_log (email_hash, created_at);
create index login_email_log_ip on app.login_email_log (ip_hash, created_at);
create index login_email_log_created on app.login_email_log (created_at);
-- No policies: only the function below reads or writes it.
alter table app.login_email_log enable row level security;
revoke all on app.login_email_log from public, anon, authenticated;

-- Takes one sign-in email from the allowance, or says which limit stops it:
-- 'ok', 'wait_minute', 'email_hour' or 'ip_hour'. Requests for one address run one at a time.
create function app.claim_login_email(p_email bytea, p_ip bytea) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('login:' || encode(p_email, 'hex'), 0));
  delete from app.login_email_log where created_at < now() - interval '1 day';
  if exists (select 1 from app.login_email_log where email_hash = p_email and created_at > now() - interval '1 minute') then
    return 'wait_minute';
  end if;
  if (select count(*) from app.login_email_log where email_hash = p_email and created_at > now() - interval '1 hour') >= 5 then
    return 'email_hour';
  end if;
  if (select count(*) from app.login_email_log where ip_hash = p_ip and created_at > now() - interval '1 hour') >= 20 then
    return 'ip_hour';
  end if;
  insert into app.login_email_log (email_hash, ip_hash) values (p_email, p_ip);
  return 'ok';
end $$;
revoke all on function app.claim_login_email(bytea, bytea) from public, anon, authenticated;
grant execute on function app.claim_login_email(bytea, bytea) to app_api;
