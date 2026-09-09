/**
 * The work list: which blobs this tool reads, and what it claims each one is.
 *
 * The fixture is built inline through `CatalogFile.parse` rather than reused
 * from `tools/measure/fixtures/catalog.ts`, because that builder fixes every
 * record's `layer` to `topper` and exposes no `config` — and those two fields
 * are precisely the axes a mount target is selected on. Parsing rather than
 * casting is the point: a target list assembled from an index the real schema
 * would have rejected would be a work list for a corpus that does not exist.
 */
import { describe, expect, it } from 'vitest'

import type { BlobId, CatalogFile, Footprint, Layer, PartSlot } from '../../src/catalog'
import { BlobId as BlobIdSchema, CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '../../src/catalog'

import { modelUrl, mountTargets } from './catalog'

interface TestRecord {
  readonly id: string
  readonly ord: number
  readonly blob: BlobId
  readonly layer?: Layer
  readonly bytes?: number
  readonly foot?: Footprint
  readonly parts?: readonly PartSlot[]
}

/** A 32-hex md5 from a readable seed, so a failure names a blob you can find. */
function blobOf(seed: string): BlobId {
  return BlobIdSchema.parse(seed.padEnd(32, '0').slice(0, 32).toLowerCase().replace(/[^0-9a-f]/g, '0'))
}

function catalogOf(records: readonly TestRecord[]): CatalogFile {
  return CatalogFileSchema.parse({
    version: { schema: 1, pipeline: 1, fixtures: 'test-fixtures', manifest: 1, built: '2026-01-01T00:00:00.000Z' },
    assets: {
      models: 'https://objects.example.test/models',
      sprites: 'https://objects.example.test/sprites',
      thumbs: 'https://objects.example.test/thumbs',
      lod: 'https://objects.example.test/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: ['texture|test'],
    records: records.map((record) => ({
      id: record.id,
      ord: record.ord,
      blob: record.blob,
      file: record.id.slice(record.id.lastIndexOf('/') + 1),
      bytes: record.bytes ?? 1_000_000,
      sprite: true,
      thumb: false,
      family: record.id.slice(0, record.id.lastIndexOf('/')),
      design: 'design-1',
      name: 'Test Tile',
      kinds: ['wall'],
      conn: ['openlock'],
      layer: record.layer ?? 'topper',
      tags: [0],
      foot: record.foot ?? { shape: 'rect', w: 2, d: 2 },
      ...(record.parts === undefined ? {} : { config: { parts: record.parts } }),
    })),
  })
}

const DOOR: PartSlot = { name: 'door', tags: { require: [{ tag: 'component|door' }, { tag: 'size|wide' }] } }
const BASE: PartSlot = { name: 'base', optional: true, tags: { require: [{ tag: 'shape|base' }] } }

/** One host, one base-only tile, one insert — the three cases, once each. */
const CORPUS = catalogOf([
  { id: 'tiles/walls/door-wall.stl', ord: 0, blob: blobOf('aa'), parts: [BASE, DOOR] },
  { id: 'tiles/walls/plain-wall.stl', ord: 1, blob: blobOf('bb'), parts: [BASE] },
  { id: 'tiles/inserts/door.stl', ord: 2, blob: blobOf('cc'), layer: 'insert', foot: { shape: 'none' } },
])

describe('mountTargets', () => {
  it('takes every file with a non-base slot as a host, and every insert, once per blob', () => {
    const { targets, hosts, inserts } = mountTargets(CORPUS)

    expect(new Set(targets.map((t) => t.blob)).size).toBe(targets.length)
    expect(hosts + inserts).toBe(targets.length)
    expect({ hosts, inserts }).toEqual({ hosts: 1, inserts: 1 })
    for (const target of targets.filter((t) => t.kind === 'host')) {
      expect(target.slots.length).toBeGreaterThan(0)
    }
  })

  it('leaves a tile whose only slot is a base out of the work list', () => {
    const { targets } = mountTargets(CORPUS)
    expect(targets.map((t) => t.blob)).not.toContain(blobOf('bb'))
  })

  it('flattens each slot\'s require refs to tag strings', () => {
    const host = mountTargets(CORPUS).targets.find((t) => t.blob === blobOf('aa'))
    expect(host?.slots).toEqual([{ name: 'door', require: ['component|door', 'size|wide'] }])
  })

  it('sums the bytes of the deduped targets, not of the rows', () => {
    const shared = catalogOf([
      { id: 'tiles/walls/a.stl', ord: 0, blob: blobOf('aa'), bytes: 400, parts: [DOOR] },
      { id: 'tiles/walls/b.stl', ord: 1, blob: blobOf('aa'), bytes: 400, parts: [DOOR] },
    ])
    const { targets, bytes } = mountTargets(shared)
    expect(targets).toHaveLength(1)
    expect(targets[0]?.ids).toEqual(['tiles/walls/a.stl', 'tiles/walls/b.stl'])
    expect(bytes).toBe(400)
  })

  it('unions the slots of every row sharing a blob, so no consumer name is unmeasured', () => {
    const shared = catalogOf([
      { id: 'tiles/walls/a.stl', ord: 0, blob: blobOf('aa'), parts: [DOOR] },
      {
        id: 'tiles/walls/b.stl',
        ord: 1,
        blob: blobOf('aa'),
        parts: [{ name: 'window', tags: { require: [{ tag: 'component|window' }] } }],
      },
    ])
    expect(mountTargets(shared).targets[0]?.slots.map((slot) => slot.name)).toEqual(['door', 'window'])
  })

  it('files a blob that is both a host and an insert as one host that also gets an anchor', () => {
    const both = catalogOf([
      { id: 'tiles/walls/host.stl', ord: 0, blob: blobOf('dd'), parts: [DOOR] },
      { id: 'tiles/inserts/host.stl', ord: 1, blob: blobOf('dd'), layer: 'insert' },
    ])
    const { targets, hosts, inserts, alsoInserts } = mountTargets(both)

    expect(targets).toHaveLength(1)
    expect(targets[0]?.kind).toBe('host')
    expect(targets[0]?.alsoInsert).toBe(true)
    // One target, so one host and no *separate* insert — the anchor is measured
    // from the same read, which `alsoInserts` is what counts.
    expect({ hosts, inserts, alsoInserts }).toEqual({ hosts: 1, inserts: 0, alsoInserts: 1 })
  })

  it('carries the footprint of the lowest-ordinal row, in manifest order', () => {
    const { targets } = mountTargets(CORPUS)
    expect(targets.map((t) => t.ord)).toEqual([0, 2])
    expect(targets[0]?.foot).toEqual({ shape: 'rect', w: 2, d: 2 })
  })
})

describe('modelUrl', () => {
  it('is the sharded STL key under the index\'s own models base', () => {
    expect(modelUrl(CORPUS, blobOf('aa'))).toBe(
      `https://objects.example.test/models/${blobOf('aa').slice(0, 6)}/${blobOf('aa')}.stl`,
    )
  })
})
