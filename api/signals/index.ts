import { getPublicSnapshotUrl, supabaseRequest } from '../_lib/supabase.js'
import { calculateStrategyStats, type StrategyStatsSignal } from '../../src/lib/strategyStats.js'
import { calculateSignalStrength } from '../../src/lib/signalStrength.js'
import { calculateAccountSummary } from '../../src/lib/positionSizing.js'

function signalStrengthFromSnapshot(record: any): number | null {
  const storedScore = Number(record.plan_snapshot?.signalStrength?.score)
  if (Number.isInteger(storedScore) && storedScore >= 1 && storedScore <= 10) return storedScore
  if (!record.plan_snapshot?.stop || !Array.isArray(record.plan_snapshot?.takeProfits)) return null
  return calculateSignalStrength(record.plan_snapshot, Array.isArray(record.trend_snapshot) ? record.trend_snapshot : []).score
}

function isOpenRecord(record: { status: string; tp2_price: string | null; tp3_price: string | null }) {
  return record.status === 'active' || (record.status === 'tp1' && record.tp2_price !== null) || (record.status === 'tp2' && record.tp3_price !== null)
}

function isClosedRecord(record: { status: string; tp2_price: string | null; tp3_price: string | null }) {
  return !isOpenRecord(record)
}

function marginFromSnapshot(record: any): number | null {
  const margin = Number(record.plan_snapshot?.positionSizing?.margin)
  return Number.isFinite(margin) && margin > 0 ? margin : null
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' })

  try {
    if (request.query?.state === 'statistics') {
      const records = await supabaseRequest<Array<{ setup_type: StrategyStatsSignal['setupType'] | null; status: StrategyStatsSignal['status']; tp2_price: string | null; tp3_price: string | null; outcome_r: string | null }>>('/rest/v1/mkr_signals?select=setup_type,status,tp2_price,tp3_price,outcome_r&status=in.(active,tp1,tp2,tp3,stop,expired,ambiguous)&limit=1000')
      const signals: StrategyStatsSignal[] = records.map((record) => ({
        setupType: record.setup_type ?? 'trend-reclaim',
        status: record.status,
        tp2Price: record.tp2_price === null ? undefined : Number(record.tp2_price),
        tp3Price: record.tp3_price === null ? undefined : Number(record.tp3_price),
        outcomeR: record.outcome_r === null ? null : Number(record.outcome_r),
      }))
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).json({ statistics: calculateStrategyStats(signals) })
    }

    if (request.query?.state === 'account') {
      const records = await supabaseRequest<Array<{ status: string; tp2_price: string | null; tp3_price: string | null; outcome_r: string | null; plan_snapshot: unknown }>>('/rest/v1/mkr_signals?select=status,tp2_price,tp3_price,outcome_r,plan_snapshot&status=in.(active,tp1,tp2,tp3,stop,expired,ambiguous)&limit=1000')
      const outcomesR = records
        .filter(isClosedRecord)
        .map((record) => Number(record.outcome_r))
        .filter(Number.isFinite)
      const openMargins = records.filter(isOpenRecord).map(marginFromSnapshot)
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).json({ account: calculateAccountSummary(outcomesR, openMargins) })
    }

    const state = request.query?.state === 'closed' ? 'closed' : 'open'
    const records = await supabaseRequest<any[]>('/rest/v1/mkr_signals?select=*&status=in.(active,tp1,tp2,tp3,stop,expired,ambiguous)&order=detected_at.desc&limit=100')
    const filtered = records.filter((record) => state === 'open' ? isOpenRecord(record) : isClosedRecord(record))
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
        signalStrength: signalStrengthFromSnapshot(record),
        positionSizing: record.plan_snapshot?.positionSizing,
        lastPrice: Number(record.last_price),
        outcomeR: record.outcome_r === null ? null : Number(record.outcome_r),
        snapshotUrl: getPublicSnapshotUrl(record.snapshot_path),
      })),
    })
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signals' })
  }
}
