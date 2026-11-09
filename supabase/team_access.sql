-- Team code access, change history and a scan limit.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run (after schema.sql and seed.sql).

-- 1. The shared team account is the only member of the team list.
insert into public.team (email, name) values ('team@risk-register.app', 'Team')
on conflict (email) do nothing;

-- 2. Change history: every edit or delete keeps the previous version, so mistakes can be undone.
create table if not exists public.docs_history (
  hid        bigserial primary key,
  collection text not null,
  id         text not null,
  data       jsonb not null,
  action     text not null,
  changed_at timestamptz not null default now()
);
alter table public.docs_history enable row level security;
drop policy if exists history_read on public.docs_history;
create policy history_read on public.docs_history for select to authenticated using (public.is_team());

create or replace function public.keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.docs_history (collection, id, data, action) values (old.collection, old.id, old.data, lower(tg_op));
  return null;
end $$;
drop trigger if exists docs_history_trg on public.docs;
create trigger docs_history_trg after update or delete on public.docs for each row execute function public.keep_history();

-- 3. At most 6 "Run scan now" requests a day from the app (the scanner itself is not limited).
create or replace function public.limit_scan_requests() returns trigger language plpgsql as $$
begin
  if new.collection = 'scan_requests' and current_user <> 'service_role' then
    if (select count(*) from public.docs where collection = 'scan_requests' and updated_at > now() - interval '1 day') >= 6 then
      raise exception 'Scan limit reached: at most 6 requests a day.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists docs_scan_limit on public.docs;
create trigger docs_scan_limit before insert on public.docs for each row execute function public.limit_scan_requests();
