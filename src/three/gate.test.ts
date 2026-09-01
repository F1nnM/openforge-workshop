/// <reference types="node" />
/**
 * The gate, and the corpus coverage it implies.
 *
 * The unit assertions are the cheap half. The corpus block is the one that keeps
 * the number honest: `gate.ts`'s docblock quotes 88.8% of the archive as
 * viewable in 3D and 11.2% as staying on the sprite sheet, and those are the
 * figures the panel's copy is written around. Re-derived here from the emitted
 * index, so a re-import that shifted the distribution fails the build instead of
 * making the docblock quietly wrong.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CatalogFile } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'

import {
  STL_BINARY_FACET_BYTES,
  STL_BINARY_HEADER_BYTES,
  STL_GATE_BYTES,
  estimateBinaryTriangles,
  estimateGeometryBytes,
  formatMegabytes,
  stlGate,
} from './gate'

describe('STL_GATE_BYTES', () => {
  it('is 24 MiB — inside §8’s 20–25 MB band', () => {
    expect(STL_GATE_BYTES).toBe(25_165_824)
    expect(STL_GATE_BYTES).toBeGreaterThanOrEqual(20_000_000)
    expect(STL_GATE_BYTES).toBeLessThanOrEqual(25_600_000)
  })
})

describe('stlGate', () => {
  it('offers 3D at the median file size', () => {
    const decision = stlGate({ bytes: 10_364_884 })
    expect(decision.mode).toBe('stl')
    expect(decision.over).toBe(0)
  })

  it('offers 3D exactly at the limit', () => {
    expect(stlGate({ bytes: STL_GATE_BYTES }).mode).toBe('stl')
  })

  it('refuses one byte over, and says by how much', () => {
    const decision = stlGate({ bytes: STL_GATE_BYTES + 1 })
    expect(decision.mode).toBe('sprite')
    expect(decision.over).toBe(1)
  })

  it('refuses the p95 file and quotes its real size', () => {
    const decision = stlGate({ bytes: 32_891_184 })
    expect(decision.mode).toBe('sprite')
    expect(decision.reason).toContain('32.9 MB')
    expect(decision.reason).toContain('pre-rendered angles')
  })

  it('refuses the largest file in the corpus', () => {
    expect(stlGate({ bytes: 108_912_184 }).mode).toBe('sprite')
  })

  it('accepts the 84-byte file — emptiness is the parser’s problem, not the gate’s', () => {
    expect(stlGate({ bytes: 84 }).mode).toBe('stl')
  })

  it('refuses a record with no recorded size', () => {
    const decision = stlGate({ bytes: 0 })
    expect(decision.mode).toBe('sprite')
    expect(decision.reason).toContain('no file size')
  })

  it('honours an overridden limit, so the dev harness can force the refusal', () => {
    expect(stlGate({ bytes: 5_000_000 }, 1_000_000).mode).toBe('sprite')
  })
})

describe('estimates', () => {
  it('is exact for the binary layout', () => {
    const facets = 1234
    const bytes = STL_BINARY_HEADER_BYTES + facets * STL_BINARY_FACET_BYTES
    expect(estimateBinaryTriangles(bytes)).toBe(facets)
  })

  it('reports zero triangles for the 84-byte file', () => {
    expect(estimateBinaryTriangles(84)).toBe(0)
    expect(estimateGeometryBytes(84)).toBe(0)
  })

  it('matches the measured triangle counts of the median and p95 archive files', () => {
    // Both fetched from the live archive during this PR: 207,296 and 657,822.
    expect(estimateBinaryTriangles(10_364_884)).toBe(207_296)
    expect(estimateBinaryTriangles(32_891_184)).toBe(657_822)
  })

  it('doubles for the recomputed normals', () => {
    // 503,314 facets at the gate → 18.1 MB of positions and the same of normals.
    expect(estimateGeometryBytes(STL_GATE_BYTES)).toBeCloseTo(36_238_608, -3)
  })
})

describe('formatMegabytes', () => {
  it('matches the drawer’s own spec-grid format', () => {
    expect(formatMegabytes(10_364_884)).toBe('10.4 MB')
    expect(formatMegabytes(84)).toBe('0.0 MB')
  })
})

/* ------------------------------------------------------------------- corpus */

const CATALOG_PATH =
  process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

function loadCatalog(): CatalogFile | undefined {
  if (!existsSync(CATALOG_PATH)) return undefined
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
}

const loaded = loadCatalog()

if (loaded === undefined) {
  process.stderr.write(
    [
      '',
      '='.repeat(72),
      '  three/gate.test: corpus block SKIPPED — no emitted catalog index.',
      `  Looked for: ${CATALOG_PATH}`,
      '  Build one with:  npm run import:catalog',
      '='.repeat(72),
      '',
    ].join('\n'),
  )
}

const describeCorpus = loaded === undefined ? describe.skip : describe

describeCorpus('against the emitted index', () => {
  const catalog = loaded as CatalogFile

  it('lets 88.8% of the archive through, to the tenth', () => {
    const through = catalog.records.filter((record) => stlGate(record).mode === 'stl').length
    const share = (through / catalog.records.length) * 100

    expect(share).toBeCloseTo(88.8, 1)
    expect(through).toBe(7_724)
  })

  it('keeps 978 tiles on the sprite fallback', () => {
    const refused = catalog.records.filter((record) => stlGate(record).mode === 'sprite')
    expect(refused).toHaveLength(978)
    // Every refusal is a size refusal, not a missing-`bytes` refusal.
    expect(refused.every((record) => record.bytes > 0)).toBe(true)
  })

  it('never lets through a mesh whose arrays would exceed 40 MB', () => {
    const worst = Math.max(
      ...catalog.records
        .filter((record) => stlGate(record).mode === 'stl')
        .map((record) => estimateGeometryBytes(record.bytes)),
    )
    expect(worst).toBeLessThan(40_000_000)
  })

  it('decides for every record without a request', () => {
    // The point of gating on `bytes`: the whole corpus is decidable from memory.
    expect(catalog.records.every((record) => stlGate(record).reason.length > 0)).toBe(true)
  })
})
