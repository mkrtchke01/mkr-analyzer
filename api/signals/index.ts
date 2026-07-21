import { getPublicSnapshotUrl, supabaseRequest } from '../_lib/supabase.js'

// $50 is the account baseline at the moment fixed-risk sizing is enabled.
// Historical scanner results must not alter a newly funded account.
const ACCOUNT_BALANCE_STARTED_AT = '2026-07-21T12:21:00.000Z'
const ONE_TIME_RESET_NONCE = '9d9b2aae1da34c5aac7728826deed6308c3f2ad17db249a5a1d3c10d2eb0949d'

export default async function handler(request: any, response: any) {
  if (request.method === 'DELETE') {
    if (request.headers['x-one-time-reset-nonce'] !== ONE_TIME_RESET_NONCE) return response.status(404).json({ error: 'Not found' })
    try {
      const cleared = await supabaseRequest<Array<{ id: string }>>('/rest/v1/mkr_signals?id=not.is.null', {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      })
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).json({ cleared: cleared.length })
    } catch (error) {
      return response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to reset signals' })
    }
  }

  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' })

  try {
    if (request.query?.state === 'account') {
      const records = await supabaseRequest<Array<{ status: string; tp2_price: string | null; tp3_price: string | null; outcome_r: string | null }>>(`/rest/v1/mkr_signals?select=status,tp2_price,tp3_price,outcome_r&status=in.(active,tp1,tp2,tp3,stop,expired,ambiguous)&closed_at=gte.${ACCOUNT_BALANCE_STARTED_AT}&outcome_r=not.is.null&limit=1000`)
      const outcomesR = records
        .filter((record) => record.status === 'tp3' || record.status === 'stop' || record.status === 'expired' || record.status === 'ambiguous' || (record.status === 'tp1' && record.tp2_price === null) || (record.status === 'tp2' && record.tp3_price === null))
        .map((record) => Number(record.outcome_r))
        .filter(Number.isFinite)
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).json({ outcomesR })
    }

    const state = request.query?.state === 'closed' ? 'closed' : 'open'
    const records = await supabaseRequest<any[]>('/rest/v1/mkr_signals?select=*&status=in.(active,tp1,tp2,tp3,stop,expired,ambiguous)&order=detected_at.desc&limit=100')
    const filtered = records.filter((record) => state === 'open'
      ? record.status === 'active' || (record.status === 'tp1' && record.tp2_price !== null) || (record.status === 'tp2' && record.tp3_price !== null)
      : record.status === 'tp3' || record.status === 'stop' || record.status === 'expired' || record.status === 'ambiguous' || (record.status === 'tp1' && record.tp2_price === null) || (record.status === 'tp2' && record.tp3_price === null))
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({
      signals: filtered.slice(0, 50).map((record) => ({
        id: record.id,
        symbol: record.symbol,
        setupType: record.setup_type ?? 'trend-reclaim',
        side: record.side,
        status: record.status,
        detectedAt: record.detected_at,
        closedAt: record.closed_at,
        entryPrice: Number(record.entry_price),
        stopPrice: Number(record.stop_price),
        initialStopPrice: Number(record.initial_stop_price),
        tp1Price: Number(record.tp1_price),
        tp2Price: record.tp2_price === null ? undefined : Number(record.tp2_price),
        takeProfits: record.plan_snapshot?.takeProfits,
        lastPrice: Number(record.last_price),
        outcomeR: record.outcome_r === null ? null : Number(record.outcome_r),
        snapshotUrl: getPublicSnapshotUrl(record.snapshot_path),
      })),
    })
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signals' })
  }
}
