create table if not exists public.signals (
  id uuid primary key,
  fingerprint text not null unique,
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  status text not null check (status in ('active', 'tp1', 'tp2', 'stop', 'expired', 'ambiguous')),
  detected_at timestamptz not null,
  detected_candle_time bigint not null,
  last_checked_candle_time bigint not null,
  expires_at timestamptz not null,
  closed_at timestamptz,
  entry_price numeric not null,
  initial_stop_price numeric not null,
  stop_price numeric not null,
  tp1_price numeric not null,
  tp2_price numeric not null,
  tp1_risk_multiple numeric not null,
  last_price numeric not null,
  outcome_r numeric,
  trend_snapshot jsonb not null,
  plan_snapshot jsonb not null,
  candles_snapshot jsonb not null,
  snapshot_path text,
  created_at timestamptz not null default now()
);

create index if not exists signals_open_status_idx on public.signals (status, detected_at desc);
create index if not exists signals_symbol_idx on public.signals (symbol, detected_at desc);

create table if not exists public.signal_events (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.signals(id) on delete cascade,
  type text not null check (type in ('detected', 'tp1', 'tp2', 'stop', 'expired', 'ambiguous')),
  price numeric not null,
  candle_time bigint not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists signal_events_signal_idx on public.signal_events (signal_id, candle_time);

alter table public.signals enable row level security;
alter table public.signal_events enable row level security;

insert into storage.buckets (id, name, public)
values ('signal-snapshots', 'signal-snapshots', true)
on conflict (id) do nothing;

create policy "Public signal snapshot read"
on storage.objects for select to public
using (bucket_id = 'signal-snapshots');
