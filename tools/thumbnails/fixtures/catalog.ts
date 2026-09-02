/**
 * A minimal, valid `CatalogFile` for tests that need the shape but not the corpus.
 *
 * Built through `CatalogFile.parse`, so a test cannot accidentally exercise this
 * tool against an index the real schema would have rejected — which is the whole
 * reason `catalog.ts` parses rather than casts.
 */
import type { CatalogFile, SpriteSheet } from '../../../src/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '../../../src/catalog'

export interface TestRecord {
  id: string
  ord: number
  blob: string
  sprite?: boolean
  texture?: string
  bytes?: number
}

export interface TestCatalogOptions {
  records: readonly TestRecord[]
  sprite?: SpriteSheet
  thumbs?: string
}

export function testCatalog(options: TestCatalogOptions): CatalogFile {
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
      thumbs: options.thumbs ?? 'https://objects.example.test/thumbs',
      lod: 'https://objects.example.test/lod',
    },
    sprite: options.sprite ?? MEASURED_SPRITE_SHEET,
    tags: ['texture|test'],
    records: options.records.map((record) => ({
      id: record.id,
      ord: record.ord,
      blob: record.blob,
      file: record.id.slice(record.id.lastIndexOf('/') + 1),
      bytes: record.bytes ?? 1_000_000,
      sprite: record.sprite ?? true,
      family: record.id.slice(0, record.id.lastIndexOf('/')),
      design: 'design-1',
      name: 'Test Tile',
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'topper',
      ...(record.texture === undefined ? {} : { texture: record.texture }),
      tags: [0],
      foot: { shape: 'rect', w: 1, d: 1 },
    })),
  })
}

/** A 32-hex md5 built from a short seed, so tests can name blobs readably. */
export function blobOf(seed: string): string {
  return seed.padEnd(32, '0').slice(0, 32).toLowerCase().replace(/[^0-9a-f]/g, '0')
}
