/// <reference types="node" />
/**
 * Tests for the download pack.
 *
 * Two halves, and they check different kinds of claim.
 *
 * The **synthetic** half builds tiny catalogs whose collisions and sizes are
 * chosen, and it is where the ZIP bytes are actually parsed: the archive is
 * streamed, its central directory is read back with a reader written here rather
 * than with the library that wrote it, and every entry's CRC-32 is recomputed
 * from the bytes that were meant to go in. That is the only way to show that the
 * archive holds the meshes it claims to, under the names it claims to, stored
 * rather than compressed.
 *
 * The **corpus** half places every live tile and asserts the naming invariant
 * over the real 8,702-row index — because "entry names are unique" is a claim
 * about the shape of the OpenForge catalog (89 filenames carrying two or three
 * meshes, 171 md5s shared by 520 rows) and a handcrafted fixture cannot falsify
 * it. It skips loudly when the index is absent, following `assembly.test.ts`: a
 * silently skipped data test is exactly the failure it exists to catch.
 *
 * Nothing here touches the network. `BlobSource` is the seam, and every test
 * supplies its own.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { AssemblyContext, AssemblyTemplate, BillOfTiles } from '@/assembly'
import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import type { BlobId, CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '@/catalog'
import { createCompositionIndex } from '@/composition'
import type { PlacementId, SlotName, TemplateId, TemplateInstance } from '@/store'

import { ATTRIBUTION_COLUMNS, attributionCsv, licenceText } from './attribution'
import { ZIP32_LIMIT, framingLength, needsZip64, predictZipLength, utf8Length } from './clientZip'
import { ArchiveNamingError, archiveEntryNames, sanitizePath } from './entries'
import type { ArchivePlan } from './plan'
import { EmptyArchiveError, buildArchivePlan } from './plan'
import {
  ArchiveTooLargeToBufferError,
  NoSaveTargetError,
  type SaveEnvironment,
  type SaveFileHandle,
  saveArchive,
} from './save'
import type { BlobSource } from './source'
import { PreviewMeshRefusedError, originalStlUrl, r2BlobSource } from './source'
import { ArchiveLengthMismatchError, openArchiveStream } from './stream'
import { urlListFilename, urlListText } from './urlList'

/* -------------------------------------------------------------- test fixtures */

const MODELS = 'https://objects.openforge.tools/models'
const ASSETS = { models: MODELS }
const GENERATED_AT = new Date('2026-09-01T12:00:00.000Z')

/** A 32-hex md5 from a small integer, so fixtures can name blobs readably. */
function md5(n: number): string {
  return n.toString(16).padStart(32, '0')
}

interface RawRow {
  /** Full catalog path. `family` and `file` are split from it. */
  id: string
  blob: string
  bytes: number
}

/**
 * A catalog file from a handful of rows.
 *
 * Parsed through the real `CatalogFile` schema rather than cast, so a fixture
 * that could not exist in production fails here instead of passing a test that
 * proves nothing. Every row is `integral`, which used to be what kept the bills
 * here predictable — before row A3 an `openforge` topper pulled in an
 * auto-inserted base. Nothing is auto-inserted now, so predictability comes from
 * {@link FIXTURE_TEMPLATE} instead: one slot, one file, one line.
 */
function catalogOf(rows: readonly RawRow[]): CatalogFile {
  return CatalogFileSchema.parse({
    version: {
      schema: 1,
      pipeline: 1,
      fixtures: 'test-fixture',
      manifest: 1,
      built: '2026-09-01T12:00:00.000Z',
    },
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
        // Derived from the id so `designFor` below is exact rather than a
        // parallel numbering that could drift from this one.
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

/**
 * A one-slot template, so an instance is exactly one file.
 *
 * The whole of what row A3 changed in this file. Every assertion here is about
 * *naming and framing* — entry names, collisions, zip lengths, the attribution
 * csv — so a bill has to list exactly the files a test named and nothing else.
 * Before A3 a `Placement` named a design and the resolver picked the file; now a
 * fill names the file, and this template is the smallest recipe that turns one
 * file into one instance.
 *
 * `tags: {}` is deliberate and is not a shortcut: a slot with no `require`,
 * `deny` or `accept` admits **every** record — `candidatesFor` starts from the
 * whole document list when the require set is empty — so every fixture fill is
 * admissible and no `fill-off-slot` note appears in any bill below. That keeps
 * these tests about naming rather than about C1's constraint semantics, which
 * `src/composition` already covers with 69 ported tests of its own.
 */
const FIXTURE_SLOT = 'model' as SlotName
const FIXTURE_TEMPLATE_ID = 'download-fixture' as TemplateId
const FIXTURE_TEMPLATE: AssemblyTemplate = {
  id: FIXTURE_TEMPLATE_ID,
  tags: [],
  parts: [{ name: FIXTURE_SLOT, tags: {} }],
}

/** One instance per file, so a bill's lines are the files the caller named. */
function place(tileId: string, at: number): TemplateInstance {
  return {
    id: `p${String(at)}` as PlacementId,
    template: FIXTURE_TEMPLATE_ID,
    x: 0,
    z: 0,
    rotation: 0,
    fills: { [FIXTURE_SLOT]: { tile: tileId as TileId, pinned: false } },
  }
}

/**
 * The context `buildBillOfTiles` requires: the template table, and the
 * composition index over the *same* catalog.
 *
 * Both are required arguments rather than defaulted options, which is row A3's
 * point — a resolution with no template has no slots to walk, and one with no
 * composition index cannot say whether a fill belongs in its slot, so a caller
 * that has not supplied them is a compile error rather than a quiet half-answer.
 */
function contextFor(catalog: CatalogFile): AssemblyContext {
  return {
    templates: (id) => (id === FIXTURE_TEMPLATE_ID ? FIXTURE_TEMPLATE : undefined),
    composition: createCompositionIndex(catalog),
  }
}

function billOf(catalog: CatalogFile, ids: readonly string[]): BillOfTiles {
  return buildBillOfTiles(ids.map(place), buildAssemblyIndex(catalog), contextFor(catalog))
}

function planOf(catalog: CatalogFile, ids: readonly string[]): ArchivePlan {
  return buildArchivePlan(billOf(catalog, ids), { assets: ASSETS, generatedAt: GENERATED_AT })
}

/**
 * Deterministic stand-in bytes for a blob.
 *
 * A repeating byte derived from the md5, so a CRC computed here and a CRC read
 * out of the archive can only agree if the right content landed under the right
 * name.
 */
function contentFor(blob: string, bytes: number): Uint8Array {
  return new Uint8Array(bytes).fill(Number.parseInt(blob.slice(-2), 16))
}

/** A `BlobSource` over an in-memory map. No network, ever. */
function sourceOf(files: ReadonlyMap<string, Uint8Array>): BlobSource {
  return {
    urlFor: (blob) => originalStlUrl(ASSETS, blob),
    open: (blob) => {
      const content = files.get(blob)
      if (content === undefined) return Promise.reject(new Error(`no fixture content for ${blob}`))
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(content)
            controller.close()
          },
        }),
      )
    },
  }
}

/** The source a plan's own entries imply, at their declared sizes. */
function sourceForPlan(plan: ArchivePlan): BlobSource {
  return sourceOf(new Map(plan.files.map((file) => [file.blob as string, contentFor(file.blob, file.bytes)])))
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value !== undefined) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/* ------------------------------------------------------------- a ZIP reader */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xff_ff_ff_ff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xff_ff_ff_ff) >>> 0
}

interface ZipDirectoryEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  utf8: boolean
}

/**
 * Read an archive's central directory.
 *
 * Written here rather than taken from a library on purpose: parsing the output
 * with the same code that produced it would agree with itself whatever it did.
 * Only the non-ZIP64 layout is handled, which is all the streamed fixtures need —
 * the ZIP64 boundary is checked arithmetically instead, since tripping it for
 * real means moving four gigabytes through a unit test.
 */
function readCentralDirectory(zip: Uint8Array): ZipDirectoryEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const eocd = zip.byteLength - 22
  expect(view.getUint32(eocd, true)).toBe(0x06_05_4b_50)

  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const entries: ZipDirectoryEntry[] = []
  const decoder = new TextDecoder()

  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02_01_4b_50)
    const flags = view.getUint16(at + 8, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    entries.push({
      name: decoder.decode(zip.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true) >>> 0,
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
      utf8: (flags & 0x08_00) !== 0,
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/* ---------------------------------------------------- naming and disambiguation */

describe('entry naming', () => {
  /**
   * The corpus case, in miniature: `tudor#door+narrow.stl` is three distinct
   * md5s across five catalog paths. Naming by filename writes three entries
   * called the same thing and every extractor keeps the last one — a wrong print.
   */
  const colliding = catalogOf([
    { id: 'tiles/cut-stone/separate_wall/door+arched/tudor#door+narrow.stl', blob: md5(1), bytes: 1_000 },
    { id: 'tiles/dungeon_stone/s_system/door+arched/tudor#door+narrow.stl', blob: md5(2), bytes: 2_000 },
    { id: 'tiles/dungeon_stone/wall_on_tile/curved/door+arched/tudor#door+narrow.stl', blob: md5(3), bytes: 3_000 },
  ])

  it('gives three different meshes three different entry names', () => {
    const bill = billOf(colliding, [
      'tiles/cut-stone/separate_wall/door+arched/tudor#door+narrow.stl',
      'tiles/dungeon_stone/s_system/door+arched/tudor#door+narrow.stl',
      'tiles/dungeon_stone/wall_on_tile/curved/door+arched/tudor#door+narrow.stl',
    ])
    expect(bill.lines).toHaveLength(3)
    expect(bill.collisions).toHaveLength(1)

    const names = [...archiveEntryNames(bill.lines).values()]
    expect(new Set(names).size).toBe(3)
    expect(names).toEqual([
      'models/cut-stone/separate_wall/door+arched/tudor#door+narrow.stl',
      'models/dungeon_stone/s_system/door+arched/tudor#door+narrow.stl',
      'models/dungeon_stone/wall_on_tile/curved/door+arched/tudor#door+narrow.stl',
    ])
  })

  it('leaves a lone copy of a corpus-colliding filename on its short name', () => {
    const bill = billOf(colliding, ['tiles/dungeon_stone/s_system/door+arched/tudor#door+narrow.stl'])
    expect([...archiveEntryNames(bill.lines).values()]).toEqual(['models/tudor#door+narrow.stl'])
  })

  it('keeps the characters the corpus actually uses, including the non-ASCII ones', () => {
    expect(sanitizePath('bases/plain/60°/dragonlock,magnetic+flex/plain#base+angled.2x+60°.stl')).toBe(
      'bases/plain/60°/dragonlock,magnetic+flex/plain#base+angled.2x+60°.stl',
    )
  })

  it('refuses traversal, control bytes and Windows-hostile characters', () => {
    expect(sanitizePath('../../etc/passwd')).toBe('etc/passwd')
    expect(sanitizePath('a/./b//c.stl')).toBe('a/b/c.stl')
    expect(sanitizePath('a\\b\\c.stl')).toBe('a/b/c.stl')
    expect(sanitizePath('we\u0000ird/na\u001fme.stl')).toBe('weird/name.stl')
    expect(sanitizePath('what?/is:this*.stl')).toBe('what_/is_this_.stl')
    expect(sanitizePath('trailing. /x.stl')).toBe('trailing/x.stl')
    expect(() => sanitizePath('../..')).toThrow(ArchiveNamingError)
  })

  /**
   * Sanitisation is not injective, so it can in principle collapse two distinct
   * catalog paths onto one name. The `~{md5}` fallback makes the result unique
   * again — and both members take it, so neither keeps the bare name.
   */
  it('falls back to the content address when sanitisation collapses two paths', () => {
    const catalog = catalogOf([
      { id: 'tiles/x/wall?.stl', blob: md5(11), bytes: 10 },
      { id: 'tiles/x/wall*.stl', blob: md5(12), bytes: 20 },
    ])
    const bill = billOf(catalog, ['tiles/x/wall?.stl', 'tiles/x/wall*.stl'])
    const names = [...archiveEntryNames(bill.lines).values()]
    expect(new Set(names).size).toBe(2)
    expect(names).toEqual([`models/wall_~${md5(12)}.stl`, `models/wall_~${md5(11)}.stl`])
  })

  it('puts every model under models/, so the licensing entries cannot be shadowed', () => {
    const catalog = catalogOf([
      { id: 'tiles/x/LICENSE.txt', blob: md5(21), bytes: 10 },
      { id: 'tiles/x/ATTRIBUTION.csv', blob: md5(22), bytes: 10 },
    ])
    const plan = planOf(catalog, ['tiles/x/LICENSE.txt', 'tiles/x/ATTRIBUTION.csv'])
    expect(plan.files.map((file) => file.name)).toEqual(['models/ATTRIBUTION.csv', 'models/LICENSE.txt'])
    expect(plan.entries.map((entry) => entry.name).slice(0, 2)).toEqual(['LICENSE.txt', 'ATTRIBUTION.csv'])
    expect(new Set(plan.entries.map((entry) => entry.name)).size).toBe(4)
  })
})

/* ----------------------------------------------------------------- md5 dedupe */

describe('md5 dedupe', () => {
  /**
   * 171 md5s are shared by 520 catalog rows. An id-keyed archive fetches the
   * same 10 MB file twice; the bill already groups by blob, and the plan consumes
   * that grouping rather than regrouping.
   */
  it('collapses two catalog paths that name one physical file', () => {
    const catalog = catalogOf([
      { id: 'tiles/foundations/wall#base.stl', blob: md5(7), bytes: 5_000 },
      { id: 'tiles/separate_wall/wall#base.stl', blob: md5(7), bytes: 5_000 },
    ])
    const plan = planOf(catalog, ['tiles/foundations/wall#base.stl', 'tiles/separate_wall/wall#base.stl'])

    expect(plan.files).toHaveLength(1)
    const file = plan.files[0]
    expect(file?.bytes).toBe(5_000)
    expect(file?.quantity).toBe(2)
    expect(file?.tileIds).toEqual([
      'tiles/foundations/wall#base.stl',
      'tiles/separate_wall/wall#base.stl',
    ])
    // One file's bytes, not two.
    expect(plan.download.bytes).toBe(5_000)
  })
})

/* ------------------------------------------------------------------ the plan */

describe('archive plan', () => {
  const catalog = catalogOf([
    { id: 'tiles/a/one.stl', blob: md5(31), bytes: 4_096 },
    { id: 'tiles/b/two.stl', blob: md5(32), bytes: 8_192 },
  ])

  it('refuses an empty bill rather than emitting a licence and no models', () => {
    const bill = billOf(catalog, [])
    expect(bill.lines).toHaveLength(0)
    expect(() => buildArchivePlan(bill, { assets: ASSETS })).toThrow(EmptyArchiveError)
  })

  it('always leads with LICENSE.txt and ATTRIBUTION.csv', () => {
    const plan = planOf(catalog, ['tiles/a/one.stl', 'tiles/b/two.stl'])
    expect(plan.entries.map((entry) => entry.name)).toEqual([
      'LICENSE.txt',
      'ATTRIBUTION.csv',
      'models/one.stl',
      'models/two.stl',
    ])
    expect(plan.entries[0]?.kind).toBe('text')
    expect(plan.entries[1]?.kind).toBe('text')
  })

  it('builds model URLs from the content address and nothing else', () => {
    const plan = planOf(catalog, ['tiles/a/one.stl'])
    expect(plan.files[0]?.url).toBe(`${MODELS}/${md5(31).slice(0, 6)}/${md5(31)}.stl`)
  })

  it('names the archive and the URL-list fallback consistently', () => {
    const plan = planOf(catalog, ['tiles/a/one.stl', 'tiles/b/two.stl'])
    expect(plan.filename).toBe('openforge-room-2026-09-01.zip')
    expect(urlListFilename(plan)).toBe('openforge-room-2026-09-01-urls.txt')
    expect(urlListText(plan)).toBe(`${plan.files[0]?.url ?? ''}\n${plan.files[1]?.url ?? ''}\n`)
  })
})

/* ---------------------------------------------------------- licensing entries */

describe('licensing', () => {
  const catalog = catalogOf([
    { id: 'tiles/cut-stone/door+arched/tudor#door+narrow.stl', blob: md5(41), bytes: 100 },
    { id: 'tiles/dungeon_stone/door+arched/tudor#door+narrow.stl', blob: md5(42), bytes: 200 },
    { id: 'tiles/bases/plain#base+angled.2x+60°.dragonlock,magnetic+flex.stl', blob: md5(43), bytes: 300 },
  ])
  const ids = [
    'tiles/cut-stone/door+arched/tudor#door+narrow.stl',
    'tiles/dungeon_stone/door+arched/tudor#door+narrow.stl',
    'tiles/bases/plain#base+angled.2x+60°.dragonlock,magnetic+flex.stl',
  ]

  it('covers every entry in the archive, once each', () => {
    const plan = planOf(catalog, ids)
    const csv = plan.entries[1]
    expect(csv?.kind).toBe('text')
    const text = csv?.kind === 'text' ? csv.text : ''

    const lines = text.trimEnd().split('\r\n')
    expect(lines).toHaveLength(plan.files.length + 1)
    expect(lines[0]).toBe(ATTRIBUTION_COLUMNS.map((column) => `"${column}"`).join(','))

    for (const file of plan.files) {
      const row = lines.find((line) => line.startsWith(`"${file.name}",`))
      expect(row, `no ATTRIBUTION.csv row for ${file.name}`).toBeDefined()
      expect(row).toContain(`"${file.blob}"`)
      expect(row).toContain(`"${file.url}"`)
      expect(row).toContain(`"${file.tileIds.join('; ')}"`)
    }
  })

  /**
   * `plain#base+angled.2x+60°.dragonlock,magnetic+flex.stl` is a real corpus
   * path and it contains a comma. An unquoted writer shifts every column after
   * it, which is how an attribution file quietly stops naming the right file.
   */
  it('quotes every field, because catalog filenames contain commas', () => {
    const csv = attributionCsv([
      {
        entry: 'models/a,b.stl',
        md5: md5(51),
        catalogPaths: ['tiles/x/a,b.stl'],
        sourceUrl: `${MODELS}/000000/${md5(51)}.stl`,
        bytes: 1,
        copies: 1,
      },
    ])
    const row = csv.trimEnd().split('\r\n')[1] ?? ''
    expect(row.startsWith('"models/a,b.stl","')).toBe(true)
    expect(row.split('","')).toHaveLength(ATTRIBUTION_COLUMNS.length)
  })

  it('escapes a double quote by doubling it', () => {
    const csv = attributionCsv([
      {
        entry: 'models/say "hi".stl',
        md5: md5(52),
        catalogPaths: [],
        sourceUrl: 'https://example.test/x.stl',
        bytes: 0,
        copies: 0,
      },
    ])
    expect(csv).toContain('"models/say ""hi"".stl"')
  })

  it('says the licence, the credit, and that the meshes are originals', () => {
    const text = licenceText({ files: 3, bytes: 600, generatedAt: GENERATED_AT })
    expect(text).toContain('CC BY-NC-SA 4.0')
    expect(text).toContain('Devon Jones / Masterwork Tools')
    expect(text).toContain('https://creativecommons.org/licenses/by-nc-sa/4.0/')
    expect(text).toContain('not a decimated preview')
    expect(text).toContain('ATTRIBUTION.csv')
  })
})

/* --------------------------------------------------- length prediction, zip64 */

describe('length prediction', () => {
  it('matches the archive it actually produced, to the byte', async () => {
    const catalog = catalogOf([
      { id: 'tiles/a/one.stl', blob: md5(61), bytes: 4_096 },
      { id: 'tiles/b/two.stl', blob: md5(62), bytes: 65_537 },
      { id: 'tiles/c/three.stl', blob: md5(63), bytes: 1 },
    ])
    const plan = planOf(catalog, ['tiles/a/one.stl', 'tiles/b/two.stl', 'tiles/c/three.stl'])
    const zip = await collect(openArchiveStream(plan, { source: sourceForPlan(plan) }))

    expect(zip.byteLength).toBe(plan.predictedLength)
    expect(plan.zip64).toBe(false)
  })

  it('agrees with an independently written framing formula', () => {
    const entries = [
      { name: 'LICENSE.txt', size: 2_000 },
      { name: 'models/60°/wall.stl', size: 10_360_000 },
      { name: 'models/a.stl', size: 0 },
    ]
    expect(predictZipLength(entries)).toBe(framingLength(entries))
  })

  it('counts a name in UTF-8 bytes, not characters', () => {
    expect(utf8Length('60°')).toBe(4)
    expect(predictZipLength([{ name: '60°', size: 0 }]) - predictZipLength([{ name: '60', size: 0 }])).toBe(4)
  })

  /**
   * ZIP64 is not hypothetical here: 50 placements at the corpus p95 of 32.87 MB
   * is 1.64 GB, and a large room with its auto-inserted bases goes past 4 GB.
   * The sizes are synthesised rather than streamed — moving four real gigabytes
   * through a unit test is not a test, it is a benchmark — and what is asserted
   * is the exact predicted length either side of the boundary, so a writer that
   * stopped emitting the ZIP64 records would fail here.
   */
  describe('zip64', () => {
    it('stays 32-bit for a big-but-not-huge room', () => {
      const room = Array.from({ length: 50 }, (_, i) => ({ name: `models/tile-${String(i)}.stl`, size: 32_870_000 }))
      expect(needsZip64(room)).toBe(false)
      expect(predictZipLength(room)).toBeLessThan(ZIP32_LIMIT)
    })

    it('triggers on a single entry past 4 GB, and adds exactly the ZIP64 framing', () => {
      const huge = [{ name: 'a.stl', size: 5_000_000_000 }]
      expect(needsZip64(huge)).toBe(true)
      // local: 30 + 16 header/descriptor + 8 zip64 descriptor + 5 name + data
      // central: 46 + 5 name + 28 zip64 extra field
      // end: 22 EOCD + 56 zip64 EOCD + 20 zip64 locator
      expect(predictZipLength(huge)).toBe(5_000_000_000 + 30 + 16 + 8 + 5 + (46 + 5 + 28) + 22 + 76)
    })

    it('triggers on the total when no single entry is that big', () => {
      const room = Array.from({ length: 5 }, (_, i) => ({ name: `models/${String(i)}.stl`, size: 1_000_000_000 }))
      expect(needsZip64(room)).toBe(true)
      expect(predictZipLength(room)).toBe(framingLength(room))
      expect(predictZipLength(room)).toBeGreaterThan(ZIP32_LIMIT)
    })

    it('does not trigger just below the boundary', () => {
      // A single entry of `ZIP32_LIMIT - 1` would still trip it, because the
      // *offset* past that entry crosses the limit even though the entry does
      // not. 1 kB of headroom is what puts the whole local section under.
      const just = [{ name: 'a.stl', size: ZIP32_LIMIT - 1_000 }]
      expect(needsZip64(just)).toBe(false)
      expect(predictZipLength(just)).toBe(framingLength(just))
    })

    it('is reported on the plan so the UI can warn about "version 4.5 required"', () => {
      const catalog = catalogOf([{ id: 'tiles/a/huge.stl', blob: md5(71), bytes: 5_000_000_000 }])
      expect(planOf(catalog, ['tiles/a/huge.stl']).zip64).toBe(true)
    })
  })
})

/* ---------------------------------------------------------------- the archive */

describe('the archive itself', () => {
  const catalog = catalogOf([
    { id: 'tiles/cut-stone/door+arched/tudor#door+narrow.stl', blob: md5(81), bytes: 1_000 },
    { id: 'tiles/dungeon_stone/door+arched/tudor#door+narrow.stl', blob: md5(82), bytes: 2_000 },
    { id: 'tiles/bases/60°/plain#base.stl', blob: md5(83), bytes: 3_000 },
  ])
  const ids = [
    'tiles/cut-stone/door+arched/tudor#door+narrow.stl',
    'tiles/dungeon_stone/door+arched/tudor#door+narrow.stl',
    'tiles/bases/60°/plain#base.stl',
  ]

  it('holds the right bytes under the right names, stored and not compressed', async () => {
    const plan = planOf(catalog, ids)
    const zip = await collect(openArchiveStream(plan, { source: sourceForPlan(plan) }))
    const directory = readCentralDirectory(zip)

    expect(directory.map((entry) => entry.name)).toEqual(plan.entries.map((entry) => entry.name))

    for (const entry of directory) {
      // STORE. `client-zip` cannot deflate, and §11 takes that trade knowingly
      // in exchange for an exact predicted length.
      expect(entry.method, `${entry.name} is not stored`).toBe(0)
      expect(entry.compressedSize).toBe(entry.uncompressedSize)
      expect(entry.utf8, `${entry.name} is not flagged UTF-8`).toBe(true)
    }

    const encoder = new TextEncoder()
    for (const planned of plan.entries) {
      const found = directory.find((entry) => entry.name === planned.name)
      const expected =
        planned.kind === 'text' ? encoder.encode(planned.text) : contentFor(planned.blob, planned.bytes)
      expect(found?.uncompressedSize, planned.name).toBe(expected.byteLength)
      expect(found?.crc, `${planned.name} holds the wrong bytes`).toBe(crc32(expected))
    }

    // The three meshes are all present and all different — the collision did
    // not overwrite anything.
    const models = directory.filter((entry) => entry.name.startsWith('models/'))
    expect(models).toHaveLength(3)
    expect(new Set(models.map((entry) => entry.crc)).size).toBe(3)
  })

  it('reports progress and finishes on the predicted byte', async () => {
    const plan = planOf(catalog, ids)
    const seen: number[] = []
    await collect(
      openArchiveStream(plan, {
        source: sourceForPlan(plan),
        onProgress: (progress) => {
          seen.push(progress.bytesWritten)
          expect(progress.predictedLength).toBe(plan.predictedLength)
          expect(progress.entries).toBe(plan.entries.length)
        },
      }),
    )
    expect(seen.at(-1)).toBe(plan.predictedLength)
  })

  it('surfaces a failed fetch instead of finishing a short archive', async () => {
    const plan = planOf(catalog, ids)
    const working = sourceForPlan(plan)
    const failing: BlobSource = {
      urlFor: (blob) => working.urlFor(blob),
      open: (blob) =>
        blob === plan.files[1]?.blob ? Promise.reject(new Error('R2 said 503')) : working.open(blob),
    }

    await expect(collect(openArchiveStream(plan, { source: failing }))).rejects.toThrow('R2 said 503')
  })

  /**
   * The failure mode the length guard exists for: HTTP 200, a body shorter than
   * the index says. A streamed ZIP writes its sizes *after* the data, so the
   * archive that lands opens cleanly and one mesh inside it is truncated.
   */
  it('refuses an archive whose bytes do not match the predicted length', async () => {
    const plan = planOf(catalog, ids)
    const short = new Map(
      plan.files.map((file, index) => [
        file.blob as string,
        contentFor(file.blob, index === 0 ? file.bytes - 1 : file.bytes),
      ]),
    )

    await expect(collect(openArchiveStream(plan, { source: sourceOf(short) }))).rejects.toThrow(
      ArchiveLengthMismatchError,
    )
  })

  it('refuses one that comes out long, too — the URL is content-addressed', async () => {
    const plan = planOf(catalog, ids)
    const long = new Map(
      plan.files.map((file, index) => [
        file.blob as string,
        contentFor(file.blob, index === 0 ? file.bytes + 1_000 : file.bytes),
      ]),
    )

    await expect(collect(openArchiveStream(plan, { source: sourceOf(long) }))).rejects.toThrow(
      ArchiveLengthMismatchError,
    )
  })

  it('stops between entries when the signal aborts', async () => {
    const plan = planOf(catalog, ids)
    const controller = new AbortController()
    controller.abort()
    await expect(
      collect(openArchiveStream(plan, { source: sourceForPlan(plan), signal: controller.signal })),
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------- the never-a-preview guard */

describe('original-mesh guard', () => {
  it('builds the verified R2 model URL', () => {
    expect(originalStlUrl(ASSETS, md5(91) as BlobId)).toBe(`${MODELS}/${md5(91).slice(0, 6)}/${md5(91)}.stl`)
    expect(originalStlUrl({ models: `${MODELS}/` }, md5(91) as BlobId)).toBe(
      `${MODELS}/${md5(91).slice(0, 6)}/${md5(91)}.stl`,
    )
  })

  it('refuses a sprite or thumbnail base outright', () => {
    for (const models of [
      'https://objects.openforge.tools/sprites',
      'https://objects.openforge.tools/thumbs',
      'https://objects.openforge.tools/lod/models',
    ]) {
      expect(() => originalStlUrl({ models }, md5(92) as BlobId)).toThrow(PreviewMeshRefusedError)
    }
  })

  it('refuses plain HTTP and anything that is not the verified shape', () => {
    expect(() => originalStlUrl({ models: 'http://objects.openforge.tools/models' }, md5(93) as BlobId)).toThrow(
      PreviewMeshRefusedError,
    )
    expect(() => originalStlUrl({ models: 'https://objects.openforge.tools' }, md5(94) as BlobId)).toThrow(
      PreviewMeshRefusedError,
    )
  })

  it('refuses a response served as an image, whatever the URL said', async () => {
    const source = r2BlobSource(
      ASSETS,
      () => Promise.resolve(new Response('not a mesh', { headers: { 'content-type': 'image/png' } })),
    )
    await expect(source.open(md5(95) as BlobId)).rejects.toThrow(PreviewMeshRefusedError)
  })

  it('accepts the content types R2 actually serves STLs as', async () => {
    const source = r2BlobSource(
      ASSETS,
      () => Promise.resolve(new Response('solid', { headers: { 'content-type': 'application/octet-stream' } })),
    )
    await expect(source.open(md5(96) as BlobId)).resolves.toBeInstanceOf(ReadableStream)
  })

  it('says which blob and which URL failed', async () => {
    const source = r2BlobSource(ASSETS, () => Promise.resolve(new Response('nope', { status: 404 })))
    await expect(source.open(md5(97) as BlobId)).rejects.toThrow(/404/)
  })
})

/* ---------------------------------------------------------------- saving */

describe('saving', () => {
  const catalog = catalogOf([{ id: 'tiles/a/one.stl', blob: md5(101), bytes: 1_024 }])

  function writableInto(chunks: Uint8Array[]): WritableStream<Uint8Array> {
    return new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
    })
  }

  it('streams straight to disk where showSaveFilePicker exists', async () => {
    const plan = planOf(catalog, ['tiles/a/one.stl'])
    const chunks: Uint8Array[] = []
    const handle: SaveFileHandle = { createWritable: () => Promise.resolve(writableInto(chunks)) }
    const showSaveFilePicker = vi.fn(() => Promise.resolve(handle))

    const result = await saveArchive(plan, openArchiveStream(plan, { source: sourceForPlan(plan) }), {
      showSaveFilePicker,
    })

    expect(result).toEqual({
      outcome: 'saved',
      via: 'file-system-access',
      bytes: plan.predictedLength,
      filename: plan.filename,
    })
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'openforge-room-2026-09-01.zip' }),
    )
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(plan.predictedLength)
  })

  it('treats a dismissed picker as a cancellation, not a failure', async () => {
    const plan = planOf(catalog, ['tiles/a/one.stl'])
    const abort = new Error('the user changed their mind')
    abort.name = 'AbortError'

    const result = await saveArchive(plan, openArchiveStream(plan, { source: sourceForPlan(plan) }), {
      showSaveFilePicker: () => Promise.reject(abort),
    })
    expect(result).toEqual({ outcome: 'cancelled' })
  })

  it('lets a stream error through rather than reporting a save', async () => {
    const plan = planOf(catalog, ['tiles/a/one.stl'])
    const chunks: Uint8Array[] = []
    const failing: BlobSource = {
      urlFor: (blob) => originalStlUrl(ASSETS, blob),
      open: () => Promise.reject(new Error('R2 said 503')),
    }

    await expect(
      saveArchive(plan, openArchiveStream(plan, { source: failing }), {
        showSaveFilePicker: () => Promise.resolve({ createWritable: () => Promise.resolve(writableInto(chunks)) }),
      }),
    ).rejects.toThrow('R2 said 503')
  })

  /** Firefox and every Safari, iOS included: no picker, so buffer and hand over a Blob. */
  it('buffers to a Blob where there is no picker', async () => {
    const plan = planOf(catalog, ['tiles/a/one.stl'])
    const saved: { blob: Blob; filename: string }[] = []

    const result = await saveArchive(plan, openArchiveStream(plan, { source: sourceForPlan(plan) }), {
      saveBlob: (blob, filename) => saved.push({ blob, filename }),
    })

    expect(result).toEqual({
      outcome: 'saved',
      via: 'blob',
      bytes: plan.predictedLength,
      filename: plan.filename,
    })
    expect(saved[0]?.blob.size).toBe(plan.predictedLength)
    expect(saved[0]?.filename).toBe(plan.filename)
  })

  it('refuses to buffer a room too big for a phone, and says by how much', async () => {
    const plan = planOf(catalog, ['tiles/a/one.stl'])
    const environment: SaveEnvironment = { saveBlob: () => undefined, blobLimitBytes: 100 }

    await expect(
      saveArchive(plan, openArchiveStream(plan, { source: sourceForPlan(plan) }), environment),
    ).rejects.toThrow(ArchiveTooLargeToBufferError)
  })

  it('refuses outright where neither path exists', async () => {
    const plan = planOf(catalog, ['tiles/a/one.stl'])
    await expect(saveArchive(plan, openArchiveStream(plan, { source: sourceForPlan(plan) }), {})).rejects.toThrow(
      NoSaveTargetError,
    )
  })
})

/* ------------------------------------------------------------ the real corpus */

const CATALOG_PATH = process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

function loadCatalog(): CatalogFile | undefined {
  if (!existsSync(CATALOG_PATH)) return undefined
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
}

const corpus = loadCatalog()

if (corpus === undefined) {
  process.stderr.write(
    [
      '',
      '  ' + '='.repeat(76),
      '  DOWNLOAD NAMING TESTS SKIPPED — NO CATALOG INDEX',
      '  ' + '='.repeat(76),
      `  Looked for: ${CATALOG_PATH}`,
      '  "Entry names are unique" is a claim about the real corpus — 89 filenames',
      '  carrying two or three meshes, 171 md5s shared by 520 rows — and it was',
      '  not checked. The synthetic tests above passed; they only prove that the',
      '  collisions this file invented are handled.',
      '',
      '  Produce the index with:   npm run import:catalog',
      '  Or point at one with:     OPENFORGE_CATALOG=/path/to/catalog.json',
      '  ' + '='.repeat(76),
      '',
    ].join('\n'),
  )
}

const describeCorpus = corpus === undefined ? describe.skip : describe
const corpusSuite =
  corpus === undefined
    ? `the real corpus — SKIPPED, no catalog index at ${CATALOG_PATH} (run: npm run import:catalog)`
    : 'the real corpus'

describeCorpus(corpusSuite, () => {
  // Safe: the suite is skipped when the index is absent, and `describe.skip`
  // still evaluates the body, so this must not throw.
  const file = corpus ?? ({ records: [], tags: [], assets: { models: MODELS } } as unknown as CatalogFile)
  const index = buildAssemblyIndex(file)
  const context = contextFor(file)
  const records: readonly CatalogRecord[] = file.records

  it('gives every one of the 89 colliding filenames distinct entry names', () => {
    const blobsByFilename = new Map<string, Set<string>>()
    for (const record of records) {
      const blobs = blobsByFilename.get(record.file) ?? new Set<string>()
      blobs.add(record.blob)
      blobsByFilename.set(record.file, blobs)
    }
    const colliding = [...blobsByFilename.entries()].filter(([, blobs]) => blobs.size > 1)
    expect(colliding).toHaveLength(89)

    const collidingFilenames = new Set(colliding.map(([filename]) => filename))
    const placements = records
      .filter((record) => collidingFilenames.has(record.file))
      .map((record, at) => place(record.id, at))

    const bill = buildBillOfTiles(placements, index, context)
    const names = archiveEntryNames(bill.lines)

    expect(names.size).toBe(bill.lines.length)
    expect(new Set(names.values()).size).toBe(bill.lines.length)

    // Every collision the bill found is resolved to distinct names, and none of
    // the colliding entries kept the bare filename.
    expect(bill.collisions.length).toBeGreaterThan(0)
    for (const collision of bill.collisions) {
      const entryNames = collision.blobs.map((blob) => names.get(blob))
      expect(new Set(entryNames).size).toBe(collision.blobs.length)
      for (const entryName of entryNames) {
        expect(entryName).not.toBe(`models/${collision.filename}`)
      }
    }
  })

  it('names every live tile uniquely when the whole corpus is in one bill', () => {
    const bill = buildBillOfTiles(
      records.map((record, at) => place(record.id, at)),
      index,
      context,
    )
    const names = archiveEntryNames(bill.lines)
    expect(names.size).toBe(bill.lines.length)
    expect(new Set(names.values()).size).toBe(bill.lines.length)
  })

  it('builds a valid original-model URL for every distinct blob', () => {
    const assets = file.assets
    const seen = new Set<BlobId>()
    for (const record of records) {
      if (seen.has(record.blob)) continue
      seen.add(record.blob)
      expect(originalStlUrl(assets, record.blob)).toBe(
        `${assets.models}/${record.blob.slice(0, 6)}/${record.blob}.stl`,
      )
    }
    expect(seen.size).toBe(8_353)
  })

  it('predicts a plausible archive for a fifty-tile room and warns where it should', () => {
    const fifty = records.slice(0, 50).map((record, at) => place(record.id, at))
    const bill = buildBillOfTiles(fifty, index, context)
    const plan = buildArchivePlan(bill, { assets: file.assets, generatedAt: GENERATED_AT })

    // Framing is negligible against the meshes — the whole reason the bill's
    // verdict is computed on model bytes rather than on the archive size.
    expect(plan.predictedLength).toBeGreaterThan(plan.download.bytes)
    expect(plan.predictedLength - plan.download.bytes).toBeLessThan(100_000)
    expect(plan.entries).toHaveLength(plan.files.length + 2)
  })
})
