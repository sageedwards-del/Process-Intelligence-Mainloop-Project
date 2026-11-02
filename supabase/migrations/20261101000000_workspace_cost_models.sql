-- Cost settings per workspace.
--
-- cost_models held one row per dataset. A workspace now also gets one default
-- row (dataset_id is null) that every uploaded dataset in it uses; per-dataset
-- rows stay possible for later overrides. RLS policies are unchanged: they key
-- on workspace_id ("members read, editors write").

alter table public.cost_models drop constraint cost_models_pkey;
alter table public.cost_models alter column dataset_id drop not null;
alter table public.cost_models add column id uuid not null default gen_random_uuid() primary key;

-- One row per dataset, and one workspace default.
create unique index cost_models_dataset_key on public.cost_models (dataset_id) where dataset_id is not null;
create unique index cost_models_workspace_default_key on public.cost_models (workspace_id) where dataset_id is null;

-- The composite FK to datasets is MATCH SIMPLE, so a null dataset_id skips it;
-- keep the workspace itself referenced.
alter table public.cost_models
  add constraint cost_models_workspace_fkey foreign key (workspace_id) references public.workspaces (id) on delete cascade;
