import { getSupabaseConfiguration, supabaseRequest } from '../_lib/supabase.js'

const RESET_CONFIRMATION = 'clear-history-20260721-3c88'

type SignalSnapshot = { snapshot_path: string | null }

async function deleteSnapshot(path: string) {
  const { url, serviceKey } = getSupabaseConfiguration()
  const response = await fetch(`${url}/storage/v1/object/signal-snapshots/${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  if (!response.ok) throw new Error(`Failed to delete signal snapshot (${response.status})`)
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST' || request.query?.confirm !== RESET_CONFIRMATION) return response.status(404).end()

  try {
    const signals = await supabaseRequest<SignalSnapshot[]>('/rest/v1/mkr_signals?select=snapshot_path&limit=1000')
    const snapshotPaths = signals.flatMap((signal) => signal.snapshot_path ? [signal.snapshot_path] : [])
    for (const path of snapshotPaths) await deleteSnapshot(path)
    await supabaseRequest('/rest/v1/mkr_signals?id=not.is.null', { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    const remaining = await supabaseRequest<Array<{ id: string }>>('/rest/v1/mkr_signals?select=id&limit=1')
    return response.status(200).json({ deletedSignals: signals.length, deletedSnapshots: snapshotPaths.length, remainingSignals: remaining.length })
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to clear signal history' })
  }
}
