# mkr-analyzer

## Persistent signals

The signal scanner runs in a Vercel Function at `POST /api/signals/scan`. It accepts only requests with `Authorization: Bearer <CRON_SECRET>` and uses the server-side Supabase variables provisioned by the Vercel integration. Signal generation is currently disabled because no strategies are active.

Before enabling the external CronJob, open Supabase Studio → SQL Editor and run [the signal-history migration](supabase/migrations/202607191830_create_signal_history.sql). Then deploy the project and perform a manual authenticated request to `/api/signals/scan`. A successful response contains `{ "ok": true }`. Configure the external CronJob to call this endpoint every five minutes with `Authorization: Bearer <CRON_SECRET>`.

When strategies are enabled, the scanner stores immutable SVG snapshots of confirmed signals. The UI shows saved signals and refreshes the open journal every five seconds.
