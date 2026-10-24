-- Receipts and bills attached to an expense: photos (JPEG, PNG, WebP) and PDFs.
-- The file itself lives in storage (Supabase Storage in production, a folder in local dev), written
-- and read only by the API; this table is the record of who attached what, and when.
-- Everyone who can see the expense can see its receipts (they are the proof behind the numbers).

create table app.receipts (
  id uuid primary key,
  group_id uuid not null references app.groups (id),
  expense_id uuid not null,
  uploaded_by uuid not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size int not null check (byte_size between 1 and 10485760),
  -- Of the stored bytes: the same photo attached twice is spotted (a likely duplicate expense).
  sha256 bytea not null check (octet_length(sha256) = 32),
  storage_key text not null unique check (char_length(storage_key) between 1 and 300),
  width int check (width between 1 and 20000),
  height int check (height between 1 and 20000),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz not null default now(),
  foreign key (group_id, expense_id) references app.expenses (group_id, id),
  foreign key (group_id, uploaded_by) references app.members (group_id, id),
  foreign key (group_id, deleted_by) references app.members (group_id, id),
  check ((deleted_at is null) = (deleted_by is null))
);
create index receipts_expense on app.receipts (expense_id, created_at) where deleted_at is null;
create index receipts_hash on app.receipts (group_id, sha256) where deleted_at is null;

-- Nothing but a soft delete may change once written.
create function app.receipts_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.group_id, new.expense_id, new.uploaded_by, new.content_type, new.byte_size, new.sha256, new.storage_key,
      new.width, new.height, new.created_at)
     is distinct from
     (old.id, old.group_id, old.expense_id, old.uploaded_by, old.content_type, old.byte_size, old.sha256, old.storage_key,
      old.width, old.height, old.created_at) then
    raise exception 'receipts: only deleted_at and deleted_by can change' using errcode = '23514';
  end if;
  if old.deleted_at is not null then
    raise exception 'receipts: already deleted' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger receipts_guard before update on app.receipts for each row execute function app.receipts_guard();
revoke all on function app.receipts_guard() from public, anon, authenticated;
create trigger receipts_no_delete before delete on app.receipts for each row execute function app.reject_change();

alter table app.receipts enable row level security;
create policy receipts_read on app.receipts for select to app_api
  using (app.can_read_expense(group_id, expense_id));
create policy receipts_add on app.receipts for insert to app_api
  with check (app.is_my_member(uploaded_by) and app.is_active_member(group_id) and app.can_read_expense(group_id, expense_id));
create policy receipts_remove on app.receipts for update to app_api
  using (app.is_active_member(group_id) and app.can_read_expense(group_id, expense_id))
  with check (app.is_active_member(group_id));
create policy worker_receipts on app.receipts for select to app_worker using (true);

grant select, insert on app.receipts to app_api;
grant update (deleted_at, deleted_by) on app.receipts to app_api;
grant select on app.receipts to app_worker;
