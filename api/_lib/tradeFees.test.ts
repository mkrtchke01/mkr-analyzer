import { describe, expect, it } from 'vitest'
import { BYBIT_USDT_PERPETUAL_TAKER_FEE_RATE, calculateBybitFeeUsd, calculateNetPnlUsd } from './tradeFees'

describe('Bybit perpetual fees', () => {
  it('deducts the VIP 0 taker fee at both opening and a stopped exit', () => {
    const signal = {
      status: 'stop',
      entry_price: 100,
      initial_stop_price: 98,
      last_price: 90,
      outcome_r: -1,
      plan_snapshot: { positionSizing: { notional: 1000 } },
    }

    expect(BYBIT_USDT_PERPETUAL_TAKER_FEE_RATE).toBe(0.00055)
    expect(calculateBybitFeeUsd(signal)).toBeCloseTo(1.045, 6)
    expect(calculateNetPnlUsd(signal)).toBeCloseTo(-3.045, 6)
  })

  it('charges the realised target portions only while a trade remains open', () => {
    const signal = {
      status: 'tp1',
      entry_price: 100,
      initial_stop_price: 98,
      last_price: 103,
      tp2_price: 106,
      tp3_price: null,
      outcome_r: 1.5,
      plan_snapshot: {
        positionSizing: { notional: 1000 },
        takeProfits: [
          { id: 'TP1', price: 103, share: 50 },
          { id: 'TP2', price: 106, share: 50 },
        ],
      },
    }

    expect(calculateBybitFeeUsd(signal)).toBeCloseTo(0.55825, 6)
    expect(calculateNetPnlUsd(signal)).toBeCloseTo(2.44175, 6)
  })
})
