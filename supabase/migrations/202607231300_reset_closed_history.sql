-- Start the account from $100 by removing all closed trades and their
-- immutable snapshots. Open records, if any, remain available for monitoring.
delete from storage.objects
where bucket_id = 'signal-snapshots'
  and name in (
    select snapshot_path
    from public.mkr_signals
    where snapshot_path is not null
      and (
        status in ('tp3', 'stop', 'expired', 'ambiguous')
        or (status = 'tp1' and tp2_price is null)
        or (status = 'tp2' and tp3_price is null)
      )
  );

delete from public.mkr_signals
where status in ('tp3', 'stop', 'expired', 'ambiguous')
   or (status = 'tp1' and tp2_price is null)
   or (status = 'tp2' and tp3_price is null);
