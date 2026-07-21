-- A symbol can have only one live trade at a time.  A completed one-target
-- signal has status tp1, and a completed two-target signal has status tp2,
-- so those rows must not reserve the symbol any longer.
alter table public.mkr_signals
  add column if not exists open_symbol text;

create or replace function public.mkr_set_open_signal_symbol()
returns trigger
language plpgsql
as $$
begin
  new.open_symbol := case
    when new.status = 'active'
      or (new.status = 'tp1' and new.tp2_price is not null)
      or (new.status = 'tp2' and new.tp3_price is not null)
    then new.symbol
    else null
  end;
  return new;
end;
$$;

drop trigger if exists mkr_set_open_signal_symbol_before_write on public.mkr_signals;
create trigger mkr_set_open_signal_symbol_before_write
before insert or update of symbol, status, tp2_price, tp3_price on public.mkr_signals
for each row execute function public.mkr_set_open_signal_symbol();

update public.mkr_signals
set open_symbol = case
  when status = 'active'
    or (status = 'tp1' and tp2_price is not null)
    or (status = 'tp2' and tp3_price is not null)
  then symbol
  else null
end;

create unique index if not exists mkr_signals_one_open_symbol_idx
  on public.mkr_signals (open_symbol)
  where open_symbol is not null;
