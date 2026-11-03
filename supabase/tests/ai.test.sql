-- AI outputs and usage: members read, editors write; users record only their own usage.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol@test.local'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dan@test.local');
select set_config('test.ws_carol',
  (select workspace_id::text from public.workspace_members where user_id = '33333333-3333-3333-3333-333333333333'), true);
select set_config('test.ws_dan',
  (select workspace_id::text from public.workspace_members where user_id = '44444444-4444-4444-4444-444444444444'), true);
-- Dan views Carol's workspace.
insert into public.workspace_members (workspace_id, user_id, role)
values (current_setting('test.ws_carol')::uuid, '44444444-4444-4444-4444-444444444444', 'viewer');

-- ---- as Carol (owner) ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
insert into public.datasets (id, workspace_id, name, source_format)
values ('bbbbbbbb-0000-0000-0000-000000000001', current_setting('test.ws_carol')::uuid, 'Carol invoices', 'csv');
select lives_ok(
  $$ insert into public.ai_outputs (dataset_id, workspace_id, kind, filter_hash, model, input_metrics, output)
     values ('bbbbbbbb-0000-0000-0000-000000000001', current_setting('test.ws_carol')::uuid, 'answer', 'q1', 'm', '{}', '{}') $$,
  'an editor can store an answer'
);
select lives_ok(
  $$ insert into public.ai_outputs (dataset_id, workspace_id, kind, filter_hash, model, input_metrics, output)
     values ('bbbbbbbb-0000-0000-0000-000000000001', current_setting('test.ws_carol')::uuid, 'insights', 'h1', 'm', '{}', '{}') $$,
  'an editor can store insights'
);
select lives_ok(
  $$ insert into public.ai_usage (user_id, workspace_id, feature, model)
     values ('33333333-3333-3333-3333-333333333333', current_setting('test.ws_carol')::uuid, 'ask', 'm') $$,
  'a user records their own usage'
);
select throws_ok(
  $$ insert into public.ai_usage (user_id, workspace_id, feature, model)
     values ('44444444-4444-4444-4444-444444444444', current_setting('test.ws_carol')::uuid, 'ask', 'm') $$,
  '42501', null,
  'a user cannot record usage for someone else'
);
select throws_ok(
  $$ insert into public.ai_usage (user_id, workspace_id, feature, model)
     values ('33333333-3333-3333-3333-333333333333', current_setting('test.ws_dan')::uuid, 'ask', 'm') $$,
  '42501', null,
  'a user cannot record usage in a workspace they are not in'
);
delete from public.ai_usage where user_id = '33333333-3333-3333-3333-333333333333';
select is((select count(*)::int from public.ai_usage), 1, 'usage rows cannot be deleted, so the rate limit holds');

-- ---- as Dan (viewer) -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is((select count(*)::int from public.ai_outputs), 2, 'a viewer reads the workspace''s AI outputs');
select throws_ok(
  $$ insert into public.ai_outputs (dataset_id, workspace_id, kind, filter_hash, model, input_metrics, output)
     values ('bbbbbbbb-0000-0000-0000-000000000001', current_setting('test.ws_carol')::uuid, 'memo', 'x', 'm', '{}', '{}') $$,
  '42501', null,
  'a viewer cannot write AI outputs'
);
select is((select count(*)::int from public.ai_usage), 0, 'a user reads only their own usage');

select * from finish();
rollback;
