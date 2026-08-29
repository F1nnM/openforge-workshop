/// <reference types="node" />
/**
 * Tests for the catalog contract.
 *
 * The load-bearing one is `real fixture data` at the bottom. A schema validated
 * only against fixtures written by the same person who wrote the schema proves
 * nothing except self-consistency, so that block reads the actual
 * `openforge-catalog` blueprint fixtures off disk, transforms every live row
 * with the minimum logic needed, and asserts the whole thing parses as a
 * `CatalogFile`. If the fixtures are not on this machine the block is skipped
 * loudly — never quietly passed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  BlobId,
  CatalogAssets,
  CatalogFile,
  CatalogRecord,
  CompositionConfig,
  DEFAULT_ROTATION_STEP_DEG,
  DesignId,
  Footprint,
  GRID_UNIT_MM,
  Layer,
  MEASURED_SPRITE_SHEET,
  ManifestOrdinal,
  SCHEMA_VERSION,
  TagId,
  TileId,
  WALL_THICKNESS_MM,
  WALL_THICKNESS_UNITS,
  resolveTags,
  shardedPath,
} from './schema'

/* --------------------------------------------------- compile-time assertions */

type Assert<T extends true> = T
type NotAssignable<A, B> = [A] extends [B] ? false : true

/**
 * The point of branding the two identities: passing an md5 where a catalog path
 * is expected must not compile. These fail `npm run typecheck`, not `npm test`,
 * which is exactly where a type-level guarantee should fail.
 */
export type _TileIdIsNotABlobId = Assert<NotAssignable<TileId, BlobId>>
export type _BlobIdIsNotATileId = Assert<NotAssignable<BlobId, TileId>>
export type _TagIdIsNotAnOrdinal = Assert<NotAssignable<TagId, ManifestOrdinal>>
export type _OrdinalIsNotATagId = Assert<NotAssignable<ManifestOrdinal, TagId>>

/* -------------------------------------------------------------- test helpers */

const tileId = (value: string): TileId => TileId.parse(value)
const blobId = (value: string): BlobId => BlobId.parse(value)
const designId = (value: string): DesignId => DesignId.parse(value)
const tagId = (value: number): TagId => TagId.parse(value)
const ordinal = (value: number): ManifestOrdinal => ManifestOrdinal.parse(value)

const assets = CatalogAssets.parse({
  models: 'https://objects.openforge.tools/models/',
  sprites: 'https://objects.openforge.tools/sprites/',
  thumbs: 'https://objects.openforge.tools/thumbs/',
})

/**
 * `Partial` will not do: `exactOptionalPropertyTypes` is on, so under it a
 * `Partial<CatalogRecord>` rejects `{ build: undefined }` — and "this field is
 * explicitly absent" is precisely what several tests below need to say.
 */
type Overrides = { [K in keyof CatalogRecord]?: CatalogRecord[K] | undefined }

function aRecord(over: Overrides = {}): CatalogRecord {
  return CatalogRecord.parse({
    id: 'tiles/cave/thick_wall/wall/corner/openlock/cave%corner.IL.openlock.stl',
    ord: 0,
    blob: '245be2585dd419be6f9e0f8d2e480a65',
    file: 'cave%corner.IL.openlock.stl',
    bytes: 12472284,
    sprite: true,
    family: 'tiles/cave/thick_wall/wall/corner/openlock',
    design: 'cave-corner-IL',
    name: 'Cave corner',
    kinds: ['wall', 'corner'],
    conn: ['openlock'],
    build: 'thick wall',
    layer: 'topper',
    texture: 'cave',
    tags: [0, 1],
    foot: { shape: 'rect', w: 1, d: 1 },
    rotStep: 90,
    sizeCode: 'IL',
    ...over,
  })
}

function aFile(records: CatalogRecord[], tags: string[] = ['shape|wall', 'texture|cave']): unknown {
  return {
    version: {
      schema: SCHEMA_VERSION,
      pipeline: 1,
      fixtures: '4282896a5ee0f1e6c2b0e9f8a7d1c3b5e9f0a1b2',
      manifest: 1,
      built: '2026-08-29T12:00:00.000Z',
    },
    assets,
    sprite: MEASURED_SPRITE_SHEET,
    tags,
    records,
  }
}

/* ------------------------------------------------------------------ constants */

describe('measured constants', () => {
  it('records the two mesh measurements', () => {
    expect(GRID_UNIT_MM).toBe(25.4)
    expect(WALL_THICKNESS_MM).toBe(12.7)
  })

  it('puts a wall at exactly half a grid unit, matching the 0.5 dimension rule', () => {
    // Two independent measurements agreeing is why both are trusted: the walls
    // measure half a unit, and every catalog dimension is a multiple of 0.5.
    expect(WALL_THICKNESS_UNITS).toBe(0.5)
    expect(WALL_THICKNESS_UNITS * GRID_UNIT_MM).toBe(WALL_THICKNESS_MM)
  })

  it('defaults rotation to 90 degrees', () => {
    expect(DEFAULT_ROTATION_STEP_DEG).toBe(90)
  })

  it('states the measured sprite layout', () => {
    expect(MEASURED_SPRITE_SHEET).toEqual({
      rows: 2,
      cols: 5,
      tile: 512,
      frames: 10,
      defaultFrame: 0,
    })
    expect(MEASURED_SPRITE_SHEET.rows * MEASURED_SPRITE_SHEET.cols).toBe(MEASURED_SPRITE_SHEET.frames)
  })
})

/* ------------------------------------------------------------------ footprint */

describe('Footprint', () => {
  it('accepts all four primitives', () => {
    expect(Footprint.parse({ shape: 'rect', w: 2, d: 1 })).toEqual({ shape: 'rect', w: 2, d: 1 })
    expect(Footprint.parse({ shape: 'wall', length: 4 })).toEqual({ shape: 'wall', length: 4 })
    expect(Footprint.parse({ shape: 'arc', radius: 2, angle: 90 })).toEqual({
      shape: 'arc',
      radius: 2,
      angle: 90,
    })
    expect(Footprint.parse({ shape: 'none' })).toEqual({ shape: 'none' })
  })

  it('gives a wall no depth field, because its depth is the 12.7 mm constant', () => {
    const wall = Footprint.parse({ shape: 'wall', length: 2, d: 99 })
    expect(wall).toEqual({ shape: 'wall', length: 2 })
    expect(wall).not.toHaveProperty('d')
  })

  it('keeps arcs off width and depth, which are design labels rather than measurements', () => {
    expect(Footprint.safeParse({ shape: 'arc', w: 2, d: 1 }).success).toBe(false)
  })

  it('rejects an unknown primitive and a zero extent', () => {
    expect(Footprint.safeParse({ shape: 'hex' }).success).toBe(false)
    expect(Footprint.safeParse({ shape: 'rect', w: 0, d: 1 }).success).toBe(false)
    expect(Footprint.safeParse({ shape: 'wall' }).success).toBe(false)
  })

  it('allows a 270 degree sweep, which the corner pieces really use', () => {
    expect(Footprint.parse({ shape: 'arc', radius: 1, angle: 270 })).toMatchObject({ angle: 270 })
  })
})

/* ----------------------------------------------------------------- identities */

describe('identities', () => {
  it('accepts a full_name path as a TileId', () => {
    expect(tileId('tiles/bases/foundations/base#foundation%brick/dragonlock/x.stl')).toBe(
      'tiles/bases/foundations/base#foundation%brick/dragonlock/x.stl',
    )
  })

  it('only accepts 32 lowercase hex characters as a BlobId', () => {
    expect(blobId('02e5007cca035ad01aa378c4f6752ddc')).toBe('02e5007cca035ad01aa378c4f6752ddc')
    expect(BlobId.safeParse('02E5007CCA035AD01AA378C4F6752DDC').success).toBe(false)
    expect(BlobId.safeParse('02e5007cca035ad01aa378c4f6752dd').success).toBe(false)
    expect(BlobId.safeParse('tiles/cave/x.stl').success).toBe(false)
  })

  it('lets two records share a blob but not an id', () => {
    // 171 md5 values are shared by 520 rows. The contract has to permit that and
    // reject the mirror image.
    const shared = '02e5007cca035ad01aa378c4f6752ddc'
    const a = aRecord({ id: tileId('tiles/a.stl'), ord: ordinal(0), blob: blobId(shared) })
    const b = aRecord({ id: tileId('tiles/b.stl'), ord: ordinal(1), blob: blobId(shared) })
    expect(CatalogFile.safeParse(aFile([a, b])).success).toBe(true)

    const clash = aRecord({ id: tileId('tiles/a.stl'), ord: ordinal(2) })
    const result = CatalogFile.safeParse(aFile([a, clash]))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('duplicate id')
  })

  it('builds the sharded storage path from the blob', () => {
    expect(shardedPath(blobId('02e5007cca035ad01aa378c4f6752ddc'))).toBe(
      '02e500/02e5007cca035ad01aa378c4f6752ddc',
    )
  })
})

/* --------------------------------------------------------------------- record */

describe('CatalogRecord', () => {
  it('treats an absent build tag as a state, not a missing value', () => {
    // 2,978 tiles (34.2%) carry no build| tag at all.
    const record = CatalogRecord.parse({ ...aRecord(), build: undefined })
    expect(record.build).toBeUndefined()
    expect(CatalogRecord.safeParse({ ...aRecord(), build: '' }).success).toBe(false)
  })

  it('allows a tile in two kind buckets and a tile in none', () => {
    // 19.6% of tiles land in 2+ buckets, 11.6% in none.
    expect(aRecord({ kinds: ['wall', 'corner'] }).kinds).toHaveLength(2)
    expect(aRecord({ kinds: [] }).kinds).toHaveLength(0)
  })

  it('allows two and three connection systems on one tile', () => {
    // 3,091 tiles (35.5%) carry 2-3 distinct systems.
    expect(aRecord({ conn: ['openlock', 'magnetic'] }).conn).toHaveLength(2)
    expect(aRecord({ conn: ['openlock', 'magnetic', 'dragonlock'] }).conn).toHaveLength(3)
    expect(aRecord({ conn: [] }).conn).toHaveLength(0)
  })

  it('accepts every layer and nothing else', () => {
    for (const layer of ['base', 'topper', 'integral', 'insert']) {
      expect(Layer.parse(layer)).toBe(layer)
    }
    expect(Layer.safeParse('wall').success).toBe(false)
  })

  it('lets a tile carry no texture root', () => {
    // 89 tiles (1.0%) carry no texture| tag and fall back to the unknown material.
    expect(aRecord({ texture: undefined }).texture).toBeUndefined()
  })

  it('accepts a rotation step that is not a multiple of 90', () => {
    // 893 tiles carry an angle that would never tile on a 90 degree step.
    expect(aRecord({ rotStep: 22.5 }).rotStep).toBe(22.5)
    expect(CatalogRecord.safeParse({ ...aRecord(), rotStep: 0 }).success).toBe(false)
  })

  it('rejects a non-integer byte count and a negative one', () => {
    expect(CatalogRecord.safeParse({ ...aRecord(), bytes: 1.5 }).success).toBe(false)
    expect(CatalogRecord.safeParse({ ...aRecord(), bytes: -1 }).success).toBe(false)
  })
})

/* ---------------------------------------------------------- composition config */

describe('CompositionConfig', () => {
  it('keeps the raw grammar without resolving it', () => {
    const config = CompositionConfig.parse({
      parts: [
        {
          name: 'base',
          optional: true,
          tags: {
            require: [{ tag: 'shape|base' }],
            deny: [{ tag: 'build|s2w' }],
            constrain: [{ filter: 'shape|floor' }, { tag: 'size|width' }],
          },
        },
      ],
    })
    const slot = config.parts?.[0]
    expect(slot?.tags.constrain).toEqual([{ filter: 'shape|floor' }, { tag: 'size|width' }])
    // No candidates, no resolution: `constrain` semantics are an open question
    // and this schema deliberately answers none of it.
    expect(slot).not.toHaveProperty('candidates')
  })

  it('treats an absent optional flag as required', () => {
    // 1,050 of 3,695 slots omit it; 2,645 (71.6%) are optional.
    const config = CompositionConfig.parse({
      parts: [{ name: 'base', tags: { require: [{ tag: 'shape|base|hallway' }] } }],
    })
    expect(config.parts?.[0]?.optional).toBeUndefined()
  })

  it('carries the slot id that groups sibling slots', () => {
    const config = CompositionConfig.parse({
      parts: [
        { id: 'grate', name: 'grate (left)', tags: { require: [{ tag: 'interface|grate' }] } },
        { id: 'grate', name: 'grate (right)', tags: { require: [{ tag: 'interface|grate' }] } },
      ],
    })
    expect(config.parts?.map((part) => part.id)).toEqual(['grate', 'grate'])
  })

  it('accepts the inverse relation', () => {
    expect(CompositionConfig.parse({ fulfills: [{ part: 'column' }] }).fulfills).toEqual([
      { part: 'column' },
    ])
  })
})

/* ----------------------------------------------------------------- file rules */

describe('CatalogFile', () => {
  it('rejects a tag id past the end of the intern table', () => {
    const result = CatalogFile.safeParse(aFile([aRecord({ tags: [tagId(0), tagId(9)] })]))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('out of range')
  })

  it('rejects two records sharing a manifest ordinal', () => {
    const a = aRecord({ id: tileId('tiles/a.stl'), ord: ordinal(7) })
    const b = aRecord({ id: tileId('tiles/b.stl'), ord: ordinal(7) })
    const result = CatalogFile.safeParse(aFile([a, b]))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('duplicate manifest ordinal')
  })

  it('does not require ordinals to be dense, because retired ones are never reissued', () => {
    const a = aRecord({ id: tileId('tiles/a.stl'), ord: ordinal(0) })
    const b = aRecord({ id: tileId('tiles/b.stl'), ord: ordinal(4211) })
    expect(CatalogFile.safeParse(aFile([a, b])).success).toBe(true)
  })

  it('de-interns tags through the table', () => {
    const file = CatalogFile.parse(aFile([aRecord({ tags: [tagId(1), tagId(0)] })]))
    const record = file.records[0]
    if (record === undefined) throw new Error('expected the parsed file to hold a record')
    expect(resolveTags(file, record)).toEqual(['texture|cave', 'shape|wall'])
  })

  it('throws rather than returning holes when a record and a table disagree', () => {
    const file = CatalogFile.parse(aFile([aRecord({ tags: [tagId(0)] })]))
    const stray = aRecord({ tags: [tagId(99)] })
    expect(() => resolveTags(file, stray)).toThrow(/not in the intern table/)
  })

  it('demands the version stamp every derived artefact shares', () => {
    const file = CatalogFile.parse(aFile([aRecord()]))
    expect(file.version.schema).toBe(SCHEMA_VERSION)
    expect(file.version.manifest).toBe(1)

    const noStamp = aFile([aRecord()]) as Record<string, unknown>
    delete noStamp.version
    expect(CatalogFile.safeParse(noStamp).success).toBe(false)
  })

  it('rejects a build timestamp without an offset', () => {
    const file = aFile([aRecord()]) as { version: { built: string } }
    file.version.built = '2026-08-29T12:00:00'
    expect(CatalogFile.safeParse(file).success).toBe(false)
  })
})

/* ----------------------------------------------------------------- round trip */

describe('round trip', () => {
  it('is stable through parse -> serialise -> parse', () => {
    const records = [
      aRecord({ id: tileId('tiles/a.stl'), ord: ordinal(0), foot: { shape: 'rect', w: 2, d: 1 } }),
      aRecord({
        id: tileId('tiles/b.stl'),
        ord: ordinal(1),
        foot: { shape: 'wall', length: 4 },
        build: undefined,
        texture: undefined,
        rotStep: undefined,
        sizeCode: undefined,
        kinds: [],
        conn: ['openforge', 'magnetic'],
        layer: 'base',
        design: designId('b'),
      }),
      aRecord({
        id: tileId('tiles/c.stl'),
        ord: ordinal(2),
        foot: { shape: 'arc', radius: 2, angle: 22.5 },
        sprite: false,
        config: {
          parts: [
            {
              name: 'base',
              optional: true,
              tags: {
                require: [{ tag: 'shape|base' }],
                deny: [{ tag: 'build|s2w' }],
                constrain: [{ filter: 'shape|wall' }, { tag: 'shape' }],
              },
            },
          ],
          fulfills: [{ part: 'column' }],
        },
      }),
      aRecord({ id: tileId('tiles/d.stl'), ord: ordinal(3), foot: { shape: 'none' } }),
    ]

    const first = CatalogFile.parse(aFile(records))
    const second = CatalogFile.parse(JSON.parse(JSON.stringify(first)) as unknown)
    const third = CatalogFile.parse(JSON.parse(JSON.stringify(second)) as unknown)

    expect(second).toEqual(first)
    expect(third).toEqual(second)
    expect(JSON.stringify(third)).toBe(JSON.stringify(first))
  })

  it('drops absent optionals rather than serialising nulls', () => {
    const record = aRecord({ build: undefined, texture: undefined, rotStep: undefined, sizeCode: undefined })
    const json = JSON.parse(JSON.stringify(CatalogRecord.parse(record))) as Record<string, unknown>
    expect('build' in json).toBe(false)
    expect('texture' in json).toBe(false)
    expect(CatalogRecord.safeParse({ ...record, build: null }).success).toBe(false)
  })
})

/* ------------------------------------------------------------ real fixture data */

/**
 * The fixture snapshot the importer reads. Absolute by default, matching
 * `docs/verify-catalog-facts.py`'s own `DEFAULT_FIXTURES`; override with
 * `OPENFORGE_FIXTURES` on a machine that keeps the catalog somewhere else.
 */
const FIXTURES_DIR =
  process.env.OPENFORGE_FIXTURES ?? '/home/finn/Repos/openforge-catalog/openforge/db/fixtures/blueprints'

/** The fixture row, as it really is. Parsing with this proves the shape too. */
const FixtureRow = z.object({
  deprecated: z.boolean().optional(),
  type: z.string(),
  metadata: z.boolean(),
  tags: z.array(z.string()),
  file_metadata: z.object({
    file: z.string(),
    file_modified_at: z.string(),
    full_name: z.string(),
    md5: z.string(),
    size: z.number().int().nonnegative(),
    storage_address: z.string(),
  }),
  images: z
    .array(
      z.object({
        image_name: z.string(),
        image_url: z.string(),
        sprite_metadata: z.object({
          angles: z.array(z.object({ index: z.number(), name: z.string(), camera_pos: z.array(z.number()) })),
          default_angle: z.number().int(),
          grid_cols: z.number().int(),
          grid_rows: z.number().int(),
          tile_size: z.number().int(),
        }),
      }),
    )
    .optional(),
  // The real test of the composition modelling: the fixture's own configs must
  // satisfy the schema this module publishes, unresolved and unmodified.
  config: CompositionConfig.optional(),
})
type FixtureRow = z.infer<typeof FixtureRow>

/* --- the minimum transform. NOT the importer: PR 4 owns pipeline/**. --------- */

const NON_RECT_MARKERS = ['curved', 'radial', 'concave', 'convex', 'hex']

/** Kind buckets, from `shape|` roots. PR 4 fixes the real vocabulary. */
const KIND_ROOTS = ['floor', 'wall', 'base', 'stairs', 'column', 'riser', 'angled']

/** Third-segment modifiers §5 folds away, and positions that are not systems. */
const CONNECTION_POSITIONS = ['side', 'bottom', 'left', 'right']

function segment(tags: string[], prefix: string, index: number): string | undefined {
  for (const tag of tags) {
    if (tag.startsWith(`${prefix}|`)) return tag.split('|')[index]
  }
  return undefined
}

function numericTag(tags: string[], prefix: string): number | undefined {
  const raw = segment(tags, prefix, prefix.split('|').length)
  if (raw === undefined) return undefined
  const value = Number(raw)
  // `size|width|sw` and `size|width|wot` are build markers, not widths.
  return Number.isFinite(value) ? value : undefined
}

/** Mirrors `footprint_kind()` in verify-catalog-facts.py, ordering included. */
function footprintOf(tags: string[]): Footprint {
  const radius = numericTag(tags, 'size|radius')
  if (radius !== undefined && radius > 0) {
    return { shape: 'arc', radius, angle: numericTag(tags, 'size|angle') ?? DEFAULT_ROTATION_STEP_DEG }
  }
  const joined = tags.join(' ')
  if (NON_RECT_MARKERS.some((marker) => joined.includes(marker))) return { shape: 'none' }

  const width = numericTag(tags, 'size|width')
  const depth = numericTag(tags, 'size|depth')
  if (width !== undefined && width > 0 && depth !== undefined && depth > 0) {
    return { shape: 'rect', w: width, d: depth }
  }
  if (width !== undefined && width > 0) return { shape: 'wall', length: width }
  return { shape: 'none' }
}

function kindsOf(tags: string[]): string[] {
  const roots = new Set<string>()
  for (const tag of tags) {
    if (!tag.startsWith('shape|')) continue
    const root = tag.split('|')[1]
    if (root !== undefined && KIND_ROOTS.includes(root)) roots.add(root)
  }
  return [...roots]
}

function connectionsOf(tags: string[]): string[] {
  const systems = new Set<string>()
  for (const tag of tags) {
    if (!tag.startsWith('connection|')) continue
    const parts = tag.split('|')
    const head = parts[1]
    if (head === undefined) continue
    // `connection|side|openlock` puts a position in segment 1, so taking it
    // blindly would invent a `side` system on 4,159 tiles.
    const system = CONNECTION_POSITIONS.includes(head) ? parts[2] : head
    if (system !== undefined && !CONNECTION_POSITIONS.includes(system)) systems.add(system)
  }
  return [...systems]
}

function layerOf(tags: string[]): Layer {
  if (tags.some((tag) => tag.startsWith('shape|base'))) return 'base'
  if (tags.some((tag) => tag.startsWith('component|') || tag.startsWith('interface|'))) return 'insert'
  if (tags.some((tag) => tag.startsWith('connection|openforge'))) return 'topper'
  return 'integral'
}

function toRecord(row: FixtureRow, ord: number, intern: (tag: string) => TagId): CatalogRecord {
  const { file_metadata: meta, tags } = row
  const build = segment(tags, 'build', 1)
  const texture = segment(tags, 'texture', 1)
  const sizeCode = segment(tags, 'size|openlock', 2)
  const rotStep = numericTag(tags, 'size|angle')
  const design = tags.filter((tag) => !tag.startsWith('connection|')).join(' ') || meta.full_name

  return CatalogRecord.parse({
    id: meta.full_name,
    ord,
    blob: meta.md5,
    file: basename(meta.full_name),
    bytes: meta.size,
    sprite: (row.images ?? []).length > 0,
    family: dirname(meta.full_name),
    design,
    name: basename(meta.file, '.stl'),
    kinds: kindsOf(tags),
    conn: connectionsOf(tags),
    ...(build === undefined ? {} : { build }),
    layer: layerOf(tags),
    ...(texture === undefined ? {} : { texture }),
    tags: tags.map(intern),
    foot: footprintOf(tags),
    ...(rotStep === undefined || rotStep <= 0 ? {} : { rotStep }),
    ...(sizeCode === undefined ? {} : { sizeCode }),
    ...(row.config === undefined ? {} : { config: row.config }),
  })
}

const fixtureFiles = existsSync(FIXTURES_DIR)
  ? readdirSync(FIXTURES_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort()
  : []

if (fixtureFiles.length === 0) {
  console.warn(
    `\n[schema.test] SKIPPED: the real-data tests need the openforge-catalog blueprint fixtures.\n` +
      `[schema.test] Looked in: ${FIXTURES_DIR}\n` +
      `[schema.test] Set OPENFORGE_FIXTURES to the blueprints directory to run them.\n` +
      `[schema.test] The handcrafted tests above passed, but they only prove self-consistency.\n`,
  )
}

const describeFixtures = fixtureFiles.length > 0 ? describe : describe.skip

/**
 * The reason rides in the suite name as well as on stderr, because the default
 * reporter prints a bare "14 skipped" and a silently skipped real-data test is
 * exactly the failure mode this block exists to prevent.
 */
const fixtureSuite =
  fixtureFiles.length > 0
    ? 'real fixture data'
    : `real fixture data — SKIPPED, no fixtures at ${FIXTURES_DIR} (set OPENFORGE_FIXTURES)`

describeFixtures(fixtureSuite, () => {
  const rows = fixtureFiles.flatMap((name) =>
    z.array(FixtureRow).parse(JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as unknown),
  )
  const live = rows.filter((row) => row.deprecated !== true)

  const table: string[] = []
  const index = new Map<string, TagId>()
  const intern = (tag: string): TagId => {
    const existing = index.get(tag)
    if (existing !== undefined) return existing
    const id = tagId(table.length)
    table.push(tag)
    index.set(tag, id)
    return id
  }
  const records = live.map((row, i) => toRecord(row, i, intern))

  it('found fixtures with deprecated rows to exclude', () => {
    expect(rows.length).toBeGreaterThan(8000)
    expect(live.length).toBeLessThan(rows.length)
  })

  it('validates the whole live corpus as one CatalogFile', () => {
    const result = CatalogFile.safeParse(aFile(records, table))
    if (!result.success) {
      throw new Error(`catalog did not validate: ${JSON.stringify(result.error.issues.slice(0, 5), null, 2)}`)
    }
    expect(result.data.records).toHaveLength(records.length)
    expect(result.data.tags.length).toBeGreaterThan(500)
  })

  it('produces all four footprint primitives, none of them empty', () => {
    const counts = new Map<string, number>()
    for (const record of records) counts.set(record.foot.shape, (counts.get(record.foot.shape) ?? 0) + 1)
    for (const shape of ['rect', 'wall', 'arc', 'none']) {
      expect(counts.get(shape) ?? 0).toBeGreaterThan(0)
    }
    // rect + wall is v1's builder scope and the plan puts it at 70.9%.
    const covered = ((counts.get('rect') ?? 0) + (counts.get('wall') ?? 0)) / records.length
    expect(covered).toBeGreaterThan(0.6)
    expect(covered).toBeLessThan(0.8)
  })

  it('finds real md5 values shared across different catalog paths', () => {
    // The reason blob is not the primary key. 171 md5 over 520 rows.
    const byBlob = new Map<string, Set<string>>()
    for (const record of records) {
      const ids = byBlob.get(record.blob) ?? new Set<string>()
      ids.add(record.id)
      byBlob.set(record.blob, ids)
    }
    const shared = [...byBlob.values()].filter((ids) => ids.size > 1)
    expect(shared.length).toBeGreaterThan(0)
    expect(new Set(records.map((record) => record.id)).size).toBe(records.length)
  })

  it('finds real filenames that map to more than one mesh', () => {
    // 89 of them; naming zip entries by filename would silently overwrite.
    const byFile = new Map<string, Set<string>>()
    for (const record of records) {
      const blobs = byFile.get(record.file) ?? new Set<string>()
      blobs.add(record.blob)
      byFile.set(record.file, blobs)
    }
    expect([...byFile.values()].filter((blobs) => blobs.size > 1).length).toBeGreaterThan(0)
  })

  it('finds tiles in two kind buckets and tiles in none', () => {
    expect(records.some((record) => record.kinds.length >= 2)).toBe(true)
    expect(records.some((record) => record.kinds.length === 0)).toBe(true)
  })

  it('finds tiles carrying two or more connection systems, and tiles carrying none', () => {
    expect(records.some((record) => record.conn.length >= 2)).toBe(true)
    expect(records.some((record) => record.conn.length === 0)).toBe(true)
    // The fold must not invent a `side` system.
    expect(records.some((record) => record.conn.includes('side'))).toBe(false)
    expect(records.some((record) => record.conn.includes('openforge'))).toBe(true)
  })

  it('finds a third of the corpus with no build tag', () => {
    const missing = records.filter((record) => record.build === undefined).length
    expect(missing / records.length).toBeGreaterThan(0.25)
    expect(missing / records.length).toBeLessThan(0.45)
  })

  it('finds tiles with no texture root, and covers well over thirty roots', () => {
    expect(records.some((record) => record.texture === undefined)).toBe(true)
    expect(new Set(records.map((record) => record.texture)).size).toBeGreaterThan(30)
  })

  it('finds rotation steps that are not multiples of 90', () => {
    expect(
      records.some((record) => record.rotStep !== undefined && record.rotStep % 90 !== 0),
    ).toBe(true)
  })

  it('validates every composition config the fixtures declare', () => {
    const withConfig = records.filter((record) => record.config !== undefined)
    expect(withConfig.length).toBeGreaterThan(1000)
    // Slots that omit `optional` are required, and they really occur.
    const slots = withConfig.flatMap((record) => record.config?.parts ?? [])
    expect(slots.some((slot) => slot.optional === undefined)).toBe(true)
    expect(slots.some((slot) => slot.optional === true)).toBe(true)
    expect(slots.some((slot) => (slot.tags.constrain?.length ?? 0) > 0)).toBe(true)
  })

  it('derives every storage address from the blob alone', () => {
    // Zero exceptions across the live corpus, which is why the record carries no URLs.
    for (const row of live) {
      const md5 = row.file_metadata.md5
      expect(row.file_metadata.storage_address).toBe(
        `${assets.models}${shardedPath(blobId(md5))}.stl`,
      )
      for (const image of row.images ?? []) {
        expect(image.image_url).toBe(`${assets.sprites}${shardedPath(blobId(md5))}.png`)
      }
    }
  })

  it('finds the sprite sheet layout uniform at the measured values', () => {
    for (const row of live) {
      for (const image of row.images ?? []) {
        const sheet = image.sprite_metadata
        expect(sheet.grid_rows).toBe(MEASURED_SPRITE_SHEET.rows)
        expect(sheet.grid_cols).toBe(MEASURED_SPRITE_SHEET.cols)
        expect(sheet.tile_size).toBe(MEASURED_SPRITE_SHEET.tile)
        expect(sheet.default_angle).toBe(MEASURED_SPRITE_SHEET.defaultFrame)
        expect(sheet.angles).toHaveLength(MEASURED_SPRITE_SHEET.frames)
      }
    }
    // And one live tile really has no sheet at all.
    expect(records.some((record) => !record.sprite)).toBe(true)
  })

  it('round-trips the real corpus through JSON unchanged', () => {
    const sample = records.filter((_, i) => i % 97 === 0)
    const file = CatalogFile.parse(aFile(sample, table))
    const again = CatalogFile.parse(JSON.parse(JSON.stringify(file)) as unknown)
    expect(again).toEqual(file)
    expect(JSON.stringify(again)).toBe(JSON.stringify(file))
  })
})
