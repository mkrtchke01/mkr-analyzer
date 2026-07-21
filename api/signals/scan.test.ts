import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Candle } from '../../src/lib/bybit'
import type { TradePlan } from '../../src/lib/trend'

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

const { persistPlan } = await import('./scan')

const plan: TradePlan = {
  setupType: 'breakout-retest',
  setupName: 'Пробой + ретест',
  setupNote: 'Тест',
  signalKey: 'level:breakout',
  stop: { side: 'long', entry: 100, price: 98 },
  takeProfits: [{ id: 'TP1', price: 106, share: 100, riskMultiple: 3 }],
}

const candle: Candle = { time: 1_784_620_800, open: 99, high: 101, low: 98, close: 100, volume: 10 }

describe('signal persistence', () => {
  beforeEach(() => {
    mocks.supabaseRequest.mockReset()
    mocks.uploadSnapshot.mockReset()
  })

  it('keeps a valid setup when snapshot storage is unavailable', async () => {
    mocks.supabaseRequest.mockResolvedValueOnce([{ id: 'signal-id' }]).mockResolvedValueOnce(undefined)
    mocks.uploadSnapshot.mockRejectedValueOnce(new Error('Storage unavailable'))

    await expect(persistPlan('AXTIUSDT', plan, [], [candle])).resolves.toBe(true)

    const insertPayload = JSON.parse(mocks.supabaseRequest.mock.calls[0][1].body)
    expect(insertPayload).toMatchObject({ symbol: 'AXTIUSDT', snapshot_path: null, setup_type: 'breakout-retest' })
    expect(mocks.supabaseRequest.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    expect(mocks.uploadSnapshot).toHaveBeenCalledOnce()
  })
})
