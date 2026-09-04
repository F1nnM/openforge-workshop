/**
 * A tiny catalog for the fill solver's unit tests.
 *
 * `screens/assemblies/catalogFixture.ts` is the nearest existing builder and it
 * cannot express this row's subject: it fixes `layer: 'topper'`, `conn:
 * ['openlock']`, `foot: { shape: 'none' }` and no `texture` on every record. The
 * fill solver's three interesting behaviours are exactly those fields — the base
 * ladder reads `layer`, `conn` and the print option off the connection tags, the
 * family preference reads `texture`, and `buildAssemblyIndex` keys its base pools
 * on the footprint. A builder that hard-codes them can only test the walk.
 *
 * Parsed through `CatalogFile` and never cast, for the reason every fixture in
 * this repo gives: a test must not be able to exercise the solver against an
 * index the real schema would reject.
 *
 * Not a `*.test.ts`, because two test files share it — `fill.test.ts` and
 * `relock.test.ts` — which is the same reason `src/store/fixture.ts` and
 * `src/builder/canvas/fixture.ts` are not either.
 */
import type { CatalogFile, CompositionConfig, Footprint, Layer } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '@/catalog'

/** One record, with everything the fill solver reads spellable and the rest defaulted. */
export interface FillFixtureRecord {
  /** The tile id. Its last segment becomes `file` and its prefix `family`. */
  readonly id: string
  /** Row A1 groups on this, so two records sharing it are two variants of one item. */
  readonly design: string
  readonly name?: string
  /** Full tag strings; interned in the order they are first seen. */
  readonly tags: readonly string[]
  /** `'base'` is what `buildAssemblyIndex` pools by footprint. Defaults to `'topper'`. */
  readonly layer?: Layer
  /** Connection tag values. The lock systems live here, and so does `topless`. */
  readonly conn?: readonly string[]
  readonly kinds?: readonly string[]
  /** The `texture` root the family preference compares. */
  readonly texture?: string
  /** Defaults to a 1x1 rect, so a base and a topper are congruent unless said otherwise. */
  readonly foot?: Footprint
  readonly sizeCode?: string
  readonly bytes?: number
  readonly config?: CompositionConfig
}

/**
 * A 32-hex md5 from the record's position and id.
 *
 * The position leads, so two ids whose hex letters happen to agree still get
 * distinct blobs — `blobsByFilename` and `byBlob` are real groupings in
 * `buildAssemblyIndex` and a fixture that collided in them would be testing
 * against a shared-mesh case it did not mean to write.
 */
function blobOf(seed: string, at: number): string {
  const digits = `${at.toString(16).padStart(4, '0')}${seed.replace(/[^0-9a-f]/g, '')}`
  return digits.padEnd(32, '0').slice(0, 32)
}

/**
 * A parsed catalog over these records, in the order given.
 *
 * The order is load-bearing: `@/composition`'s postings are in record order and
 * its candidate lists come back in it, so *this* is where a test decides which
 * candidate a first-in-order policy would take.
 */
export function fillFixture(records: readonly FillFixtureRecord[]): CatalogFile {
  const vocabulary: string[] = []
  const intern = (tag: string): number => {
    const at = vocabulary.indexOf(tag)
    if (at !== -1) return at
    vocabulary.push(tag)
    return vocabulary.length - 1
  }
  intern('texture|test')

  return CatalogFileSchema.parse({
    version: {
      schema: 1,
      pipeline: 1,
      fixtures: 'test',
      manifest: 1,
      built: '2026-01-01T00:00:00.000Z',
    },
    assets: {
      models: 'https://objects.example.test/models',
      sprites: 'https://objects.example.test/sprites',
      thumbs: 'https://objects.example.test/thumbs',
      lod: 'https://objects.example.test/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: vocabulary,
    records: records.map((record, at) => ({
      id: record.id,
      ord: at + 1,
      blob: blobOf(record.id, at),
      file: record.id.slice(record.id.lastIndexOf('/') + 1),
      bytes: record.bytes ?? 1_000_000,
      sprite: false,
      thumb: false,
      family: record.id.slice(0, Math.max(record.id.lastIndexOf('/'), 1)),
      design: record.design,
      name: record.name ?? record.design,
      kinds: record.kinds ?? [],
      conn: record.conn ?? [],
      layer: record.layer ?? 'topper',
      tags: (record.tags.length > 0 ? record.tags : ['texture|test']).map(intern),
      foot: record.foot ?? { shape: 'rect', w: 1, d: 1 },
      ...(record.texture === undefined ? {} : { texture: record.texture }),
      ...(record.sizeCode === undefined ? {} : { sizeCode: record.sizeCode }),
      ...(record.config === undefined ? {} : { config: record.config }),
    })),
  })
}
