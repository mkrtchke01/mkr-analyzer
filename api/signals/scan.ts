import { randomUUID } from 'node:crypto'
import { getCandles, getMarkets, type Candle, type Timeframe } from '../../src/lib/bybit'
import { createSignalSnapshot } from '../../src/lib/signalSnapshot'
import { evaluateSignalCandle, type ManagedSignal } from '../../src/lib/signalLifecycle'
import { analyzeTrend, calculateTradePlan, getOverallTrend } from '../../src/lib/trend'
import { isAuthorizedCronRequest, supabaseRequest, uploadSnapshot } from '../_lib/supabase'

const ANALYSIS_TIMEFRAMES: Timeframe[] = ['4h', '1h', '15m', '5m']
const MAX_CONCURRENCY = 5

type StoredSignal = {
  id: string
  symbol: string
  side: 'long' | 'short'
  status: 'active' | 'tp1'
  entry_price: string
  stop_price: string
  initial_stop_price: string
  tp1_price: string
  tp2_price: string
  tp1_risk_multiple: string
  detected_candle_time: number
  last_checked_candle_time: number
  expires_at: string
}

const runWithConcurrency = async <T>(items: T[], task: (item: T) => Promise<void>) => {
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, worker))
}

const closedCandles = (candles: Candle[]) => candles.slice(0, -1)

async function createEvent(signalId: string, type: string, candle: Candle, details: Record<string, unknown> = {}) {
  await supabaseRequest('/rest/v1/signal_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ signal_id: signalId, type, price: candle.close, candle_time: candle.time, details }),
  })
}

async function patchSignal(id: string, values: Record<string, unknown>) {
  await supabaseRequest(`/rest/v1/signals?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(values),
  })
}

async function monitorSignal(signal: StoredSignal) {
  const candles = closedCandles(await getCandles(signal.symbol, '5m', 200))
  const signalState: ManagedSignal = {
    side: signal.side,
    status: signal.status,
    entryPrice: Number(signal.entry_price),
    stopPrice: Number(signal.stop_price),
    initialStopPrice: Number(signal.initial_stop_price),
    tp1Price: Number(signal.tp1_price),
    tp2Price: Number(signal.tp2_price),
    tp1RiskMultiple: Number(signal.tp1_risk_multiple),
  }
  const pendingCandles = candles.filter((candle) => candle.time > signal.last_checked_candle_time)
  let currentState = signalState

  for (const candle of pendingCandles) {
    const outcome = evaluateSignalCandle(currentState, candle)
    const baseUpdate = { last_checked_candle_time: candle.time, last_price: candle.close }
    if (outcome.type === 'none') {
      await patchSignal(signal.id, baseUpdate)
      continue
    }
    if (outcome.type === 'tp1') {
      await patchSignal(signal.id, { ...baseUpdate, status: 'tp1', stop_price: outcome.nextStopPrice, outcome_r: outcome.outcomeR })
      await createEvent(signal.id, 'tp1', candle, { movedStopTo: outcome.nextStopPrice, outcomeR: outcome.outcomeR })
      currentState = { ...currentState, status: 'tp1', stopPrice: outcome.nextStopPrice }
      continue
    }
    const closedAt = new Date(candle.time * 1000).toISOString()
    await patchSignal(signal.id, { ...baseUpdate, status: outcome.type, closed_at: closedAt, outcome_r: outcome.type === 'ambiguous' ? null : outcome.outcomeR })
    await createEvent(signal.id, outcome.type, candle, outcome.type === 'ambiguous' ? { reason: 'Stop and target touched in one 5m candle' } : { outcomeR: outcome.outcomeR })
    return
  }

  if (new Date(signal.expires_at).getTime() <= Date.now()) {
    const last = candles.at(-1)
    if (!last) return
    await patchSignal(signal.id, { status: 'expired', closed_at: new Date().toISOString(), last_price: last.close, last_checked_candle_time: last.time })
    await createEvent(signal.id, 'expired', last, { reason: 'Signal expired after four hours without final target or stop' })
  }
}

async function scanMarket(symbol: string) {
  const multiTimeframeCandles = await Promise.all(ANALYSIS_TIMEFRAMES.map((timeframe) => getCandles(symbol, timeframe, 180)))
  const confirmed = multiTimeframeCandles.map(closedCandles)
  const analyses = confirmed.map((candles, index) => analyzeTrend(candles, ANALYSIS_TIMEFRAMES[index]))
  const overall = getOverallTrend(analyses)
  const entryCandles = confirmed[3]
  const plan = calculateTradePlan(entryCandles, overall)
  if (!plan?.stop.price) return false

  const confirmationCandle = entryCandles.at(-1)
  if (!confirmationCandle) return false
  const id = randomUUID()
  const snapshotPath = `${id}.svg`
  const fingerprint = `${symbol}:${plan.stop.side}:${confirmationCandle.time}`
  const detectedAt = new Date(confirmationCandle.time * 1000).toISOString()
  const payload = {
    id,
    fingerprint,
    symbol,
    side: plan.stop.side,
    status: 'active',
    detected_at: detectedAt,
    detected_candle_time: confirmationCandle.time,
    last_checked_candle_time: confirmationCandle.time,
    expires_at: new Date(confirmationCandle.time * 1000 + 4 * 60 * 60 * 1000).toISOString(),
    entry_price: plan.stop.entry,
    initial_stop_price: plan.stop.price,
    stop_price: plan.stop.price,
    tp1_price: plan.takeProfits[0].price,
    tp2_price: plan.takeProfits[1].price,
    tp1_risk_multiple: plan.takeProfits[0].riskMultiple,
    last_price: confirmationCandle.close,
    trend_snapshot: analyses,
    plan_snapshot: plan,
    candles_snapshot: entryCandles.slice(-100),
    snapshot_path: snapshotPath,
  }
  const created = await supabaseRequest<Array<{ id: string }>>('/rest/v1/signals?on_conflict=fingerprint', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(payload),
  })
  if (!created.length) return false

  const snapshot = createSignalSnapshot(symbol, entryCandles, plan, detectedAt)
  try {
    await uploadSnapshot(snapshotPath, snapshot)
  } catch {
    await patchSignal(id, { snapshot_path: null })
  }
  await createEvent(id, 'detected', confirmationCandle, { trend: overall, entry: plan.stop.entry, stop: plan.stop.price })
  return true
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  if (!isAuthorizedCronRequest(request.headers.authorization)) return response.status(401).json({ error: 'Unauthorized' })

  try {
    const openSignals = await supabaseRequest<StoredSignal[]>('/rest/v1/signals?select=*&status=in.(active,tp1)')
    let monitored = 0
    await runWithConcurrency(openSignals, async (signal) => {
      try {
        await monitorSignal(signal)
        monitored += 1
      } catch {
        // One missing market must not stop monitoring other signals.
      }
    })

    const markets = await getMarkets()
    let created = 0
    await runWithConcurrency(markets, async (market) => {
      try {
        if (await scanMarket(market.symbol)) created += 1
      } catch {
        // Bybit can temporarily reject an individual instrument.
      }
    })
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ ok: true, monitored, created, scanned: markets.length })
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Signal scan failed' })
  }
}
