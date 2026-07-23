-- Disable all signal strategies and clear every record that contributes to
-- the journal, strategy statistics, or account balance.
delete from storage.objects where bucket_id = 'signal-snapshots';
delete from public.mkr_scanner_errors;
delete from public.mkr_scanner_runs;
delete from public.mkr_signals;
