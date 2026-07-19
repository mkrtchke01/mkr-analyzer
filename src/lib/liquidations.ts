export type LiquidationSide = 'long' | 'short'

export type LiquidationEvent = {
  id: string
  time: number
  price: number
  quantity: number
  valueUsd: number
  side: LiquidationSide
}

type BybitLiquidation = {
  T: number
  s: string
  S: 'Buy' | 'Sell'
  v: string
  p: string
}

export function toLiquidationEvent(event: BybitLiquidation): LiquidationEvent | undefined {
  const price = Number(event.p)
  const quantity = Number(event.v)
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) return undefined

  return {
    id: `${event.s}:${event.T}:${event.S}:${event.p}:${event.v}`,
    time: event.T,
    price,
    quantity,
    valueUsd: price * quantity,
    side: event.S === 'Buy' ? 'long' : 'short',
  }
}

export type LiquidationLevel = {
  price: number
  longUsd: number
  shortUsd: number
}

export function createLiquidationLevels(events: LiquidationEvent[], referencePrice: number, levels = 14): LiquidationLevel[] {
  if (!referencePrice || !events.length) return []
  const step = referencePrice * 0.0015
  const grouped = new Map<number, LiquidationLevel>()

  events.forEach((event) => {
    const price = Math.round(event.price / step) * step
    const existing = grouped.get(price) ?? { price, longUsd: 0, shortUsd: 0 }
    if (event.side === 'long') existing.longUsd += event.valueUsd
    else existing.shortUsd += event.valueUsd
    grouped.set(price, existing)
  })

  return [...grouped.values()]
    .sort((left, right) => (right.longUsd + right.shortUsd) - (left.longUsd + left.shortUsd))
    .slice(0, levels)
    .sort((left, right) => right.price - left.price)
}

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}
