import { RISK_PER_TRADE_USDT } from './account.js'

/** Default Bybit VIP 0 fee for USDT perpetual orders executed as taker. */
export const BYBIT_USDT_PERPETUAL_TAKER_FEE_RATE = 0.00055

type StoredTarget = {
  id?: string
  price?: number | string
  share?: number | string
}

export type FeeSignal = {
  status: string
  entry_price?: number | string | null
  initial_stop_price?: number | string | null
  last_price?: number | string | null
  tp2_price?: number | string | null
  tp3_price?: number | string | null
  outcome_r?: number | string | null
  plan_snapshot?: {
    positionSizing?: { notional?: number | string }
    takeProfits?: StoredTarget[]
  } | null
}

const numberOrUndefined = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function isOpenSignalForFees(signal: Pick<FeeSignal, 'status' | 'tp2_price' | 'tp3_price'>) {
  return signal.status === 'active'
    || (signal.status === 'tp1' && signal.tp2_price !== null && signal.tp2_price !== undefined)
    || (signal.status === 'tp2' && signal.tp3_price !== null && signal.tp3_price !== undefined)
}

function targetsFromSignal(signal: FeeSignal) {
  const savedTargets = signal.plan_snapshot?.takeProfits
    ?.map((target, index) => ({ id: target.id ?? `TP${index + 1}`, price: numberOrUndefined(target.price), share: numberOrUndefined(target.share) }))
    .filter((target): target is { id: string, price: number, share: number } => target.price !== undefined && target.share !== undefined && target.share > 0)

  return savedTargets ?? []
}

function notionalFromSignal(signal: FeeSignal) {
  const savedNotional = numberOrUndefined(signal.plan_snapshot?.positionSizing?.notional)
  if (savedNotional !== undefined && savedNotional > 0) return savedNotional

  const entry = numberOrUndefined(signal.entry_price)
  const stop = numberOrUndefined(signal.initial_stop_price)
  const stopFraction = entry && stop !== undefined ? Math.abs(entry - stop) / entry : undefined
  return stopFraction && stopFraction > 0 ? RISK_PER_TRADE_USDT / stopFraction : undefined
}

function completedTargetCount(status: string, totalTargets: number) {
  if (status === 'tp1') return 1
  if (status === 'tp2') return 2
  if (status === 'tp3') return totalTargets
  return 0
}

/** Returns the actual/estimated taker fees paid for the realised position part. */
export function calculateBybitFeeUsd(signal: FeeSignal): number | null {
  const outcomeR = numberOrUndefined(signal.outcome_r)
  const entry = numberOrUndefined(signal.entry_price)
  const notional = notionalFromSignal(signal)
  if (outcomeR === undefined || !entry || !notional) return null

  const entryFee = notional * BYBIT_USDT_PERPETUAL_TAKER_FEE_RATE
  const targets = targetsFromSignal(signal)
  const isOpen = isOpenSignalForFees(signal)
  const completed = targets.slice(0, completedTargetCount(signal.status, targets.length))

  if (!isOpen && (signal.status === 'stop' || signal.status === 'expired' || signal.status === 'ambiguous' || !completed.length)) {
    const exitPrice = numberOrUndefined(signal.last_price) ?? entry
    return entryFee + notional * (exitPrice / entry) * BYBIT_USDT_PERPETUAL_TAKER_FEE_RATE
  }

  const completedShare = completed.reduce((sum, target) => sum + target.share / 100, 0)
  const targetExitFees = completed.reduce((sum, target) => sum + notional * (target.share / 100) * (target.price / entry) * BYBIT_USDT_PERPETUAL_TAKER_FEE_RATE, 0)
  return entryFee * completedShare + targetExitFees
}

export function calculateNetPnlUsd(signal: FeeSignal): number | null {
  const outcomeR = numberOrUndefined(signal.outcome_r)
  const fee = calculateBybitFeeUsd(signal)
  if (outcomeR === undefined || fee === null) return null
  return outcomeR * RISK_PER_TRADE_USDT - fee
}
