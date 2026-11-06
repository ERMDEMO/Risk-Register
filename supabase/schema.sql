-- Emerging Risk Register: database for the browser app.
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Then run seed.sql to load the current register.

-- 1. Team members. Only people listed here can read or change the register.
create table if not exists public.team (
  email text primary key,
  name  text not null default '',
  added_at timestamptz not null default now()
);
alter table public.team enable row level security;

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team t where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

drop policy if exists team_read on public.team;
create policy team_read on public.team for select to authenticated using (public.is_team());

-- 2. The register. One table holds every collection the page uses
--    (risks, signals, sources, log, snapshots, meta, scan_requests).
create table if not exists public.docs (
  collection text not null check (collection in ('risks','signals','sources','log','snapshots','meta','scan_requests')),
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default coalesce(auth.jwt() ->> 'email', 'system'),
  primary key (collection, id)
);
create index if not exists docs_collection_idx on public.docs (collection);
alter table public.docs enable row level security;

create or replace function public.touch_docs() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', 'system');
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs for each row execute function public.touch_docs();

-- Team members can read everything.
drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated using (public.is_team());

-- Team members can add signals, risks, sources, log entries and scan requests,
-- and can change risks, signals, sources and the scan record.
-- Snapshots are written only by the scanner (it uses the service key, which bypasses these rules).
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated
  with check (public.is_team() and collection in ('risks','signals','sources','log','meta','scan_requests'));

drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated
  using (public.is_team() and collection in ('risks','signals','sources','meta'))
  with check (public.is_team() and collection in ('risks','signals','sources','meta'));

-- Only sources can be deleted, as in the original page.
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated
  using (public.is_team() and collection = 'sources');

-- 3. Live updates: send changes to open pages.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
