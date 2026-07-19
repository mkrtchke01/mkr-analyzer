alter table public.mkr_signals
  add column if not exists setup_type text not null default 'trend-reclaim';

create index if not exists mkr_signals_setup_type_idx
  on public.mkr_signals (setup_type, detected_at desc);
