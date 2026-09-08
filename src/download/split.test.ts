import { describe, expect, it } from 'vitest'

import type { AssemblyContext, AssemblyTemplate, BillOfTiles } from '@/assembly'
import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import type { BlobId, CatalogFile, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '@/catalog'
import { createCompositionIndex } from '@/composition'
import type { PlacementId, SlotName, TemplateId, TemplateInstance } from '@/store'

import type { GeneratedArchiveMesh, GeneratedArchiveSection } from './plan'
import { ArchivePartTooLargeError, SPLIT_OVERHEAD_BYTES, splitArchivePlans } from './split'

const MODELS = 'https://objects.openforge.tools/models'
const ASSETS = { models: MODELS }

/** A 32-hex md5 from a small integer, so fixtures can name blobs readably. */
function md5(n: number): string {
  return n.toString(16).padStart(32, '0')
}

interface RawRow {
  id: string
  blob: string
  bytes: number
}

/** A catalog file from a handful of rows, parsed through the real schema. See `download.test.ts:82-122`. */
function catalogOf(rows: readonly RawRow[]): CatalogFile {
  return CatalogFileSchema.parse({
    version: { schema: 1, pipeline: 1, fixtures: 'split-fixture', manifest: 1, built: '2026-09-01T12:00:00.000Z' },
    assets: {
      models: MODELS,
      sprites: 'https://objects.openforge.tools/sprites',
      thumbs: 'https://objects.openforge.tools/thumbs',
      lod: 'https://objects.openforge.tools/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: ['shape|wall'],
    records: rows.map((row, index) => {
      const cut = row.id.lastIndexOf('/')
      return {
        id: row.id,
        ord: index,
        blob: row.blob,
        file: row.id.slice(cut + 1),
        bytes: row.bytes,
        sprite: true,
        thumb: false,
        family: row.id.slice(0, cut),
        design: `d${row.id}`,
        name: row.id.slice(cut + 1),
        kinds: ['wall'],
        conn: ['openlock'],
        layer: 'integral',
        tags: [0],
        foot: { shape: 'wall', length: 1 },
      }
    }),
  })
}

/** One slot, so an instance is exactly one file. See `download.test.ts:141-147`. */
const FIXTURE_SLOT = 'model' as SlotName
const FIXTURE_TEMPLATE_ID = 'split-fixture' as TemplateId
const FIXTURE_TEMPLATE: AssemblyTemplate = { id: FIXTURE_TEMPLATE_ID, tags: [], parts: [{ name: FIXTURE_SLOT, tags: {} }] }

function place(tileId: string, at: number): TemplateInstance {
  return {
    id: `p${String(at)}` as PlacementId,
    template: FIXTURE_TEMPLATE_ID,
    x: 0,
    z: 0,
    rotation: 0,
    fills: { [FIXTURE_SLOT]: { tile: tileId as TileId, pinned: false } },
    position: [],
  }
}

function contextFor(catalog: CatalogFile): AssemblyContext {
  return { templates: (id) => (id === FIXTURE_TEMPLATE_ID ? FIXTURE_TEMPLATE : undefined), composition: createCompositionIndex(catalog) }
}

/** One instance per row, so a bill's lines are exactly the rows named. */
function billOf(rows: readonly RawRow[]): BillOfTiles {
  const catalog = catalogOf(rows)
  return buildBillOfTiles(rows.map((row, i) => place(row.id, i)), buildAssemblyIndex(catalog), contextFor(catalog))
}

describe('splitArchivePlans', () => {
  it('returns one plan when everything already fits', () => {
    const bill = billOf([
      { id: 'tiles/a', blob: md5(1), bytes: 1_000 },
      { id: 'tiles/b', blob: md5(2), bytes: 2_000 },
    ])
    const plans = splitArchivePlans(bill, { assets: ASSETS, limitBytes: SPLIT_OVERHEAD_BYTES + 1_000_000 })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.files).toHaveLength(2)
  })

  it('splits into the fewest parts that fit, largest files first', () => {
    const budget = 10_000_000
    const limit = budget + SPLIT_OVERHEAD_BYTES
    // 6 MB + 6 MB cannot share a part; each pairs with one of the 4 MB files instead.
    const bill = billOf([
      { id: 'tiles/big1', blob: md5(1), bytes: 6_000_000 },
      { id: 'tiles/big2', blob: md5(2), bytes: 6_000_000 },
      { id: 'tiles/small1', blob: md5(3), bytes: 4_000_000 },
      { id: 'tiles/small2', blob: md5(4), bytes: 4_000_000 },
    ])
    const plans = splitArchivePlans(bill, { assets: ASSETS, limitBytes: limit })
    expect(plans).toHaveLength(2)
    for (const plan of plans) expect(plan.predictedLength).toBeLessThanOrEqual(limit)
    expect(plans.reduce((sum, plan) => sum + plan.files.length, 0)).toBe(4)
  })

  it('names parts sequentially against the whole-archive default filename', () => {
    const bill = billOf([
      { id: 'tiles/a', blob: md5(1), bytes: 6_000_000 },
      { id: 'tiles/b', blob: md5(2), bytes: 6_000_000 },
    ])
    const plans = splitArchivePlans(bill, {
      assets: ASSETS,
      limitBytes: 6_000_000 + SPLIT_OVERHEAD_BYTES,
      generatedAt: new Date('2026-01-15T00:00:00Z'),
    })
    expect(plans.map((p) => p.filename)).toEqual([
      'openforge-room-2026-01-15-part-1-of-2.zip',
      'openforge-room-2026-01-15-part-2-of-2.zip',
    ])
  })

  it('is deterministic: the same bill packs into byte-identical parts every time', () => {
    const rows = [
      { id: 'tiles/a', blob: md5(1), bytes: 5_000_000 },
      { id: 'tiles/b', blob: md5(2), bytes: 3_000_000 },
      { id: 'tiles/c', blob: md5(3), bytes: 4_000_000 },
      { id: 'tiles/d', blob: md5(4), bytes: 1_000_000 },
    ]
    const options = { assets: ASSETS, limitBytes: 8_000_000, generatedAt: new Date('2026-01-15T00:00:00Z') }
    const first = splitArchivePlans(billOf(rows), options)
    const second = splitArchivePlans(billOf(rows), options)
    expect(first.map((p) => p.entries.map((e) => e.name))).toEqual(second.map((p) => p.entries.map((e) => e.name)))
  })

  it('refuses a single file too large for any part', () => {
    const bill = billOf([{ id: 'tiles/huge', blob: md5(1), bytes: 20_000_000 }])
    expect(() => splitArchivePlans(bill, { assets: ASSETS, limitBytes: 10_000_000 })).toThrow(ArchivePartTooLargeError)
  })

  it('puts a generated mesh in a part and carries the notice with it', () => {
    const bill = billOf([{ id: 'tiles/a', blob: md5(1), bytes: 1_000 }])
    const mesh: GeneratedArchiveMesh = {
      blob: md5(2) as BlobId,
      bytes: 2_000_000,
      stem: 'base.stl',
      recipes: ['abc12345'],
      quantity: 1,
    }
    const section: GeneratedArchiveSection = { meshes: [mesh], notice: { name: 'GENERATED.txt', text: 'notice text' } }
    const plans = splitArchivePlans(bill, { assets: ASSETS, limitBytes: SPLIT_OVERHEAD_BYTES + 3_000_000, generated: section })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.generated).toHaveLength(1)
    expect(plans[0]?.entries.some((e) => e.kind === 'text' && e.name === 'GENERATED.txt')).toBe(true)
  })
})
