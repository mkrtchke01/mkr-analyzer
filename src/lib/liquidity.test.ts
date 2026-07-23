import { describe, expect, it } from 'vitest'
import { aggregateLiquidationZones, aggregateOrderBookZones, applyOrderBookUpdate, LIQUIDATION_WINDOW_MS, liquidityWebSocketTopics, mergeLiquidityConfluences } from './liquidity'

describe('liquidity zones', () => {
  it('groups nearby liquidation events into a single large price zone and keeps only recent events', () => {
    const now = 1_720_000_000_000
    const zones = aggregateLiquidationZones([
      { price: 99.96, size: 60, side: 'long', timestamp: now - 1_000 },
      { price: 100.02, size: 40, side: 'long', timestamp: now - 2_000 },
      { price: 101, size: 1_000, side: 'short', timestamp: now - LIQUIDATION_WINDOW_MS - 1 },
    ], 100, 0.01, now)

    expect(zones).toEqual([expect.objectContaining({
      source: 'liquidation', side: 'long', count: 2, notional: expect.closeTo(9_998.4), label: 'LQ LONG $10K',
    })])
  })

  it('keeps an order book up to date from a snapshot and deltas, removing cancelled orders', () => {
    const snapshot = applyOrderBookUpdate({ bids: new Map(), asks: new Map() }, 'snapshot', {
      b: [['99.95', '100'], ['99.8', '1']],
      a: [['100.05', '80']],
    })
    const updated = applyOrderBookUpdate(snapshot, 'delta', {
      b: [['99.95', '0'], ['99.9', '90']],
      a: [['100.05', '90']],
    })

    expect(updated.bids).toEqual(new Map([[99.8, 1], [99.9, 90]]))
    expect(updated.asks).toEqual(new Map([[100.05, 90]]))
  })

  it('shows only unusually large nearby order-book clusters instead of every limit order', () => {
    const zones = aggregateOrderBookZones({
      bids: new Map([[99.95, 200], [99.8, 2], [99.7, 2], [99.6, 2]]),
      asks: new Map([[100.05, 150], [100.2, 2], [100.3, 2], [100.4, 2]]),
    }, 100, 0.01)

    expect(zones).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: 'bid', label: 'BID $20K' }),
      expect.objectContaining({ side: 'ask', label: 'ASK $15K' }),
    ]))
    expect(zones).toHaveLength(2)
  })

  it('combines a long liquidation zone with a nearby buy wall into one confluence', () => {
    const [zone] = mergeLiquidityConfluences([
      { id: 'lq-long', price: 99.98, notional: 20_000, count: 3, source: 'liquidation', side: 'long', label: 'LQ LONG $20K' },
    ], [
      { id: 'bid', price: 100.02, notional: 12_000, count: 1, source: 'orderbook', side: 'bid', label: 'BID $12K' },
    ], 100, 0.01)

    expect(zone).toEqual(expect.objectContaining({ source: 'confluence', side: 'bid', label: 'LQ LONG $20K + BID $12K' }))
  })

  it('subscribes only to the requested Bybit public streams', () => {
    expect(liquidityWebSocketTopics('BTCUSDT', true, false)).toEqual(['allLiquidation.BTCUSDT'])
    expect(liquidityWebSocketTopics('BTCUSDT', false, true)).toEqual(['orderbook.200.BTCUSDT'])
    expect(liquidityWebSocketTopics('BTCUSDT', true, true)).toEqual(['allLiquidation.BTCUSDT', 'orderbook.200.BTCUSDT'])
  })
})
