-- Row-level security tests. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Two users; the signup trigger gives each a personal workspace.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@test.local'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@test.local');

select is(
  -- Only this test's users: a local database may already hold real sign-ups.
  (select count(*)::int from public.workspace_members
    where role = 'owner'
      and user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2,
  'signup trigger creates an owned workspace per user'
);

-- Stash Alice's workspace id while still superuser.
select set_config('test.ws_alice',
  (select workspace_id::text from public.workspace_members where user_id = '11111111-1111-1111-1111-111111111111'), true);

-- ---- as Alice --------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into public.datasets (id, workspace_id, name, source_format)
values ('aaaaaaaa-0000-0000-0000-000000000001', current_setting('test.ws_alice')::uuid, 'Alice invoices', 'csv');

insert into public.events (dataset_id, workspace_id, case_id, activity, ts)
values ('aaaaaaaa-0000-0000-0000-000000000001', current_setting('test.ws_alice')::uuid, 'c1', 'Receive Invoice', now());

select is((select count(*)::int from public.datasets), 1, 'Alice sees her dataset');
select is((select count(*)::int from public.events), 1, 'Alice sees her events');
select is((select count(*)::int from public.workspaces), 1, 'Alice sees only her workspace');

-- Analysis settings live on the dataset row: an editor can set them.
update public.datasets set analysis_settings = '{"scheduledActivities":["Start trip"]}'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select analysis_settings->'scheduledActivities'->>0 from public.datasets where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Start trip',
  'an editor can set a dataset''s analysis settings'
);

-- Workspace cost settings: one default row (no dataset) per workspace.
insert into public.cost_models (workspace_id, model)
values (current_setting('test.ws_alice')::uuid, '{"currency":"EUR","hourlyRate":70}');
select throws_ok(
  $$ insert into public.cost_models (workspace_id, model) values (current_setting('test.ws_alice')::uuid, '{}') $$,
  '23505',
  null,
  'a workspace has at most one default cost model'
);

-- ---- as Bob ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is((select count(*)::int from public.datasets), 0, 'Bob cannot see Alice''s dataset');
select is((select count(*)::int from public.events), 0, 'Bob cannot see Alice''s events');
select is((select count(*)::int from public.cost_models), 0, 'Bob cannot see Alice''s cost settings');

select throws_ok(
  $$ insert into public.datasets (workspace_id, name, source_format)
     values (current_setting('test.ws_alice')::uuid, 'sneaky', 'csv') $$,
  '42501',
  null,
  'Bob cannot create datasets in Alice''s workspace'
);

update public.datasets set name = 'hijacked', analysis_settings = '{}' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.events where dataset_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ---- viewer role -----------------------------------------------------------
reset role;
insert into public.workspace_members (workspace_id, user_id, role)
values (current_setting('test.ws_alice')::uuid, '22222222-2222-2222-2222-222222222222', 'viewer');

select is(
  (select name from public.datasets where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Alice invoices',
  'Bob''s update as a non-member changed nothing'
);
select is(
  (select count(*)::int from public.events where dataset_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'Bob''s delete as a non-member removed nothing'
);
select is(
  (select analysis_settings->'scheduledActivities'->>0 from public.datasets where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Start trip',
  'a non-member cannot change analysis settings'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is((select count(*)::int from public.datasets), 1, 'a viewer can read the shared workspace');
select throws_ok(
  $$ insert into public.rules (dataset_id, workspace_id, definition)
     values ('aaaaaaaa-0000-0000-0000-000000000001', current_setting('test.ws_alice')::uuid, '{"type":"sla","name":"x"}') $$,
  '42501',
  null,
  'a viewer cannot write rules'
);
update public.cost_models set model = '{"hourlyRate":1}' where workspace_id = current_setting('test.ws_alice')::uuid;
update public.datasets set analysis_settings = '{}' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
select is(
  (select analysis_settings->'scheduledActivities'->>0 from public.datasets where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Start trip',
  'a viewer cannot change analysis settings'
);
select is(
  (select model->>'hourlyRate' from public.cost_models where workspace_id = current_setting('test.ws_alice')::uuid),
  '70',
  'a viewer cannot change cost settings'
);

select * from finish();
rollback;
