import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Candle } from '../../src/lib/bybit'
import type { TradePlan, TrendAnalysis } from '../../src/lib/trend'

const mocks = vi.hoisted(() => ({
  supabaseRequest: vi.fn(),
  uploadSnapshot: vi.fn(),
}))

vi.mock('../_lib/supabase.js', () => ({
  isAuthorizedCronRequest: vi.fn(),
  supabaseRequest: mocks.supabaseRequest,
  uploadSnapshot: mocks.uploadSnapshot,
}))

vi.mock('../../src/lib/signalSnapshot.js', () => ({
  createSignalSnapshot: vi.fn(() => '<svg />'),
}))

const { persistPlan, selectStrongestPlan } = await import('./scan')

const plan: TradePlan = {
  setupType: 'breakout-retest',
  setupName: 'Пробой + ретест',
  setupNote: 'Тест',
  signalKey: 'level:breakout',
  stop: { side: 'long', entry: 100, price: 98, distanceAtr: 0.8 },
  takeProfits: [{ id: 'TP1', price: 112, share: 100, riskMultiple: 6 }],
}

const candle: Candle = { time: 1_784_620_800, open: 99, high: 101, low: 98, close: 100, volume: 10 }
const strongAnalyses: TrendAnalysis[] = ['4h', '1h', '15m'].map((timeframe) => ({ timeframe: timeframe as TrendAnalysis['timeframe'], direction: 'bullish', strength: 90, adx: 30, atr: 1, volumeRatio: 1, reasons: [] }))

describe('signal persistence', () => {
  beforeEach(() => {
    mocks.supabaseRequest.mockReset()
    mocks.uploadSnapshot.mockReset()
  })

  it('keeps a valid setup when snapshot storage is unavailable', async () => {
    mocks.supabaseRequest.mockResolvedValueOnce([{ id: 'signal-id' }]).mockResolvedValueOnce(undefined)
    mocks.uploadSnapshot.mockRejectedValueOnce(new Error('Storage unavailable'))

    await expect(persistPlan('AXTIUSDT', plan, strongAnalyses, [candle])).resolves.toBe(true)

    const insertPayload = JSON.parse(mocks.supabaseRequest.mock.calls[0][1].body)
    expect(insertPayload).toMatchObject({ symbol: 'AXTIUSDT', snapshot_path: null, setup_type: 'breakout-retest', plan_snapshot: { signalStrength: { score: 10 }, positionSizing: { riskAmount: 2 } } })
    expect(mocks.supabaseRequest.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    expect(mocks.uploadSnapshot).toHaveBeenCalledOnce()
  })

  it('treats the database open-symbol lock as an already existing setup', async () => {
    mocks.supabaseRequest.mockRejectedValueOnce(new Error('Supabase request failed (409): mkr_signals_one_open_symbol_idx'))

    await expect(persistPlan('AXTIUSDT', plan, strongAnalyses, [candle])).resolves.toBe(false)

    expect(mocks.uploadSnapshot).not.toHaveBeenCalled()
  })

  it('keeps the strongest setup for a symbol', () => {
    const reclaim = { ...plan, setupType: 'trend-reclaim' as const, takeProfits: [{ id: 'TP1' as const, price: 104, share: 100, riskMultiple: 4 }] }
    const reversal = { ...plan, setupType: 'top-reversal' as const, stop: { ...plan.stop, side: 'short' as const }, takeProfits: [{ id: 'TP1' as const, price: 88, share: 100, riskMultiple: 8 }] }
    const bearishAnalyses = strongAnalyses.map((analysis) => ({ ...analysis, direction: 'bearish' as const }))

    expect(selectStrongestPlan([reclaim, reversal, plan], bearishAnalyses)).toBe(reversal)
  })

  it('does not persist a setup below the strength threshold', async () => {
    await expect(persistPlan('AXTIUSDT', { ...plan, takeProfits: [{ id: 'TP1', price: 102, share: 100, riskMultiple: 1 }] }, [], [candle])).resolves.toBe(false)
    expect(mocks.supabaseRequest).not.toHaveBeenCalled()
  })
})
