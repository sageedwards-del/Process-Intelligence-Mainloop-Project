-- How a dataset's waits are classified (engine AnalysisSettings, parsed by
-- parseAnalysisSettings): steps that happen on planned dates, resources that
-- are systems, the normal-wait percentile and an optional working calendar.
-- RLS is unchanged: the datasets policies already let members read and
-- editors update.

alter table public.datasets
  add column analysis_settings jsonb not null default '{}'::jsonb;
