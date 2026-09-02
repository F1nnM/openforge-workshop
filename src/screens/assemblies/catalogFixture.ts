/**
 * A tiny catalog for the unit tests, built through `CatalogFile.parse`.
 *
 * `tools/measure/fixtures/catalog.ts` is the nearest existing builder and it is
 * the wrong one here for two reasons, both structural rather than stylistic: it
 * fixes every record's `design` to `design-1`, so A1's aggregation collapses the
 * whole fixture into one item and a *grid* of items cannot be expressed; and it
 * has no `config` field at all, so neither a slot nor a `fulfills` can be. Every
 * behaviour this row has is about those two things.
 *
 * Parsed and not cast, for that builder's stated reason: a test must not be able
 * to exercise this model against an index the real schema would reject.
 *
 * Not a `*.test.ts`, because two test files share it — the headless model's and
 * the screen's.
 */
import type { CatalogFile, CompositionConfig } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '@/catalog'

export interface FixtureRecord {
  /** The tile id. Its last segment becomes `file`, its prefix `family`. */
  readonly id: string
  readonly ord: number
  /** A1 groups on this, so distinct values are distinct items in a grid. */
  readonly design: string
  /** The item's display name. Distinct names make a card assertable. */
  readonly name?: string
  /** Full tag strings; interned automatically. */
  readonly tags: readonly string[]
  /** Slots and `fulfills`, exactly as a fixture row carries them. */
  readonly config?: CompositionConfig
  readonly bytes?: number
}

/** A 32-hex md5 from a short seed, so a test can name blobs readably. */
function blobOf(seed: string): string {
  return seed.padEnd(32, '0').slice(0, 32).toLowerCase().replace(/[^0-9a-f]/g, '0')
}

export function fixtureCatalog(records: readonly FixtureRecord[]): CatalogFile {
  const vocabulary: string[] = []
  const intern = (tag: string): number => {
    const at = vocabulary.indexOf(tag)
    if (at !== -1) return at
    vocabulary.push(tag)
    return vocabulary.length - 1
  }
  // Every record needs a non-empty tag list and the table needs at least one id.
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
    records: records.map((record) => ({
      id: record.id,
      ord: record.ord,
      blob: blobOf(record.id.replace(/[^0-9a-f]/g, '')),
      file: record.id.slice(record.id.lastIndexOf('/') + 1),
      bytes: record.bytes ?? 1_000_000,
      sprite: true,
      family: record.id.slice(0, record.id.lastIndexOf('/')),
      design: record.design,
      name: record.name ?? record.design,
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'topper',
      tags: (record.tags.length > 0 ? record.tags : ['texture|test']).map(intern),
      foot: { shape: 'none' },
      ...(record.config === undefined ? {} : { config: record.config }),
    })),
  })
}
