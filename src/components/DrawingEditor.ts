export type ScreenPoint = { x: number, y: number }

export function distanceToSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y)
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy))
}

export function isNearPoint(point: ScreenPoint, target: ScreenPoint, radius = 10) {
  return Math.hypot(point.x - target.x, point.y - target.y) <= radius
}

export function extrapolateChartTime(
  chartTime: number | null,
  coordinate: number,
  latest: { time: number, x: number } | null,
  previous: { time: number, x: number } | null,
) {
  if (chartTime !== null) return chartTime
  if (!latest || !previous || latest.x === previous.x) return null
  return Math.round(latest.time + (coordinate - latest.x) * (latest.time - previous.time) / (latest.x - previous.x))
}
