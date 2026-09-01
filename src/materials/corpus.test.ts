/// <reference types="node" />
/**
 * The registry against the real catalog.
 *
 * Two things are proved here and nowhere else, both over the **whole** corpus
 * rather than a sample:
 *
 *   1. **Coverage is total.** Every texture root that exists in the corpus
 *      resolves to a family, every tile resolves to a family, and no tile falls
 *      through to `unknown` except the four that genuinely carry nothing to go
 *      on. The root list is read out of the index, never written down here — a
 *      hardcoded list of roots in a coverage test proves only that the list
 *      matches itself.
 *   2. **Every count `palette.ts` and `mapping.ts` state is live.** All 16
 *      `liveBlueprints` figures, the 89 untagged tiles, the 85 the part chain
 *      rescues, both wear counts, and the 38-vs-37 root discrepancy.
 *
 * The corpus is the emitted `public/catalog/catalog.json` (`npm run
 * import:catalog`), matching the convention in `src/assembly` and
 * `pipeline/catalog.test.ts`. When it is absent every corpus block **skips
 * loudly** — a banner on stderr and the reason in the suite name — because a
 * quietly skipped real-data test is worse than a failing one.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CatalogFile as CatalogFileSchema } from '@/catalog'

import type { MaterialId } from './index'
import {
  MATERIALS,
  MATERIAL_ORDER,
  TEXTURE_ROOT_MATERIAL,
  isWearTag,
  resolveMaterial,
} from './index'

/* ------------------------------------------------------------ reading the index */

interface Tile {
  readonly file: string
  readonly tags: readonly string[]
}

const CATALOG_PATH =
  process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

function loadTiles(): readonly Tile[] | undefined {
  if (!existsSync(CATALOG_PATH)) return undefined
  const file = CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
  return file.records.map((record) => ({
    file: record.file,
    tags: record.tags.map((id) => file.tags[id] ?? ''),
  }))
}

const loadedTiles = loadTiles()

if (loadedTiles === undefined) {
  process.stderr.write(
    [
      '',
      '='.repeat(72),
      '  materials/corpus.test: SKIPPED — no emitted catalog index.',
      `  Looked for: ${CATALOG_PATH}`,
      '  Build one with:  npm run import:catalog',
      '  Or point at one: OPENFORGE_CATALOG=/path/to/catalog.json',
      '='.repeat(72),
      '',
    ].join('\n'),
  )
}

// Safe: every block below is skipped when the index is absent.
const tiles = loadedTiles ?? []
const describeCorpus = loadedTiles === undefined ? describe.skip : describe

const resolutions = tiles.map((tile) => resolveMaterial(tile.tags, tile.file))

const textureTagsOf = (tile: Tile): readonly string[] =>
  tile.tags.filter((tag) => tag.startsWith('texture|'))

const rootOf = (tag: string): string => tag.split('|')[1] ?? ''

/** Every root appearing on any texture tag. Derived, never listed. */
const allRoots = new Set<string>(
  tiles.flatMap((tile) => textureTagsOf(tile).map(rootOf)).filter((root) => root !== ''),
)

/**
 * Every root that reaches `CatalogRecord.texture`, which PR 4 derives as the
 * root of the *first* texture tag on the tile.
 */
const firstPositionRoots = new Set<string>(
  tiles
    .map((tile) => textureTagsOf(tile)[0])
    .filter((tag): tag is string => tag !== undefined)
    .map(rootOf),
)

function countBy<T extends string>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

/* -------------------------------------------------------------------- the corpus */

describeCorpus('the corpus this registry was measured against', () => {
  it('is the whole live catalog', () => {
    expect(tiles).toHaveLength(8702)
    // Every tile must carry a filename and a resolved tag list, or the columns
    // below are measuring an empty shape rather than the corpus.
    expect(tiles.every((tile) => tile.file !== '')).toBe(true)
    expect(tiles.some((tile) => tile.tags.length > 0)).toBe(true)
  })
})

describeCorpus('coverage', () => {
  it('resolves every texture root in the corpus to a family', () => {
    for (const root of allRoots) {
      expect(TEXTURE_ROOT_MATERIAL[root], `unmapped texture root: ${root}`).toBeDefined()
      // A root that resolves to `unknown` is not coverage; it is a hole with a
      // colour in it.
      expect(TEXTURE_ROOT_MATERIAL[root]).not.toBe('unknown')
    }
  })

  it('maps every root, including the one that cannot currently reach `texture`', () => {
    // 38 roots exist; 37 reach `CatalogRecord.texture`, because `texture|stucco`
    // only ever appears alongside an alphabetically earlier root. Both numbers
    // are asserted, separately, because asserting either alone would be half a
    // truth. `mapping.ts` explains why the table stays complete at 38.
    expect(allRoots.size).toBe(38)
    expect(firstPositionRoots.size).toBe(37)
    const neverFirst = [...allRoots].filter((root) => !firstPositionRoots.has(root))
    expect(neverFirst).toEqual(['stucco'])
    expect(TEXTURE_ROOT_MATERIAL['stucco']).toBe('stucco')
  })

  it('never resolves a texture-tagged tile to unknown', () => {
    const failures = tiles
      .map((tile, position) => ({ tile, resolved: resolutions[position] }))
      .filter(
        ({ tile, resolved }) =>
          textureTagsOf(tile).length > 0 && resolved?.material === 'unknown',
      )
    expect(failures.map(({ tile }) => tile.file)).toEqual([])
  })

  it('reaches only the four tiles that genuinely carry nothing to go on', () => {
    const unclassified = tiles.filter((_, position) => resolutions[position]?.material === 'unknown')
    expect(unclassified).toHaveLength(4)
    // Named, so that a future retag which rescues one of them shows up as a
    // failure to be read rather than a number to be edited.
    expect(unclassified.map((tile) => tile.file).sort()).toEqual([
      'dungeon_stone#wall,secret_door+broken_section.2x.openforge.stl',
      'dungeon_stone#wall,secret_door+tamoachan_statue.2x.openforge.stl',
      'mine#beam+brace.stl',
      'necro_exsanguination_alter.stl',
    ])
  })

  it('rescues 85 of the 89 untagged tiles through the hint and part chain', () => {
    const untagged = tiles.filter((tile) => textureTagsOf(tile).length === 0)
    expect(untagged).toHaveLength(89)
    const rescued = untagged.filter(
      (tile) => resolveMaterial(tile.tags, tile.file).material !== 'unknown',
    )
    expect(rescued).toHaveLength(85)
  })
})

describeCorpus('the stated family counts', () => {
  it('re-derives all 16 `liveBlueprints` figures', () => {
    const counts = countBy(resolutions.map((resolved) => resolved.material))
    for (const id of MATERIAL_ORDER) {
      expect(counts.get(id) ?? 0, `liveBlueprints for ${id}`).toBe(MATERIALS[id].liveBlueprints)
    }
  })

  it('accounts for every tile exactly once', () => {
    const total = MATERIAL_ORDER.reduce((sum, id) => sum + MATERIALS[id].liveBlueprints, 0)
    expect(total).toBe(8702)
  })

  it('leaves no family with a stated count of zero', () => {
    // A family nothing resolves to is a colour spent for nothing, and it costs
    // every other family separation headroom.
    for (const id of MATERIAL_ORDER) {
      expect(MATERIALS[id].liveBlueprints).toBeGreaterThan(0)
    }
  })
})

describeCorpus('the two wear counts', () => {
  it('finds 1,562 tiles carrying a wear tag', () => {
    const carrying = tiles.filter((tile) => textureTagsOf(tile).some(isWearTag))
    expect(carrying).toHaveLength(1562)
  })

  it('resolves 1,538 of them worn — 17.7%, the figure §9 quotes', () => {
    const worn = resolutions.filter((resolved) => resolved.worn)
    expect(worn).toHaveLength(1538)
    expect((worn.length / tiles.length) * 100).toBeCloseTo(17.7, 1)
  })

  it('drops the flag on exactly the 24 pools set into eroded stone', () => {
    const dropped = tiles.filter(
      (tile, position) =>
        textureTagsOf(tile).some(isWearTag) && resolutions[position]?.worn === false,
    )
    expect(dropped).toHaveLength(24)
    for (const tile of dropped) {
      expect(resolveMaterial(tile.tags, tile.file).material).toBe('water')
    }
  })

  it('never changes the colour of a worn tile, over the whole corpus', () => {
    for (const resolved of resolutions) {
      if (!resolved.worn) continue
      const base = MATERIALS[resolved.material]
      expect(resolved.family.tint).toBe(base.tint)
      expect(resolved.family.edge).toBe(base.edge)
    }
  })
})

describeCorpus('what the renderer has to cache', () => {
  it('collapses 8,702 tiles onto 33 distinct materials', () => {
    // This is the number that makes instanced drawing affordable, and the reason
    // `Resolution.variantKey` exists. §4 withdrew TSL node materials partly
    // because they cannot share instanced geometry; a few dozen shared
    // `MeshStandardMaterial`s can.
    const keys = new Set(resolutions.map((resolved) => resolved.variantKey))
    expect(keys.size).toBe(33)
    expect(keys.size).toBeLessThan(MATERIAL_ORDER.length * 3)
  })

  it('never emits a variant key that does not name a real family', () => {
    for (const resolved of resolutions) {
      const family = resolved.variantKey.split('/')[0] as MaterialId
      expect(MATERIAL_ORDER).toContain(family)
    }
  })
})

describeCorpus('resolution is deterministic over the whole corpus', () => {
  it('gives the same answer with the tag list reversed', () => {
    for (const [position, tile] of tiles.entries()) {
      const reversed = resolveMaterial(tile.tags.slice().reverse(), tile.file)
      expect(reversed.material, tile.file).toBe(resolutions[position]?.material)
      expect(reversed.variantKey, tile.file).toBe(resolutions[position]?.variantKey)
      expect(reversed.worn, tile.file).toBe(resolutions[position]?.worn)
    }
  })

  it('gives the same answer twice', () => {
    const sample = tiles.slice(0, 200)
    for (const tile of sample) {
      expect(resolveMaterial(tile.tags, tile.file)).toEqual(resolveMaterial(tile.tags, tile.file))
    }
  })
})

/* -------------------------------------------------- cross-check the checked-in index */

const FIXTURES_DIR =
  process.env.OPENFORGE_FIXTURES ??
  '/home/finn/Repos/openforge-catalog/openforge/db/fixtures/blueprints'

const hasFixtures =
  existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))

if (!hasFixtures) {
  // Loud, per the convention in `src/catalog/schema.test.ts`: a real-data block
  // that skips in silence looks exactly like one that passed.
  console.warn(
    `[materials/corpus.test] Upstream fixture cross-check SKIPPED.\n` +
      `[materials/corpus.test] Looked in: ${FIXTURES_DIR}\n` +
      `[materials/corpus.test] Set OPENFORGE_FIXTURES to the blueprints directory to run it.\n` +
      `[materials/corpus.test] Everything above still ran against the emitted index.`,
  )
}

// This block compares the emitted index against the upstream fixtures, so it
// needs BOTH. Gating on the fixtures alone made it assert 8,702 === 0 whenever
// the index was missing but the fixtures were not.
const canCrossCheck = hasFixtures && loadedTiles !== undefined
const describeFixtures = canCrossCheck ? describe : describe.skip
const fixturesTitle = canCrossCheck
  ? 'against the upstream fixtures'
  : hasFixtures
    ? 'against the upstream fixtures — SKIPPED, no emitted index (npm run import:catalog)'
    : `against the upstream fixtures — SKIPPED, none at ${FIXTURES_DIR} (set OPENFORGE_FIXTURES)`

describeFixtures(fixturesTitle, () => {
  interface FixtureRow {
    readonly deprecated?: unknown
    readonly tags?: readonly string[]
  }

  const fixtureRoots = new Set<string>()
  let liveRows = 0
  if (hasFixtures) {
    for (const name of readdirSync(FIXTURES_DIR).filter((file) => file.endsWith('.json'))) {
      const rows = JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as FixtureRow[]
      for (const row of rows) {
        if (row.deprecated) continue
        liveRows += 1
        for (const tag of row.tags ?? []) {
          if (tag.startsWith('texture|')) fixtureRoots.add(rootOf(tag))
        }
      }
    }
  }

  it('confirms the checked-in index still describes the live corpus', () => {
    // If this fails, the emitted index has gone stale and every count above is
    // measuring history. That is the one way this suite could pass while being
    // wrong.
    expect(liveRows).toBe(tiles.length)
    expect([...fixtureRoots].sort()).toEqual([...allRoots].sort())
  })

  it('confirms every root in the upstream fixtures is mapped', () => {
    for (const root of fixtureRoots) {
      expect(TEXTURE_ROOT_MATERIAL[root], `unmapped texture root: ${root}`).toBeDefined()
    }
  })
})
