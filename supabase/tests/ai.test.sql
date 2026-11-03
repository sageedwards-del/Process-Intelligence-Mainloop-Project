-- AI outputs and usage: members read, editors write; users record only their own usage;
-- requests are reserved under the hourly and site-wide daily limits.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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

-- Site-wide AI requests before this test (a local database may hold real usage).
select set_config('test.baseline', public.ai_requests_last_day()::text, true);

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

-- Reserving a request before calling Claude.
select is(
  (select status from public.reserve_ai_request(current_setting('test.ws_carol')::uuid, 'ask', 'm', 30, 100000)),
  'reserved',
  'a request under both limits is reserved'
);
select set_config('test.reserved',
  (select id::text from public.ai_usage where status = 'reserved'), true);
select is(
  (select limit_hit from public.reserve_ai_request(current_setting('test.ws_carol')::uuid, 'ask', 'm', 2, 100000)),
  'hourly',
  'a request over the user''s hourly limit is refused'
);
select is(
  (select limit_hit from public.reserve_ai_request(current_setting('test.ws_carol')::uuid, 'ask', 'm', 30, public.ai_requests_last_day())),
  'daily',
  'a request over the site-wide daily limit is refused'
);
select throws_ok(
  $$ select * from public.reserve_ai_request(current_setting('test.ws_dan')::uuid, 'ask', 'm', 30, 100000) $$,
  '42501', null,
  'a user cannot reserve a request in a workspace they are not in'
);
update public.ai_usage set status = 'refused', created_at = now() - interval '2 days';
select is((select count(*)::int from public.ai_usage where status <> 'refused'), 2,
  'users cannot update usage rows to escape the limits');

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
select is(public.ai_requests_last_day(), current_setting('test.baseline')::int + 2,
  'the daily count covers every user''s requests, refused ones excluded');
select public.finish_ai_request(current_setting('test.reserved')::bigint, 999, 999);

-- ---- back to Carol ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select status from public.ai_usage where id = current_setting('test.reserved')::bigint), 'reserved',
  'another user cannot finish my reserved request');
select public.finish_ai_request(current_setting('test.reserved')::bigint, 1200, 340);
select is(
  (select format('%s/%s/%s', input_tokens, output_tokens, status) from public.ai_usage where id = current_setting('test.reserved')::bigint),
  '1200/340/done',
  'finishing a request records its tokens'
);

-- ---- signed out ------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.ai_requests_last_day() $$, '42501', null, 'signed-out visitors cannot read the daily count');

select * from finish();
rollback;
