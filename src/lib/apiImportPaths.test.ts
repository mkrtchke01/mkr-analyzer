// @ts-expect-error Node's fs types are supplied by the Vitest runtime, not the browser bundle.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const functionFiles = [
  new URL('../../api/signals/index.ts', import.meta.url),
  new URL('../../api/signals/scan.ts', import.meta.url),
]

describe('serverless function imports', () => {
  it('uses explicit .js extensions for local ESM dependencies', () => {
    for (const file of functionFiles) {
      const source = readFileSync(file, 'utf8')
      const localImports = [...source.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)].map((match) => match[1])

      expect(localImports).not.toHaveLength(0)
      expect(localImports.every((path) => path.endsWith('.js'))).toBe(true)
    }
  })
})
