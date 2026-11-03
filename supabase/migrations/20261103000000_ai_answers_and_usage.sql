-- M5: Claude's answers to "Ask" questions are stored next to findings and
-- memos, and the server records each AI call in ai_usage as the signed-in
-- user (no service-role key in the web app), which the per-user rate limit reads.

alter type public.ai_output_kind add value if not exists 'answer';

-- A user may record usage only for themselves, in a workspace they belong to.
-- Rows can't be changed or deleted afterwards, so a user can't reset their limit.
create policy "users record own usage" on public.ai_usage
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));
