export type LiquidationSide = 'long' | 'short'
export type BookSide = 'bid' | 'ask'

export type LiquidationEvent = {
  price: number
  size: number
  side: LiquidationSide
  timestamp: number
}

export type OrderBook = {
  bids: Map<number, number>
  asks: Map<number, number>
}

export type LiquidityZone = {
  id: string
  price: number
  notional: number
  count: number
  source: 'liquidation' | 'orderbook' | 'confluence'
  side: LiquidationSide | BookSide
  label: string
}

export const LIQUIDATION_WINDOW_MS = 6 * 60 * 60 * 1_000
const MAX_ZONES_PER_SIDE = 3

export function liquidityBucketSize(price: number, tickSize = 0) {
  return Math.max(price * 0.001, tickSize * 20, Number.EPSILON)
}

export function formatLiquidityNotional(notional: number) {
  if (notional >= 1_000_000) return `$${(notional / 1_000_000).toFixed(1)}M`
  if (notional >= 1_000) return `$${(notional / 1_000).toFixed(0)}K`
  return `$${notional.toFixed(0)}`
}

function selectLargest<T extends { notional: number }>(zones: T[], max = MAX_ZONES_PER_SIDE) {
  return [...zones].sort((left, right) => right.notional - left.notional).slice(0, max)
}

function aggregateByBucket<T extends { price: number, notional: number, side: string }>(items: T[], bucketSize: number) {
  const buckets = new Map<string, { price: number, notional: number, count: number, side: T['side'] }>()
  items.forEach((item) => {
    const price = Math.round(item.price / bucketSize) * bucketSize
    const key = `${item.side}:${price}`
    const bucket = buckets.get(key) ?? { price, notional: 0, count: 0, side: item.side }
    bucket.notional += item.notional
    bucket.count += 1
    buckets.set(key, bucket)
  })
  return [...buckets.values()]
}

export function aggregateLiquidationZones(events: LiquidationEvent[], currentPrice: number, tickSize = 0, now = Date.now()): LiquidityZone[] {
  const bucketSize = liquidityBucketSize(currentPrice, tickSize)
  const active = events.filter((event) => event.timestamp >= now - LIQUIDATION_WINDOW_MS)
  const buckets = aggregateByBucket(active.map((event) => ({ ...event, notional: event.price * event.size })), bucketSize)

  return (['long', 'short'] as const).flatMap((side) => selectLargest(buckets.filter((zone) => zone.side === side && zone.notional >= 5_000)).map((zone) => ({
    id: `lq-${side}-${zone.price}`,
    price: zone.price,
    notional: zone.notional,
    count: zone.count,
    source: 'liquidation' as const,
    side,
    label: `LQ ${side === 'long' ? 'LONG' : 'SHORT'} ${formatLiquidityNotional(zone.notional)}`,
  })))
}

export function applyOrderBookUpdate(book: OrderBook, type: 'snapshot' | 'delta', data: { b?: string[][], a?: string[][] }): OrderBook {
  const bids = type === 'snapshot' ? new Map<number, number>() : new Map(book.bids)
  const asks = type === 'snapshot' ? new Map<number, number>() : new Map(book.asks)
  const update = (levels: string[] | undefined, target: Map<number, number>) => {
    if (!levels) return
    const [rawPrice, rawSize] = levels
    const price = Number(rawPrice)
    const size = Number(rawSize)
    if (!Number.isFinite(price) || !Number.isFinite(size)) return
    if (size === 0) target.delete(price)
    else target.set(price, size)
  }
  data.b?.forEach((level) => update(level, bids))
  data.a?.forEach((level) => update(level, asks))
  return { bids, asks }
}

export function aggregateOrderBookZones(book: OrderBook, currentPrice: number, tickSize = 0): LiquidityZone[] {
  if (currentPrice <= 0) return []
  const bucketSize = liquidityBucketSize(currentPrice, tickSize)
  const build = (levels: Map<number, number>, side: BookSide) => {
    const nearby = [...levels].filter(([price]) => Math.abs(price - currentPrice) / currentPrice <= 0.035)
    const buckets = aggregateByBucket(nearby.map(([price, size]) => ({ price, notional: price * size, side })), bucketSize)
    const notionals = buckets.map((item) => item.notional).sort((left, right) => left - right)
    const median = notionals.length ? notionals[Math.floor(notionals.length / 2)] : 0
    return selectLargest(buckets.filter((zone) => zone.notional >= Math.max(5_000, median * 3))).map((zone) => ({
      id: `book-${side}-${zone.price}`,
      price: zone.price,
      notional: zone.notional,
      count: zone.count,
      source: 'orderbook' as const,
      side,
      label: `${side === 'bid' ? 'BID' : 'ASK'} ${formatLiquidityNotional(zone.notional)}`,
    }))
  }
  return [...build(book.bids, 'bid'), ...build(book.asks, 'ask')]
}

export function mergeLiquidityConfluences(liquidations: LiquidityZone[], orderBook: LiquidityZone[], currentPrice: number, tickSize = 0) {
  const distance = liquidityBucketSize(currentPrice, tickSize)
  const usedBook = new Set<string>()
  const merged: LiquidityZone[] = []
  const remainingLiquidations: LiquidityZone[] = []

  liquidations.forEach((liquidation) => {
    const matchingSide: BookSide = liquidation.side === 'long' ? 'bid' : 'ask'
    const match = orderBook.find((zone) => zone.side === matchingSide && !usedBook.has(zone.id) && Math.abs(zone.price - liquidation.price) <= distance)
    if (!match) {
      remainingLiquidations.push(liquidation)
      return
    }
    usedBook.add(match.id)
    const weightedPrice = (liquidation.price * liquidation.notional + match.price * match.notional) / (liquidation.notional + match.notional)
    merged.push({
      id: `confluence-${liquidation.id}-${match.id}`,
      price: weightedPrice,
      notional: liquidation.notional + match.notional,
      count: liquidation.count + match.count,
      source: 'confluence',
      side: matchingSide,
      label: `${liquidation.label} + ${match.label}`,
    })
  })
  return [...merged, ...remainingLiquidations, ...orderBook.filter((zone) => !usedBook.has(zone.id))]
}

export function liquidityWebSocketTopics(symbol: string, showLiquidations: boolean, showOrderBook: boolean) {
  return [
    ...(showLiquidations ? [`allLiquidation.${symbol}`] : []),
    ...(showOrderBook ? [`orderbook.200.${symbol}`] : []),
  ]
}
