// Bybit officially serves the same mainnet V5 API from api.bytick.com. The
// api.bybit.com hostname is unavailable from the Vercel runtime, while this
// alternate official hostname is reachable there.
const BYBIT_KLINE_URL = 'https://api.bytick.com/v5/market/kline'
const ALLOWED_INTERVALS = new Set(['5', '15', '60', '240', 'D'])

type Query = Record<string, string | string[] | undefined>

export function buildKlineRequestUrl(query: Query): string | undefined {
  const category = query.category
  const symbol = query.symbol
  const interval = query.interval
  const requestedLimit = query.limit
  if (category !== 'linear' || typeof symbol !== 'string' || !/^[A-Z0-9]{3,24}USDT$/.test(symbol)) return undefined
  if (typeof interval !== 'string' || !ALLOWED_INTERVALS.has(interval)) return undefined

  const limit = typeof requestedLimit === 'string' ? Number(requestedLimit) : 1000
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return undefined

  return `${BYBIT_KLINE_URL}?${new URLSearchParams({ category, symbol, interval, limit: String(limit) })}`
}

export default async function handler(request: { method?: string, query: Query }, response: any) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' })

  const url = buildKlineRequestUrl(request.query)
  if (!url) return response.status(400).json({ error: 'Invalid kline request' })

  try {
    const upstream = await fetch(url)
    const payload = await upstream.json()
    response.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=20')
    return response.status(upstream.status).json(payload)
  } catch {
    return response.status(502).json({ error: 'Unable to load Bybit candles' })
  }
}
