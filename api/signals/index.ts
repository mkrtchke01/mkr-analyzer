import { getPublicSnapshotUrl, supabaseRequest } from '../_lib/supabase.js'

export default async function handler(request: any, response: any) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' })

  try {
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
