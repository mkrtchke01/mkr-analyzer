import { randomUUID } from 'node:crypto'
import { getCandles, getMarkets, type Candle, type Timeframe } from '../../src/lib/bybit.js'
import { createSignalSnapshot } from '../../src/lib/signalSnapshot.js'
import { evaluateSignalCandle, type ManagedSignal } from '../../src/lib/signalLifecycle.js'
import { calculateSignalStrength } from '../../src/lib/signalStrength.js'
import { calculateAccountSummaryFromPnl, calculatePositionSizing, MAX_OPEN_POSITIONS, STARTING_BALANCE_USDT } from '../_lib/account.js'
import { calculateNetPnlUsd } from '../_lib/tradeFees.js'
import { analyzeTrend, calculateTradePlans, getOverallTrend, type SetupType, type TradePlan, type TrendAnalysis } from '../../src/lib/trend.js'
import { isAuthorizedCronRequest, supabaseRequest, uploadSnapshot } from '../_lib/supabase.js'

const ANALYSIS_TIMEFRAMES: Timeframe[] = ['4h', '1h', '15m', '5m']
const MAX_CONCURRENCY = 5
const MINIMUM_SIGNAL_STRENGTH = 7
const TREND_RECLAIM_RULE_VERSION = 3
export const SIGNAL_SCANNING_ENABLED = false

type StoredSignal = {
  id: string
  symbol: string
  setup_type: 'trend-reclaim'
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
  plan_snapshot?: { trendReclaimRuleVersion?: number } | null
}

type ScannerRun = { id: string }
type ScanMarketResult = { plansFound: number, created: number }
type ScannerErrorPhase = 'monitor' | 'market' | 'persistence' | 'run'
type ScannerFunding = { availableBalance: number, equity: number, openPositions: number }

export function selectStrongestPlan(plans: TradePlan[], analyses: TrendAnalysis[] = []): TradePlan | undefined {
  return plans.reduce<TradePlan | undefined>((strongest, candidate) => {
    if (!strongest) return candidate
    const strongestStrength = calculateSignalStrength(strongest, analyses).score
    const candidateStrength = calculateSignalStrength(candidate, analyses).score
    if (candidateStrength !== strongestStrength) return candidateStrength > strongestStrength ? candidate : strongest
    const strongestTarget = Math.max(...strongest.takeProfits.map((target) => target.riskMultiple))
    const candidateTarget = Math.max(...candidate.takeProfits.map((target) => target.riskMultiple))
    return candidateTarget > strongestTarget ? candidate : strongest
  }, undefined)
}

function isOpenSignal(signal: { status: string, tp2_price: string | null, tp3_price: string | null }) {
  return signal.status === 'active' || (signal.status === 'tp1' && signal.tp2_price !== null) || (signal.status === 'tp2' && signal.tp3_price !== null)
}

function isClosedSignal(signal: { status: string, tp2_price: string | null, tp3_price: string | null }) {
  return !isOpenSignal(signal)
}

function marginFromSnapshot(signal: any): number | null {
  const margin = Number(signal.plan_snapshot?.positionSizing?.margin)
  return Number.isFinite(margin) && margin > 0 ? margin : null
}

function fundingFromSignals(signals: any[]): ScannerFunding {
  const outcomes = signals.filter(isClosedSignal).map(calculateNetPnlUsd).filter(Number.isFinite)
  const openSignals = signals.filter(isOpenSignal)
  const account = calculateAccountSummaryFromPnl(outcomes, openSignals.map(marginFromSnapshot))
  return { availableBalance: account.balance, equity: account.equity, openPositions: openSignals.length }
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

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

async function logScannerError(runId: string | undefined, phase: ScannerErrorPhase, error: unknown, symbol?: string, details: Record<string, unknown> = {}) {
  const message = errorMessage(error)
  console.error(`[scanner:${phase}]${symbol ? ` ${symbol}` : ''} ${message}`)
  if (!runId) return

  try {
    await supabaseRequest('/rest/v1/mkr_scanner_errors', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ run_id: runId, phase, symbol, message, details }),
    })
  } catch (loggingError) {
    console.error(`[scanner:log] ${errorMessage(loggingError)}`)
  }
}

async function finishScannerRun(runId: string | undefined, values: Record<string, unknown>) {
  if (!runId) return
  await supabaseRequest(`/rest/v1/mkr_scanner_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...values, finished_at: new Date().toISOString() }),
  })
}

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

export function requiresSetupRuleRevalidation(signal: Pick<StoredSignal, 'setup_type' | 'plan_snapshot'>) {
  return signal.plan_snapshot?.trendReclaimRuleVersion !== TREND_RECLAIM_RULE_VERSION
}

async function monitorSignal(signal: StoredSignal) {
  const candles = closedCandles(await getCandles(signal.symbol, '5m', 200))
  if (requiresSetupRuleRevalidation(signal)) {
    const last = candles.at(-1)
    if (!last) return
    await patchSignal(signal.id, {
      status: 'expired',
      closed_at: new Date().toISOString(),
      last_price: last.close,
      last_checked_candle_time: last.time,
    })
    await createEvent(signal.id, 'expired', last, { reason: 'Signal invalidated after the strategy entry rules were tightened' })
    return
  }
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

export async function persistPlan(symbol: string, plan: TradePlan, analyses: TrendAnalysis[], entryCandles: Candle[], runId?: string, funding?: ScannerFunding) {
  if (plan.setupType !== 'trend-reclaim') return false
  if (!plan.stop.price) return false

  const confirmationCandle = entryCandles.at(-1)
  if (!confirmationCandle) return false
  const id = randomUUID()
  const snapshotPath = `${id}.svg`
  const signalStrength = calculateSignalStrength(plan, analyses)
  if (signalStrength.score < MINIMUM_SIGNAL_STRENGTH) return false
  if (funding && funding.openPositions >= MAX_OPEN_POSITIONS) return false
  const positionSizing = calculatePositionSizing(plan.stop.entry, plan.stop.price, funding?.availableBalance ?? STARTING_BALANCE_USDT, funding?.equity ?? STARTING_BALANCE_USDT)
  if (!positionSizing) return false
  const scoredPlan = {
    ...plan,
    trendReclaimRuleVersion: TREND_RECLAIM_RULE_VERSION,
    signalStrength,
    positionSizing,
  }
  const fingerprint = `${symbol}:${plan.setupType}:${plan.stop.side}:${plan.signalKey ?? confirmationCandle.time}`
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
    plan_snapshot: scoredPlan,
    candles_snapshot: entryCandles.slice(-100),
    // Сигнал важнее картинки: сбой Storage не должен делать валидный сетап невидимым.
    snapshot_path: null,
  }
  let created: Array<{ id: string }>
  try {
    created = await supabaseRequest<Array<{ id: string }>>('/rest/v1/mkr_signals?on_conflict=fingerprint', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    // A concurrent scanner may have already opened a plan for this symbol.
    // The database constraint is the final guard; this is an expected no-op.
    if (errorMessage(error).includes('mkr_signals_one_open_symbol_idx')) return false
    throw error
  }
  if (!created.length) return false
  if (funding) {
    funding.availableBalance = Math.max(0, funding.availableBalance - positionSizing.margin)
    funding.openPositions += 1
  }

  try {
    const snapshot = createSignalSnapshot(symbol, entryCandles, plan, detectedAt)
    await uploadSnapshot(snapshotPath, snapshot)
    await patchSignal(id, { snapshot_path: snapshotPath })
  } catch (error) {
    await logScannerError(runId, 'persistence', error, symbol, { operation: 'snapshot-upload', signalId: id })
  }
  try {
    await createEvent(id, 'detected', confirmationCandle, { trend: getOverallTrend(analyses), setupType: plan.setupType, strength: signalStrength.score, entry: plan.stop.entry, stop: plan.stop.price })
  } catch (error) {
    await logScannerError(runId, 'persistence', error, symbol, { operation: 'event-create', signalId: id })
  }
  return true
}

async function scanMarket(symbol: string, openSymbols: ReadonlySet<string>, funding: ScannerFunding, persist: typeof persistPlan, runId?: string): Promise<ScanMarketResult> {
  if (openSymbols.has(symbol)) return { plansFound: 0, created: 0 }
  const multiTimeframeCandles = await Promise.all(ANALYSIS_TIMEFRAMES.map((timeframe) => getCandles(symbol, timeframe, timeframe === '5m' ? 360 : 180)))
  const confirmed = multiTimeframeCandles.map(closedCandles)
  const analyses = confirmed.map((candles, index) => analyzeTrend(candles, ANALYSIS_TIMEFRAMES[index]))
  const entryCandles = confirmed[2]
  const plans = calculateTradePlans(entryCandles, getOverallTrend(analyses), {
    fourHour: analyses[0],
    oneHour: analyses[1],
    fifteenMinute: analyses[2],
    hourlyCandles: confirmed[1],
  })
  const strongestPlan = selectStrongestPlan(plans, analyses)
  if (!strongestPlan) return { plansFound: 0, created: 0 }
  return { plansFound: 1, created: await persist(symbol, strongestPlan, analyses, entryCandles, runId, funding) ? 1 : 0 }
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  if (!isAuthorizedCronRequest(request.headers.authorization)) return response.status(401).json({ error: 'Unauthorized' })
  if (!SIGNAL_SCANNING_ENABLED) {
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ ok: true, disabled: true, reason: 'All strategies are disabled' })
  }

  let runId: string | undefined
  try {
    const startedRuns = await supabaseRequest<ScannerRun[]>('/rest/v1/mkr_scanner_runs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({}),
    })
    runId = startedRuns[0]?.id
    const storedOpenSignals = await supabaseRequest<StoredSignal[]>('/rest/v1/mkr_signals?select=*&status=in.(active,tp1,tp2)')
    const openSignals = storedOpenSignals.filter((signal) => (signal.status === 'tp1' && signal.tp2_price !== null) || (signal.status === 'tp2' && signal.tp3_price !== null) || signal.status === 'active')
    const openSymbols = new Set(openSignals.map((signal) => signal.symbol))
    let monitored = 0
    let monitorErrors = 0
    await runWithConcurrency(openSignals, async (signal) => {
      try {
        await monitorSignal(signal)
        monitored += 1
      } catch (error) {
        monitorErrors += 1
        await logScannerError(runId, 'monitor', error, signal.symbol, { signalId: signal.id })
      }
    })

    const accountSignals = await supabaseRequest<any[]>('/rest/v1/mkr_signals?select=symbol,status,tp2_price,tp3_price,outcome_r,entry_price,initial_stop_price,last_price,plan_snapshot&status=in.(active,tp1,tp2,tp3,stop,expired,ambiguous)&limit=1000')
    const funding = fundingFromSignals(accountSignals)
    const currentOpenSignals = accountSignals.filter(isOpenSignal)
    const currentOpenSymbols = new Set(currentOpenSignals.map((signal) => signal.symbol))
    let persistenceQueue = Promise.resolve()
    const persistQueued: typeof persistPlan = async (...args) => {
      const task = persistenceQueue.then(() => persistPlan(...args))
      persistenceQueue = task.then(() => undefined, () => undefined)
      return task
    }

    const markets = await getMarkets()
    let created = 0
    let plansFound = 0
    let marketErrors = 0
    await runWithConcurrency(markets, async (market) => {
      try {
        const result = await scanMarket(market.symbol, currentOpenSymbols, funding, persistQueued, runId)
        plansFound += result.plansFound
        created += result.created
      } catch (error) {
        marketErrors += 1
        await logScannerError(runId, 'market', error, market.symbol)
      }
    })
    await finishScannerRun(runId, {
      status: monitorErrors || marketErrors ? 'partial' : 'success',
      scanned_count: markets.length,
      plans_found_count: plansFound,
      created_count: created,
      market_error_count: marketErrors,
      monitor_error_count: monitorErrors,
      details: { monitored, openSignals: currentOpenSignals.length, freeBalance: funding.availableBalance, reservedMargin: funding.equity - funding.availableBalance },
    })
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ ok: true, runId, monitored, created, plansFound, scanned: markets.length, marketErrors, monitorErrors })
  } catch (error) {
    await logScannerError(runId, 'run', error)
    await finishScannerRun(runId, { status: 'failed', error_message: errorMessage(error) }).catch(() => undefined)
    return response.status(500).json({ error: errorMessage(error) })
  }
}
