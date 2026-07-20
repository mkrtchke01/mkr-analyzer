import { randomUUID } from 'node:crypto'
import { getCandles, getMarkets, type Candle, type Timeframe } from '../../src/lib/bybit.js'
import { createSignalSnapshot } from '../../src/lib/signalSnapshot.js'
import { evaluateSignalCandle, type ManagedSignal } from '../../src/lib/signalLifecycle.js'
import { analyzeTrend, calculateTradePlans, getOverallTrend, type TradePlan, type TrendAnalysis } from '../../src/lib/trend.js'
import { isAuthorizedCronRequest, supabaseRequest, uploadSnapshot } from '../_lib/supabase.js'

const ANALYSIS_TIMEFRAMES: Timeframe[] = ['4h', '1h', '15m', '5m']
const MAX_CONCURRENCY = 5

type StoredSignal = {
  id: string
  symbol: string
  setup_type: 'trend-reclaim' | 'level-breakout' | 'false-breakout' | 'bottom-reversal' | 'top-reversal' | 'breakout-retest' | 'consensus'
  side: 'long' | 'short'
  status: 'active' | 'tp1' | 'tp2'
  entry_price: string
  stop_price: string
  initial_stop_price: string
  tp1_price: string
  tp2_price: string | null
  tp3_price: string | null
  tp1_risk_multiple: string
  tp2_risk_multiple: string | null
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
  await supabaseRequest('/rest/v1/mkr_signal_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ signal_id: signalId, type, price: candle.close, candle_time: candle.time, details }),
  })
}

async function patchSignal(id: string, values: Record<string, unknown>) {
  await supabaseRequest(`/rest/v1/mkr_signals?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(values),
  })
}

async function deleteSignal(id: string) {
  await supabaseRequest(`/rest/v1/mkr_signals?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
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
    tp2Price: signal.tp2_price === null ? undefined : Number(signal.tp2_price),
    tp3Price: signal.tp3_price === null ? undefined : Number(signal.tp3_price),
    tp1RiskMultiple: Number(signal.tp1_risk_multiple),
    tp2RiskMultiple: signal.tp2_price === null ? undefined : signal.tp2_risk_multiple === null ? Math.abs(Number(signal.tp2_price) - Number(signal.entry_price)) / Math.abs(Number(signal.entry_price) - Number(signal.initial_stop_price)) : Number(signal.tp2_risk_multiple),
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
    if ((outcome.type === 'tp1' || outcome.type === 'tp2') && outcome.nextStopPrice !== undefined) {
      const nextStatus = outcome.type
      await patchSignal(signal.id, { ...baseUpdate, status: nextStatus, stop_price: outcome.nextStopPrice, outcome_r: outcome.outcomeR })
      await createEvent(signal.id, nextStatus, candle, { movedStopTo: outcome.nextStopPrice, outcomeR: outcome.outcomeR })
      currentState = { ...currentState, status: nextStatus, stopPrice: outcome.nextStopPrice }
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

async function persistPlan(symbol: string, plan: TradePlan, analyses: TrendAnalysis[], entryCandles: Candle[]) {
  if (!plan.stop.price) return false

  const confirmationCandle = entryCandles.at(-1)
  if (!confirmationCandle) return false
  const id = randomUUID()
  const snapshotPath = `${id}.svg`
  const fingerprint = `${symbol}:${plan.setupType}:${plan.stop.side}:${confirmationCandle.time}`
  const detectedAt = new Date(confirmationCandle.time * 1000).toISOString()
  const payload = {
    id,
    fingerprint,
    symbol,
    setup_type: plan.setupType,
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
    tp2_price: plan.takeProfits[1]?.price ?? null,
    tp1_risk_multiple: plan.takeProfits[0].riskMultiple,
    tp2_risk_multiple: plan.takeProfits[1]?.riskMultiple ?? null,
    tp3_price: plan.takeProfits[2]?.price ?? null,
    last_price: confirmationCandle.close,
    trend_snapshot: analyses,
    plan_snapshot: plan,
    candles_snapshot: entryCandles.slice(-100),
    snapshot_path: snapshotPath,
  }
  const created = await supabaseRequest<Array<{ id: string }>>('/rest/v1/mkr_signals?on_conflict=fingerprint', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(payload),
  })
  if (!created.length) return false

  const snapshot = createSignalSnapshot(symbol, entryCandles, plan, detectedAt)
  try {
    await uploadSnapshot(snapshotPath, snapshot)
  } catch {
    await deleteSignal(id)
    return false
  }
  await createEvent(id, 'detected', confirmationCandle, { trend: getOverallTrend(analyses), setupType: plan.setupType, entry: plan.stop.entry, stop: plan.stop.price })
  return true
}

async function scanMarket(symbol: string) {
  const multiTimeframeCandles = await Promise.all(ANALYSIS_TIMEFRAMES.map((timeframe) => getCandles(symbol, timeframe, timeframe === '5m' ? 360 : 180)))
  const confirmed = multiTimeframeCandles.map(closedCandles)
  const analyses = confirmed.map((candles, index) => analyzeTrend(candles, ANALYSIS_TIMEFRAMES[index]))
  const entryCandles = confirmed[3]
  const plans = calculateTradePlans(entryCandles, getOverallTrend(analyses), {
    fourHour: analyses[0],
    hourlyCandles: confirmed[1],
  })
  let created = 0
  for (const plan of plans) if (await persistPlan(symbol, plan, analyses, entryCandles)) created += 1
  return created
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  if (!isAuthorizedCronRequest(request.headers.authorization)) return response.status(401).json({ error: 'Unauthorized' })

  try {
    const storedOpenSignals = await supabaseRequest<StoredSignal[]>('/rest/v1/mkr_signals?select=*&status=in.(active,tp1,tp2)')
    const openSignals = storedOpenSignals.filter((signal) => (signal.status === 'tp1' && signal.tp2_price !== null) || (signal.status === 'tp2' && signal.tp3_price !== null) || signal.status === 'active')
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
        created += await scanMarket(market.symbol)
      } catch {
        // Bybit can temporarily reject an individual instrument.
      }
    })
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ ok: true, monitored, created, scanned: markets.length })
  } catch (error) {
    console.error('Signal scan failed', error)
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Signal scan failed' })
  }
}
