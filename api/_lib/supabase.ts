const getEnvironment = (name: string) => process.env[name]

export function getSupabaseConfiguration() {
  const url = getEnvironment('POSTGRES_SUPABASE_URL') ?? getEnvironment('SUPABASE_URL')
  const serviceKey = getEnvironment('POSTGRES_SUPABASE_SERVICE_ROLE_KEY') ?? getEnvironment('SUPABASE_SECRET_KEY')
  if (!url || !serviceKey) throw new Error('Supabase environment variables are not configured')
  return { url: url.replace(/\/$/, ''), serviceKey }
}

export async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, serviceKey } = getSupabaseConfiguration()
  const headers = new Headers(init.headers)
  headers.set('apikey', serviceKey)
  headers.set('Authorization', `Bearer ${serviceKey}`)
  headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json')
  const response = await fetch(`${url}${path}`, { ...init, headers })
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300)
    throw new Error(`Supabase request failed (${response.status}): ${details}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function getPublicSnapshotUrl(path: string | null) {
  if (!path) return null
  const { url } = getSupabaseConfiguration()
  return `${url}/storage/v1/object/public/signal-snapshots/${encodeURIComponent(path)}`
}

export async function uploadSnapshot(path: string, svg: string) {
  await supabaseRequest(`/storage/v1/object/signal-snapshots/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/svg+xml', 'x-upsert': 'true' },
    body: svg,
  })
}

export function isAuthorizedCronRequest(authorization: string | undefined) {
  const secret = getEnvironment('CRON_SECRET')
  return Boolean(secret && authorization === `Bearer ${secret}`)
}
