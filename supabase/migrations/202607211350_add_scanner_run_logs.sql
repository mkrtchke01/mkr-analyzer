create table if not exists public.mkr_scanner_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  scanned_count integer not null default 0,
  plans_found_count integer not null default 0,
  created_count integer not null default 0,
  market_error_count integer not null default 0,
  monitor_error_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  error_message text
);

create table if not exists public.mkr_scanner_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.mkr_scanner_runs(id) on delete cascade,
  phase text not null check (phase in ('monitor', 'market', 'persistence', 'run')),
  symbol text,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mkr_scanner_runs_started_idx
  on public.mkr_scanner_runs (started_at desc);

create index if not exists mkr_scanner_errors_run_idx
  on public.mkr_scanner_errors (run_id, created_at desc);

alter table public.mkr_scanner_runs enable row level security;
alter table public.mkr_scanner_errors enable row level security;
