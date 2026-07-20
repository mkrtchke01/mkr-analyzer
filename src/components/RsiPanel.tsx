import type { RsiPoint } from '../lib/rsi'

type RsiPanelProps = {
  points: RsiPoint[]
  averagePoints: RsiPoint[]
  candleCount: number
  visibleRange: { from: number, to: number } | null
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

export default function RsiPanel({ points, averagePoints, candleCount, visibleRange }: RsiPanelProps) {
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
    </svg>
  </section>
}
