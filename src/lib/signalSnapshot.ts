import type { Candle } from './bybit'
import type { TradePlan } from './trend'

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (symbol) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[symbol]!))

export function createSignalSnapshot(symbol: string, candles: Candle[], plan: TradePlan, detectedAt: string): string {
  const visible = candles.slice(-100)
  const prices = visible.flatMap((candle) => [candle.high, candle.low, candle.open, candle.close])
  const levels = [plan.stop.price, ...plan.takeProfits.map((target) => target.price)].filter((price): price is number => price !== undefined)
  const min = Math.min(...prices, ...levels)
  const max = Math.max(...prices, ...levels)
  const padding = Math.max((max - min) * 0.08, Number.EPSILON)
  const lower = min - padding
  const upper = max + padding
  const width = 1000
  const height = 530
  const left = 54
  const right = 74
  const top = 72
  const bottom = 46
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const scaleY = (price: number) => top + ((upper - price) / (upper - lower)) * plotHeight
  const step = plotWidth / visible.length
  const candleWidth = Math.max(2, step * 0.64)
  const grid = Array.from({ length: 6 }, (_, index) => {
    const y = top + index * (plotHeight / 5)
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#202735" stroke-width="1"/>`
  }).join('')
  const bodies = visible.map((candle, index) => {
    const x = left + index * step + step / 2
    const up = candle.close >= candle.open
    const color = up ? '#31d28c' : '#ff667a'
    const bodyTop = scaleY(Math.max(candle.open, candle.close))
    const bodyBottom = scaleY(Math.min(candle.open, candle.close))
    return `<line x1="${x}" y1="${scaleY(candle.high)}" x2="${x}" y2="${scaleY(candle.low)}" stroke="${color}"/><rect x="${x - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${Math.max(1, bodyBottom - bodyTop)}" fill="${color}"/>`
  }).join('')
  const level = (label: string, price: number, color: string) => {
    const y = scaleY(price)
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="${color}" stroke-dasharray="4 4"/><rect x="${width - right + 4}" y="${y - 12}" width="${right - 8}" height="24" rx="3" fill="${color}"/><text x="${width - right + 10}" y="${y + 4}" fill="#10151d" font-family="monospace" font-size="11">${escapeXml(label)}</text>`
  }
  const stop = plan.stop.price ? level(`STOP ${plan.stop.price.toPrecision(6)}`, plan.stop.price, '#ff667a') : ''
  const targets = plan.takeProfits.map((target) => level(`${target.id} ${target.price.toPrecision(6)}`, target.price, '#31d28c')).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#0c1019"/><text x="${left}" y="31" fill="#edf1f7" font-family="Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(symbol)} · ${escapeXml(plan.setupName)} · ${plan.stop.side.toUpperCase()}</text><text x="${left}" y="53" fill="#8390a3" font-family="monospace" font-size="11">${escapeXml(detectedAt)} · 5m snapshot</text>${grid}${bodies}${stop}${targets}<text x="${left}" y="${height - 18}" fill="#748095" font-family="monospace" font-size="10">Snapshot is fixed at signal confirmation</text></svg>`
}
