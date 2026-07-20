import type { Candle } from './bybit'

export type RsiPoint = { time: number, value: number }

export function calculateRsi(candles: Candle[], period = 14): RsiPoint[] {
  if (period < 1 || candles.length <= period) return []

  let gains = 0
  let losses = 0
  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close
    gains += Math.max(change, 0)
    losses += Math.max(-change, 0)
  }

  let averageGain = gains / period
  let averageLoss = losses / period
  const points: RsiPoint[] = [{ time: candles[period].time, value: rsiValue(averageGain, averageLoss) }]

  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period
    points.push({ time: candles[index].time, value: rsiValue(averageGain, averageLoss) })
  }

  return points
}

function rsiValue(averageGain: number, averageLoss: number): number {
  if (averageGain === 0 && averageLoss === 0) return 50
  if (averageLoss === 0) return 100
  if (averageGain === 0) return 0
  return 100 - 100 / (1 + averageGain / averageLoss)
}
