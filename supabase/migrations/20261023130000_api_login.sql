-- The login the API connects with. It has no privileges of its own (noinherit): every request
-- runs `set local role app_api`, so RLS always applies. It starts without a password (nologin);
-- `npm run db:api-login` generates one locally and has you set it in the SQL editor, so the
-- password never appears in git, chat or this file.
do $$
begin
  if not exists (select from pg_roles where rolname = 'api_login') then
    create role api_login nologin noinherit;
  end if;
end
$$;
grant app_api to api_login;
