alter table public.mkr_signals
  add column if not exists tp2_risk_multiple numeric,
  add column if not exists tp3_price numeric;

alter table public.mkr_signals
  drop constraint if exists mkr_signals_status_check;

alter table public.mkr_signals
  add constraint mkr_signals_status_check
  check (status in ('active', 'tp1', 'tp2', 'tp3', 'stop', 'expired', 'ambiguous'));

alter table public.mkr_signal_events
  drop constraint if exists mkr_signal_events_type_check;

alter table public.mkr_signal_events
  add constraint mkr_signal_events_type_check
  check (type in ('detected', 'tp1', 'tp2', 'tp3', 'stop', 'expired', 'ambiguous'));
