import { describe, expect, it } from 'vitest'
import { aggregateOrderBookZones, applyOrderBookUpdate, orderBookWebSocketTopic } from './liquidity'

describe('liquidity zones', () => {
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

  it('shows only the strongest unusual bid and ask instead of spamming nearby limit orders', () => {
    const zones = aggregateOrderBookZones({
      bids: new Map([[99.95, 400], [99.8, 250], [99.7, 2], [99.6, 2]]),
      asks: new Map([[100.05, 300], [100.2, 200], [100.3, 2], [100.4, 2]]),
    }, 100, 0.01)

    expect(zones).toHaveLength(2)
    expect(zones).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: 'bid', label: 'BID $40K' }),
      expect.objectContaining({ side: 'ask', label: 'ASK $30K' }),
    ]))
  })

  it('subscribes only to the Bybit order-book stream', () => {
    expect(orderBookWebSocketTopic('BTCUSDT')).toBe('orderbook.200.BTCUSDT')
  })
})
