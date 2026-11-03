-- Findings are replaced by insights: a process summary plus recommended actions (ADR 0005, amended).
-- Old 'findings' rows stay as they are; the app no longer reads them.
alter type public.ai_output_kind add value if not exists 'insights';
