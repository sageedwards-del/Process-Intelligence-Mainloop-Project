-- Throughline core schema.
--
-- Tenancy model: every row belongs to a workspace. Access is decided by
-- membership in that workspace (row-level security on every table, plus
-- matching Storage policies keyed on the object path "<workspace_id>/...").
--
-- Roles:  owner   – everything, including deleting datasets and managing members
--         analyst – upload data, edit rules / cost models, run AI analyses
--         viewer  – read-only (used for the public demo account)

create type public.workspace_role as enum ('owner', 'analyst', 'viewer');
create type public.dataset_status as enum ('uploaded', 'parsing', 'ready', 'error');
create type public.dataset_format as enum ('csv', 'xlsx', 'xes');
create type public.ai_output_kind as enum ('findings', 'memo');

-- ---------------------------------------------------------------------------
-- Workspaces & membership
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.workspace_role not null default 'analyst',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Membership checks are SECURITY DEFINER so policies on workspace_members can
-- use them without recursing into their own RLS.
create function public.has_workspace_role(ws uuid, roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

create function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_workspace_role(ws, array['owner', 'analyst', 'viewer']::public.workspace_role[]);
$$;

create function public.can_edit_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_workspace_role(ws, array['owner', 'analyst']::public.workspace_role[]);
$$;

revoke execute on function public.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.can_edit_workspace(uuid) from public, anon;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;

-- Every new user gets a personal workspace they own.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  insert into public.workspaces (name, created_by)
  values (coalesce(split_part(new.email, '@', 1), 'My') || '''s workspace', new.id)
  returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Datasets & events
-- ---------------------------------------------------------------------------

create table public.datasets (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 200),
  description     text,
  source_format   public.dataset_format not null,
  source_path     text,          -- raw upload in bucket "raw-uploads"
  snapshot_path   text,          -- compact encoded log in bucket "snapshots"
  -- { caseId, activity, timestamp, resource?, attributes: string[], timestampFormat? }
  column_mapping  jsonb not null default '{}'::jsonb,
  status          public.dataset_status not null default 'uploaded',
  error           text,
  -- LogSummary from the engine, cached for list views
  stats           jsonb,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index datasets_workspace_idx on public.datasets (workspace_id, created_at desc);

-- workspace_id is denormalized onto events so RLS is a cheap column check
-- instead of a join per row. The composite FK keeps it consistent.
alter table public.datasets add constraint datasets_id_workspace_key unique (id, workspace_id);

create table public.events (
  id            bigint generated always as identity primary key,
  dataset_id    uuid not null,
  workspace_id  uuid not null,
  case_id       text not null,
  activity      text not null,
  ts            timestamptz not null,
  resource      text,
  attrs         jsonb not null default '{}'::jsonb,
  foreign key (dataset_id, workspace_id) references public.datasets (id, workspace_id) on delete cascade
);
create index events_dataset_case_ts_idx on public.events (dataset_id, case_id, ts);
create index events_dataset_activity_idx on public.events (dataset_id, activity);
create index events_workspace_idx on public.events (workspace_id);

-- ---------------------------------------------------------------------------
-- Analysis configuration & outputs
-- ---------------------------------------------------------------------------

-- One cost model per dataset (engine CostModel as JSON).
create table public.cost_models (
  dataset_id    uuid primary key,
  workspace_id  uuid not null,
  model         jsonb not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null default auth.uid(),
  foreign key (dataset_id, workspace_id) references public.datasets (id, workspace_id) on delete cascade
);

-- Business rules (engine Rule as JSON).
create table public.rules (
  id            uuid primary key default gen_random_uuid(),
  dataset_id    uuid not null,
  workspace_id  uuid not null,
  definition    jsonb not null check (definition ? 'type' and definition ? 'name'),
  enabled       boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (dataset_id, workspace_id) references public.datasets (id, workspace_id) on delete cascade
);
create index rules_dataset_idx on public.rules (dataset_id);

-- Saved filter + map settings ("views").
create table public.saved_views (
  id            uuid primary key default gen_random_uuid(),
  dataset_id    uuid not null,
  workspace_id  uuid not null,
  name          text not null check (char_length(name) between 1 and 120),
  filters       jsonb not null default '[]'::jsonb,
  map_options   jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (dataset_id, workspace_id) references public.datasets (id, workspace_id) on delete cascade
);
create index saved_views_dataset_idx on public.saved_views (dataset_id);

-- Claude outputs, cached per dataset + filter state. `input_metrics` is the
-- exact bundle sent to the model; `grounding` records which citations checked out.
create table public.ai_outputs (
  id             uuid primary key default gen_random_uuid(),
  dataset_id     uuid not null,
  workspace_id   uuid not null,
  kind           public.ai_output_kind not null,
  filter_hash    text not null,
  model          text not null,
  input_metrics  jsonb not null,
  output         jsonb not null,
  grounding      jsonb,
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  foreign key (dataset_id, workspace_id) references public.datasets (id, workspace_id) on delete cascade,
  unique (dataset_id, kind, filter_hash)
);

-- Per-user AI usage, for rate limiting and cost visibility. Written by the server only.
create table public.ai_usage (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  feature        text not null,
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  created_at     timestamptz not null default now()
);
create index ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger datasets_touch before update on public.datasets
  for each row execute function public.touch_updated_at();
create trigger cost_models_touch before update on public.cost_models
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.datasets          enable row level security;
alter table public.events            enable row level security;
alter table public.cost_models       enable row level security;
alter table public.rules             enable row level security;
alter table public.saved_views       enable row level security;
alter table public.ai_outputs        enable row level security;
alter table public.ai_usage          enable row level security;

-- workspaces
create policy "members read workspace" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "owners rename workspace" on public.workspaces
  for update to authenticated
  using (public.has_workspace_role(id, array['owner']::public.workspace_role[]))
  with check (public.has_workspace_role(id, array['owner']::public.workspace_role[]));

-- workspace_members
create policy "members read membership" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "owners manage membership" on public.workspace_members
  for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]));

-- datasets
create policy "members read datasets" on public.datasets
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "editors create datasets" on public.datasets
  for insert to authenticated with check (public.can_edit_workspace(workspace_id));
create policy "editors update datasets" on public.datasets
  for update to authenticated
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));
create policy "owners delete datasets" on public.datasets
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]));

-- Child tables share one pattern: members read, editors write.
do $$
declare
  t text;
begin
  foreach t in array array['events', 'cost_models', 'rules', 'saved_views', 'ai_outputs'] loop
    execute format(
      'create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_workspace_member(workspace_id))', t);
    execute format(
      'create policy "editors insert %1$s" on public.%1$I for insert to authenticated with check (public.can_edit_workspace(workspace_id))', t);
    execute format(
      'create policy "editors update %1$s" on public.%1$I for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id))', t);
    execute format(
      'create policy "editors delete %1$s" on public.%1$I for delete to authenticated using (public.can_edit_workspace(workspace_id))', t);
  end loop;
end;
$$;

-- ai_usage: users may read their own usage; inserts happen with the service role.
create policy "users read own usage" on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: private buckets, objects stored under "<workspace_id>/<dataset_id>/..."
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('raw-uploads', 'raw-uploads', false, 104857600),  -- 100 MB
  ('snapshots',   'snapshots',   false, 104857600)
on conflict (id) do nothing;

-- Parse the workspace id from the first path segment without ever throwing on
-- malformed paths (a failed uuid cast inside a policy would error the request).
create function public.storage_path_workspace(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  head text := split_part(object_name, '/', 1);
begin
  if head ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return head::uuid;
  end if;
  return null;
end;
$$;

create policy "members read workspace objects" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('raw-uploads', 'snapshots')
    and public.is_workspace_member(public.storage_path_workspace(name))
  );

create policy "editors upload workspace objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('raw-uploads', 'snapshots')
    and public.can_edit_workspace(public.storage_path_workspace(name))
  );

create policy "editors replace workspace objects" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('raw-uploads', 'snapshots')
    and public.can_edit_workspace(public.storage_path_workspace(name))
  );

create policy "editors delete workspace objects" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('raw-uploads', 'snapshots')
    and public.can_edit_workspace(public.storage_path_workspace(name))
  );
