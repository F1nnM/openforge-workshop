// @vitest-environment jsdom
/**
 * Guards the claim `loadCatalogIndex`'s docblock makes: one request and one
 * parse per session.
 *
 * The original memoised only the fetch, so validating 8,702 records ran again
 * for every caller — a measured ~100 ms paid by both the landing screen and the
 * catalog screen. A cheap assertion is worth more here than the comment was.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCatalogIndex, resetCatalogIndexCache } from '@/ui/shell'

const CATALOG_PATH =
  process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

const raw = existsSync(CATALOG_PATH)
  ? (JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
  : undefined

if (raw === undefined) {
  process.stderr.write(
    `\n${'='.repeat(72)}\n  shell/indexMemo.test: SKIPPED — no emitted catalog index.\n` +
      `  Looked for: ${CATALOG_PATH}\n  Build one with:  npm run import:catalog\n${'='.repeat(72)}\n\n`,
  )
}

const describeIndex = raw === undefined ? describe.skip : describe

describeIndex('loadCatalogIndex', () => {
  beforeEach(() => {
    resetCatalogIndexCache()
  })

  it('parses the whole index exactly once across callers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) })),
    )

    const beforeFirst = performance.now()
    await loadCatalogIndex()
    const firstMs = performance.now() - beforeFirst

    const beforeRest = performance.now()
    await Promise.all([loadCatalogIndex(), loadCatalogIndex(), loadCatalogIndex()])
    const restMs = performance.now() - beforeRest

    // Three further calls must be effectively free, not merely faster.
    expect(restMs).toBeLessThan(firstMs / 5)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})
