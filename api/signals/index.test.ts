import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ supabaseRequest: vi.fn() }))

vi.mock('../_lib/supabase.js', () => ({
  getPublicSnapshotUrl: vi.fn(),
  supabaseRequest: mocks.supabaseRequest,
}))

const { resetClosedHistoryOnce } = await import('./index')

describe('closed history reset', () => {
  it('removes closed signals and their snapshots before serving the journal', async () => {
    mocks.supabaseRequest
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ snapshot_path: 'closed-signal.svg' }, { snapshot_path: null }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    await resetClosedHistoryOnce()

    expect(mocks.supabaseRequest.mock.calls[2][0]).toContain('/storage/v1/object/signal-snapshots/closed-signal.svg')
    expect(mocks.supabaseRequest.mock.calls[3][0]).toContain('/rest/v1/mkr_signals?or=')
    expect(mocks.supabaseRequest.mock.calls[3][1]).toMatchObject({ method: 'DELETE' })
    expect(mocks.supabaseRequest.mock.calls[4][0]).toBe('/rest/v1/mkr_scanner_runs')
  })
})
