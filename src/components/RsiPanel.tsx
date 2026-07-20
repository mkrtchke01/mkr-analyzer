import type { RsiPoint } from '../lib/rsi'
import type { DivergenceInfo } from '../lib/marketInfo'

type RsiPanelProps = {
  points: RsiPoint[]
  averagePoints: RsiPoint[]
  candleCount: number
  visibleRange: { from: number, to: number } | null
  divergences: Array<DivergenceInfo & { id: string }>
}

export function rsiPath(points: RsiPoint[], candleCount: number, visibleRange: { from: number, to: number } | null = null): string {
  if (!points.length || candleCount < 2) return ''
  const startIndex = candleCount - points.length
  const from = visibleRange?.from ?? 0
  const to = visibleRange?.to ?? candleCount - 1
  const span = to - from
  if (span <= 0) return ''
  return points.map((point, index) => {
    const x = ((startIndex + index - from) / span) * 100
    const y = 100 - point.value
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`
  }).join(' ')
}

export function rsiDivergencePath(points: RsiPoint[], candleCount: number, divergence: DivergenceInfo, visibleRange: { from: number, to: number } | null = null): string {
  if (candleCount < 2) return ''
  const startIndex = candleCount - points.length
  const from = visibleRange?.from ?? 0
  const to = visibleRange?.to ?? candleCount - 1
  const span = to - from
  const firstIndex = points.findIndex((point) => point.time === divergence.first.rsiTime)
  const secondIndex = points.findIndex((point) => point.time === divergence.second.rsiTime)
  if (span <= 0 || firstIndex < 0 || secondIndex < 0) return ''
  const coordinate = (index: number, value: number) => `${(((startIndex + index - from) / span) * 100).toFixed(3)} ${(100 - value).toFixed(3)}`
  return `M ${coordinate(firstIndex, divergence.first.rsiValue)} L ${coordinate(secondIndex, divergence.second.rsiValue)}`
}

export default function RsiPanel({ points, averagePoints, candleCount, visibleRange, divergences }: RsiPanelProps) {
  const latest = points.at(-1)?.value
  return <section className="rsi-panel" aria-label="Индекс относительной силы RSI 14">
    <span className="rsi-title">RSI · 14{latest === undefined ? '' : ` · ${latest.toFixed(1)}`}</span>
    <span className="rsi-level rsi-level-70">70</span>
    <span className="rsi-level rsi-level-50">50</span>
    <span className="rsi-level rsi-level-30">30</span>
    <svg className="rsi-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="100" y1="30" y2="30" className="rsi-guide rsi-overbought" />
      <line x1="0" x2="100" y1="50" y2="50" className="rsi-guide" />
      <line x1="0" x2="100" y1="70" y2="70" className="rsi-guide rsi-oversold" />
      <path d={rsiPath(points, candleCount, visibleRange)} className="rsi-line" />
      <path d={rsiPath(averagePoints, candleCount, visibleRange)} className="rsi-average" />
      {divergences.map((divergence) => <path className="rsi-divergence" d={rsiDivergencePath(points, candleCount, divergence, visibleRange)} key={divergence.id} />)}
    </svg>
  </section>
}
