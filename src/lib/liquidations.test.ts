import { describe, expect, it } from 'vitest'
import { createLiquidationLevels, toLiquidationEvent } from './liquidations'

describe('Bybit liquidations', () => {
  it('maps a Bybit all-liquidation event and identifies a liquidated long', () => {
    expect(toLiquidationEvent({ T: 1000, s: 'BTCUSDT', S: 'Buy', v: '2', p: '50000' })).toMatchObject({
      side: 'long', price: 50000, quantity: 2, valueUsd: 100000,
    })
  })

  it('groups liquidation values by nearby price levels', () => {
    const long = toLiquidationEvent({ T: 1000, s: 'BTCUSDT', S: 'Buy', v: '2', p: '50000' })!
    const short = toLiquidationEvent({ T: 1001, s: 'BTCUSDT', S: 'Sell', v: '1', p: '50020' })!
    const levels = createLiquidationLevels([long, short], 50000)

    expect(levels).toHaveLength(1)
    expect(levels[0].longUsd).toBe(100000)
    expect(levels[0].shortUsd).toBe(50020)
  })
})
