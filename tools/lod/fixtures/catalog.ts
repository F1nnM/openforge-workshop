/**
 * A minimal, valid `CatalogFile` for tests that need the shape but not the corpus.
 *
 * Built through `CatalogFile.parse`, so a test cannot accidentally exercise this
 * tool against an index the real schema would have rejected — which is the whole
 * reason `catalog.ts` parses rather than casts.
 */
import type { BlobId, CatalogFile } from '../../../src/catalog'
import { BlobId as BlobIdSchema, CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '../../../src/catalog'

export interface TestRecord {
  id: string
  ord: number
  blob: string
  design?: string
  texture?: string
  bytes?: number
}

export interface TestCatalogOptions {
  records: readonly TestRecord[]
  /** Overridable so a store on a different origin from the meshes can be exercised. */
  models?: string
  /** Overrides `assets.lod`; must sit beside `thumbs` or `lodBase` refuses it. */
  readonly lod?: string
  /** Overrides `assets.thumbs` — the sibling `lodBase` checks `lod` against. */
  readonly thumbs?: string
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
      models: options.models ?? 'https://objects.example.test/models',
      sprites: 'https://objects.example.test/sprites',
      thumbs: options.thumbs ?? 'https://objects.example.test/thumbs',
      lod: options.lod ?? 'https://objects.example.test/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: ['texture|test'],
    records: options.records.map((record) => ({
      id: record.id,
      ord: record.ord,
      blob: record.blob,
      file: record.id.slice(record.id.lastIndexOf('/') + 1),
      bytes: record.bytes ?? 1_000_000,
      sprite: true,
      thumb: false,
      family: record.id.slice(0, record.id.lastIndexOf('/')),
      design: record.design ?? 'design-1',
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

/**
 * Brand a 32-hex string as a `BlobId`.
 *
 * Parsed rather than cast: `BlobId` is branded precisely so a tile id cannot be
 * passed where a content address belongs, and a test that casts around the brand
 * is a test that would not have caught the mistake the brand exists for.
 */
export function asBlob(value: string): BlobId {
  return BlobIdSchema.parse(value)
}
