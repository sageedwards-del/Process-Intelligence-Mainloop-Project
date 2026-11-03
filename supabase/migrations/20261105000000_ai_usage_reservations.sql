-- Pre-launch cost control: every AI request reserves its ai_usage row before
-- the first model call, so parallel requests and requests killed at the
-- function timeout still count, and a site-wide daily cap sits on top of the
-- per-user hourly limit (sign-up is a magic link, so new emails get fresh
-- per-user limits).
--
-- Reserving goes through a SECURITY DEFINER function that takes one
-- transaction-scoped advisory lock, counts, and inserts: two requests at the
-- limit can't both pass. Users still get no UPDATE or DELETE on ai_usage (they
-- could otherwise mark rows refused or move them out of the window); the
-- server finishes a row through finish_ai_request, which only fills in the
-- token counts of the caller's own reserved row.

alter table public.ai_usage
  add column status text not null default 'done'
    check (status in ('reserved', 'done', 'refused'));
comment on column public.ai_usage.status is
  'reserved: counted, model call in progress or killed; done: token counts recorded; refused: over a limit, not counted.';

create index ai_usage_time_idx on public.ai_usage (created_at desc);

-- AI requests across all users in the last 24 hours (refused ones excluded).
-- Definer, because RLS lets a user read only their own rows.
create function public.ai_requests_last_day()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.ai_usage
  where created_at > now() - interval '24 hours'
    and status <> 'refused';
$$;

-- Reserves one request for the signed-in user, or records it as refused.
-- Returns the row id and its status: 'reserved', or 'refused' with the limit
-- that was hit ('hourly' or 'daily'). The limits come from the server; a user
-- calling this directly only adds rows against themselves.
create function public.reserve_ai_request(
  p_workspace_id uuid,
  p_feature text,
  p_model text,
  p_hourly_limit integer,
  p_daily_limit integer
)
returns table (id bigint, status text, limit_hit text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hourly integer;
  daily integer;
  hit text;
  new_id bigint;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  -- One reservation at a time, site-wide, until this transaction commits; the
  -- counts below then see every earlier reservation. Cheap at demo volume.
  perform pg_advisory_xact_lock(hashtext('public.reserve_ai_request'));

  select count(*)::int into hourly
  from public.ai_usage u
  where u.user_id = uid
    and u.created_at > clock_timestamp() - interval '1 hour'
    and u.status <> 'refused';
  daily := public.ai_requests_last_day();

  hit := case
    when hourly >= p_hourly_limit then 'hourly'
    when daily >= p_daily_limit then 'daily'
  end;

  insert into public.ai_usage (user_id, workspace_id, feature, model, status, created_at)
  values (uid, p_workspace_id, p_feature, p_model,
          case when hit is null then 'reserved' else 'refused' end, clock_timestamp())
  returning ai_usage.id into new_id;

  return query select new_id, case when hit is null then 'reserved' else 'refused' end, hit;
end;
$$;

-- Records the token counts of the caller's own reserved row.
create function public.finish_ai_request(p_id bigint, p_input_tokens integer, p_output_tokens integer)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.ai_usage
  set input_tokens = greatest(p_input_tokens, 0),
      output_tokens = greatest(p_output_tokens, 0),
      status = 'done'
  where id = p_id
    and user_id = (select auth.uid())
    and status = 'reserved';
$$;

revoke execute on function public.ai_requests_last_day() from public, anon;
revoke execute on function public.reserve_ai_request(uuid, text, text, integer, integer) from public, anon;
revoke execute on function public.finish_ai_request(bigint, integer, integer) from public, anon;
grant execute on function public.ai_requests_last_day() to authenticated;
grant execute on function public.reserve_ai_request(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.finish_ai_request(bigint, integer, integer) to authenticated;
