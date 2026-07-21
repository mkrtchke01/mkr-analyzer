import { afterEach, describe, expect, it, vi } from 'vitest'
import { supabaseRequest } from './supabase'

describe('supabaseRequest', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('accepts an empty successful response from a return=minimal mutation', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'service-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 201 })))

    await expect(supabaseRequest('/rest/v1/mkr_signals', {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'tp1' }),
    })).resolves.toBeUndefined()
  })
})
