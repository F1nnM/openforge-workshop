/**
 * The build-time project's boundary, proved by crossing it.
 *
 * `tsconfig.node.json` is a composite project, so it rejects an import of a file
 * outside its own `include` list with TS6307, and until row X4 it did not resolve
 * the `@/` alias at all. Two rows filed that as a defect against their own work:
 *
 *   - **C1** could not have `pipeline/build.ts` call `measureComposition` or
 *     `assertComposition`, so the composition checks live only in the app's test
 *     suite, beside A1's aggregation check rather than with it.
 *   - **W7** could not have `pipeline/catalog.test.ts` import `footprintKey` or
 *     `printOption`, so its footprint cross-check runs at the coarser
 *     granularity both sides could spell — the discriminant, not the key.
 *
 * X4 took both, and added `src/share/manifest.ts` for its own step. An enabling
 * config change with no consumer is indistinguishable from no change at all —
 * the series has shipped one guard already that could not fail — so this file is
 * the consumer. It imports across each of the three boundaries **and calls what
 * it imports**, which means:
 *
 *   - deleting an `include` entry fails `npm run typecheck` with TS6307;
 *   - deleting `paths` fails it with an unresolved `@/catalog` inside the
 *     imported module;
 *   - and the assertions below fail if the imported functions stop behaving,
 *     rather than merely existing.
 *
 * It lives in `tools/hygiene/` beside the control-byte guard because it is the
 * same kind of thing: a property of the repository rather than of a feature.
 */
import { describe, expect, it } from 'vitest'

import { printOption } from '../../src/assembly/assemblyIndex'
import { footprintKey } from '../../src/assembly/footprint'
import type { TileId } from '../../src/catalog'
import { MEASURED_SPRITE_SHEET } from '../../src/catalog'
import { MAX_DEAD_END_RATE, assertComposition, measureComposition } from '../../src/composition'
import { buildShareManifest } from '../../src/share/manifest'
import { blobOf, testCatalog } from '../measure/fixtures/catalog'

describe('src/assembly, for row W7', () => {
  it('resolves footprintKey through the @/ alias', () => {
    // `footprint.ts` imports `@/catalog`, so this fails without `paths`.
    expect(footprintKey({ shape: 'rect', w: 1, d: 1 })).toBe('rect:1x1')
    expect(footprintKey({ shape: 'none' })).toBeUndefined()
  })

  it('resolves printOption, the fold pipeline/catalog.test.ts wanted to compare against', () => {
    // Segment two onwards, which is the `connection|side|openlock` lesson one
    // namespace over — and the reason W7 wanted the real function rather than a
    // second copy of the rule in the pipeline's tests.
    expect(printOption(['connection|openlock|topless'])).toBe('topless')
    expect(printOption(['connection|topless'])).toBe('plain')
    expect(printOption(['texture|cave'])).toBe('plain')
  })
})

describe('src/composition, for row C1', () => {
  it('runs measureComposition and assertComposition where the build runs', () => {
    const file = testCatalog([
      { id: 'tiles/test/a.stl', ord: 1, blob: blobOf('aa') },
      { id: 'tiles/test/b.stl', ord: 2, blob: blobOf('bb') },
    ])
    const report = measureComposition(file)
    expect(report).toMatchObject({ slots: 0 })
    expect(MAX_DEAD_END_RATE).toBeGreaterThan(0)
  })

  it('is a corpus assertion, which is the argument for moving it into the build', () => {
    // `assertComposition` refuses an index with no `constrain` refs at all,
    // because C1's whole reading of `constrain` rests on the split between 91
    // exact `require` refs and 4 namespace-root `constrain` ones. So it cannot
    // be satisfied by a fixture — it has to run where the corpus is, which is
    // `pipeline/build.ts`, which is what C1 asked this tsconfig entry for. This
    // asserts the refusal so the capability is proved rather than assumed.
    const bare = testCatalog([{ id: 'tiles/test/a.stl', ord: 1, blob: blobOf('aa') }])
    expect(() => {
      assertComposition(measureComposition(bare))
    }).toThrow(/namespace root/)
  })
})

describe('src/share/manifest.ts, for row X4', () => {
  it('builds a share manifest from a catalog inside the build-time project', () => {
    const file = testCatalog([{ id: 'tiles/test/a.stl', ord: 7, blob: blobOf('aa') }])
    const manifest = buildShareManifest(file)
    expect(manifest.version).toBe(file.version.manifest)
    expect(manifest.tileOf(7)).toBe('tiles/test/a.stl')
    expect(manifest.ordinalOf('tiles/test/a.stl' as TileId)).toBe(7)
  })
})

describe('src/catalog, the entry this file inherited', () => {
  it('is still reachable, so a widened include cannot have narrowed it', () => {
    expect(MEASURED_SPRITE_SHEET.cols).toBeGreaterThan(0)
  })
})
