# mkr-analyzer

## Persistent signals

The signal scanner runs in a Vercel Function at `POST /api/signals/scan`. It accepts only requests with `Authorization: Bearer <CRON_SECRET>` and uses the server-side Supabase variables provisioned by the Vercel integration.

Before enabling the external CronJob, open Supabase Studio → SQL Editor and run [the signal-history migration](supabase/migrations/202607191830_create_signal_history.sql). Then deploy the project and perform a manual authenticated request to `/api/signals/scan`. A successful response contains `{ "ok": true }`. Configure the external CronJob to call this endpoint every five minutes with `Authorization: Bearer <CRON_SECRET>`.

The scanner creates a signal only after a 5m candle has closed and stores an immutable SVG chart snapshot. The UI shows only these saved signals (and refreshes the open journal every five seconds), so a displayed setup cannot disappear because of a later recalculation. The scanner monitors saved signals after each subsequent closed candle and moves them from open to closed after TP2, stop, expiry, or an ambiguous candle that touches both a stop and a target.
