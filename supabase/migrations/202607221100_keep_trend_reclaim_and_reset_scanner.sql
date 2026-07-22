-- Reset the journal and account state before restarting the scanner with its
-- single supported setup.  Account balance and strategy statistics are
-- calculated from these records, so both start from zero after this migration.
delete from storage.objects where bucket_id = 'signal-snapshots';
delete from public.mkr_scanner_errors;
delete from public.mkr_scanner_runs;
delete from public.mkr_signals;

alter table public.mkr_signals
  drop constraint if exists mkr_signals_setup_type_check;

alter table public.mkr_signals
  add constraint mkr_signals_setup_type_check
  check (setup_type = 'trend-reclaim');
