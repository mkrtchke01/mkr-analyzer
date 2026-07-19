# mkr-analyzer

## Persistent signals

The signal scanner runs in a Vercel Function at `POST /api/signals/scan`. It accepts only requests with `Authorization: Bearer <CRON_SECRET>` and uses the server-side Supabase variables provisioned by the Vercel integration.

Before enabling the cron job, open Supabase Studio → SQL Editor and run [the signal-history migration](supabase/migrations/202607191830_create_signal_history.sql). Then deploy the project and perform a manual authenticated request to `/api/signals/scan`. A successful response contains `{ "ok": true }`.

The scanner creates a signal only after a 5m candle has closed and stores an immutable SVG chart snapshot. It monitors saved signals after each subsequent closed candle. If a candle touches both a stop and a target, it closes the signal as `ambiguous` instead of inventing the order of fills.
