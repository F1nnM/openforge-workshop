/// <reference types="node" />
/**
 * Generated meshes in the download pack.
 *
 * **What these prove.** The archive is actually built here — streamed through
 * the real `openArchiveStream` with a composed `BlobSource` — so the claims
 * about the exact byte count and about a short pack failing are claims about the
 * bytes that came out, not about the plan that went in. The refusals are all
 * exercised from the outside: a clipped mesh, an empty one, a swapped one, an
 * unrendered one, a digest shared with a catalogued file, and a name used twice.
 *
 * **What they cannot prove.** No engine runs, so every mesh here is a fixture
 * from `src/three/stl/fixtures.ts` rather than OpenSCAD output — the tests show
 * that the pack rejects what is not a whole binary STL, not that OpenSCAD
 * produces one. And nothing is saved to a disk: `save.ts`'s own tests cover the
 * picker, and this file stops at the stream.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import type { BillOfTiles } from '@/assembly'
import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import type { CatalogFile } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET, TileId } from '@/catalog'
import { ArchiveNamingError } from '@/download/entries'
import { EmptyArchiveError, GeneratedDigestCollisionError, buildArchivePlan } from '@/download/plan'
import type { BlobSource } from '@/download/source'
import { originalStlUrl } from '@/download/source'
import { ArchiveLengthMismatchError, openArchiveStream } from '@/download/stream'
import { urlListText } from '@/download/urlList'
import { BINARY_FACET_BYTES, BINARY_HEADER_BYTES, binaryStl, box } from '@/three/stl/fixtures'
import type { PlacementId } from '@/store'

import { md5 } from '../engine/md5'
import { canonicalise, recipeKey } from '../panel/recipe'
import { triangleCount } from '../panel/usePreview'

import type { GeneratedBill } from './bill'
import { buildGeneratedBill } from './bill'
import type { GeneratedArchiveSection } from '@/download/plan'

import type { GeneratedMeshHold, GeneratedMeshHoldings } from './pack'
import {
  GENERATED_NOTICE_NAME,
  GeneratedMeshMissingError,
  GeneratedMeshRefusedError,
  buildGeneratedPack,
  generatedBlobSource,
  loadGeneratedNotice,
  urlListShortfall,
  verifyGeneratedMesh,
} from './pack'
import { GeneratedLicenceError, assertGeometryLicencePresent, generatedNotice } from './notice'
import { SCAD_UPSTREAM, SELF_ADDRESSED_PHRASE } from './provenance'
import type { GeneratedBaseId, GeneratedPlacement, GeneratedScene } from './scene'
import { generatedBaseId } from './scene'

/* ------------------------------------------------------------------ fixtures */

const MODELS = 'https://objects.openforge.tools/models'
const ASSETS = { models: MODELS }
const GENERATED_AT = new Date('2026-09-01T12:00:00.000Z')
const SQUARE = 'bases-square.scad' as const

/** A mesh whose facet count is derived from the size, so each fixture differs. */
function meshOf(width: number, depth: number, height: number): GeneratedMeshHold {
  const bytes = binaryStl(box(width, depth, height))
  return { md5: md5(bytes), bytes }
}

function placement(values: Record<string, number | string>, at = { x: 0, z: 0 }): GeneratedPlacement {
  const recipe = { v: 1 as const, entry: SQUARE, parameters: canonicalise(SQUARE, values) }
  return {
    base: generatedBaseId(recipeKey(recipe)),
    recipe,
    x: at.x,
    z: at.z,
    rotation: 0,
  }
}

function sceneOf(...placements: readonly GeneratedPlacement[]): GeneratedScene {
  return Object.fromEntries(placements.map((one, index) => [`p${String(index)}` as PlacementId, one]))
}

function holdingsFor(scene: GeneratedScene, hold: GeneratedMeshHold): GeneratedMeshHoldings {
  const out = new Map<GeneratedBaseId, GeneratedMeshHold>()
  for (const one of Object.values(scene)) out.set(one.base, hold)
  return out
}

/** A one-row catalog, parsed through the real schema so it could exist. */
function catalogOf(rows: readonly { id: string; blob: string; bytes: number }[]): CatalogFile {
  return CatalogFileSchema.parse({
    version: { schema: 1, pipeline: 1, fixtures: 'test-fixture', manifest: 1, built: '2026-09-01T12:00:00.000Z' },
    assets: { models: MODELS, sprites: `${MODELS}/../sprites`, thumbs: `${MODELS}/../thumbs`, lod: `${MODELS}/../lod` },
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
        design: `design-${String(index)}`,
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

const CATALOGUED_BLOB = 'a'.repeat(32)
const CATALOG = catalogOf([{ id: 'tiles/x/wall.stl', blob: CATALOGUED_BLOB, bytes: 4_096 }])

function catalogBill(ids: readonly string[]): BillOfTiles {
  return buildBillOfTiles(
    ids.map((id) => ({ tileId: TileId.parse(id), x: 0, z: 0, rotation: 0 })),
    buildAssemblyIndex(CATALOG),
  )
}

const EMPTY_BILL = catalogBill([])

/** The catalogued file's bytes, at the size the index declares. */
function r2Fixture(): BlobSource {
  const content = new Uint8Array(4_096).fill(0x41)
  return {
    urlFor: (blob) => originalStlUrl(ASSETS, blob),
    open: (blob) =>
      blob === CATALOGUED_BLOB
        ? Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(content)
                controller.close()
              },
            }),
          )
        : Promise.reject(new Error(`no fixture for ${blob}`)),
  }
}

async function lengthOf(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader()
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    total += value?.byteLength ?? 0
  }
  return total
}

function billOf(scene: GeneratedScene, holdings: GeneratedMeshHoldings): GeneratedBill {
  const meshes = new Map(
    [...holdings.entries()].map(([base, hold]) => [base, verifyGeneratedMesh(hold)] as const),
  )
  return buildGeneratedBill(scene, { meshes })
}

/* ------------------------------------------------------------ verification */

describe('what the pack will accept as a mesh', () => {
  it('takes a whole binary STL and reports its facts', () => {
    const hold = meshOf(50.8, 50.8, 6)
    const facts = verifyGeneratedMesh(hold)
    expect(facts.md5).toBe(hold.md5)
    expect(facts.bytes).toBe(hold.bytes.byteLength)
    expect(facts.triangles).toBe(12)
  })

  it('derives the same triangle count S4 reads out of the header', () => {
    // Production derives it from the length identity `detectStlFormat` has just
    // proved — `(byteLength − 84) / 50` — rather than importing `triangleCount`
    // from `usePreview.ts`, which would put React and S3's engine seam in the
    // download graph. The two are equal by construction; this is the guard that
    // they stay equal.
    for (const size of [1, 2, 4, 8]) {
      const hold = meshOf(25.4 * size, 25.4 * size, 6)
      expect(verifyGeneratedMesh(hold).triangles).toBe(triangleCount(hold.bytes))
      expect(BINARY_HEADER_BYTES + triangleCount(hold.bytes) * BINARY_FACET_BYTES).toBe(hold.bytes.byteLength)
    }
  })

  it('refuses a clipped mesh, which is what a short download looks like', () => {
    const hold = meshOf(50.8, 50.8, 6)
    const clipped = { md5: hold.md5, bytes: hold.bytes.subarray(0, hold.bytes.byteLength - 50) }
    expect(() => verifyGeneratedMesh(clipped)).toThrow(GeneratedMeshRefusedError)
    expect(() => verifyGeneratedMesh(clipped)).toThrow(/clipped mesh/)
  })

  it('refuses zero triangles, which OpenSCAD reports as success', () => {
    const empty = binaryStl([], { declaredFacets: 0 })
    expect(() => verifyGeneratedMesh({ md5: md5(empty), bytes: empty })).toThrow(/zero triangles/)
  })

  it('refuses an ASCII mesh rather than admitting it unchecked', () => {
    const ascii = new TextEncoder().encode('solid x\nendsolid x\n')
    expect(() => verifyGeneratedMesh({ md5: md5(ascii), bytes: ascii })).toThrow(/ASCII STL/)
  })

  it('refuses bytes that do not hash to the digest they are named by', () => {
    const hold = meshOf(50.8, 50.8, 6)
    expect(() => verifyGeneratedMesh({ md5: 'f'.repeat(32), bytes: hold.bytes })).toThrow(/hash to/)
  })
})

/* ------------------------------------------------------------------ the pack */

describe('building the generated half of a pack', () => {
  it('refuses when a placed base has not been rendered', async () => {
    const scene = sceneOf(placement({ x: 2, y: 2 }))
    // The bill happily reports it as an unrendered warn row; the pack does not.
    const bill = buildGeneratedBill(scene)
    expect(bill.unrendered).toBe(1)
    expect(bill.lines[0]?.severity).toBe('warn')
    await expect(buildGeneratedPack(bill, new Map())).rejects.toThrow(GeneratedMeshMissingError)
    await expect(buildGeneratedPack(bill, new Map())).rejects.toThrow(/one file short/)
  })

  it('is one entry per digest and one bill row per recipe', async () => {
    // Two different recipes, one set of bytes: two rows, one entry, both handles
    // on it. The bill is about what somebody chose to print; the pack is about
    // the bytes.
    const scene = sceneOf(placement({ x: 2, y: 2 }), placement({ x: 3, y: 3 }, { x: 4, z: 0 }))
    const hold = meshOf(50.8, 50.8, 6)
    const holdings = holdingsFor(scene, hold)
    const bill = billOf(scene, holdings)
    expect(bill.lines).toHaveLength(2)

    const section = await buildGeneratedPack(bill, holdings)
    expect(section.meshes).toHaveLength(1)
    expect(section.meshes[0]?.recipes).toHaveLength(2)
    expect(section.meshes[0]?.quantity).toBe(2)
    expect(section.meshes[0]?.blob).toBe(hold.md5)
  })

  it('counts copies of one recipe without holding the mesh twice', async () => {
    const one = placement({ x: 2, y: 2 })
    const scene = sceneOf(one, { ...one, x: 4 })
    const holdings = holdingsFor(scene, meshOf(50.8, 50.8, 6))
    const bill = billOf(scene, holdings)
    expect(bill.lines).toHaveLength(1)
    expect(bill.lines[0]?.quantity).toBe(2)
    expect((await buildGeneratedPack(bill, holdings)).meshes).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ the notice */

describe('the notice that rides with a generated mesh', () => {
  const scene = sceneOf(placement({ x: 2, y: 2 }))
  const holdings = holdingsFor(scene, meshOf(50.8, 50.8, 6))
  let section: GeneratedArchiveSection
  beforeAll(async () => {
    section = await buildGeneratedPack(billOf(scene, holdings), holdings)
  })

  it('carries the geometry’s licence in full, and its NOTICE', () => {
    expect(section.notice.name).toBe(GENERATED_NOTICE_NAME)
    // Apache-2.0 §4(a) and §4(d): hand the recipient the licence, propagate the
    // notice. Both ride inside the archive, not in a document beside it.
    expect(section.notice.text).toContain('Apache License')
    expect(section.notice.text).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION')
    expect(section.notice.text).toContain(SCAD_UPSTREAM.url)
    expect(section.notice.text).toContain('Copyright 2018-2026 Devon Jones')
  })

  it('names the geometry and the commit these bytes came from', () => {
    expect(section.notice.text).toContain(SCAD_UPSTREAM.commit)
    expect(section.notice.text).toContain(SQUARE)
  })

  it('states that these are not the archive’s published files', () => {
    expect(section.notice.text).toContain('not the base files the OpenForge archive publishes')
    // The measurement, so the sentence cannot be softened into a hedge.
    expect(section.notice.text).toContain('760')
    expect(section.notice.text).toContain('1,428')
  })

  it('says the digest is self-addressed, in S3’s own words', () => {
    expect(section.notice.text).toContain(SELF_ADDRESSED_PHRASE)
  })

  it('says ATTRIBUTION.csv does not cover them, and why', () => {
    expect(section.notice.text).toContain('ATTRIBUTION.csv does not list the files under generated/')
    expect(section.notice.text).toContain('CC BY-NC-SA 4.0')
  })

  it('discloses every -D rather than summarising it', () => {
    for (const parameter of ['x', 'y', 'HEIGHT', 'LOCK', 'SQUARE_BASIS']) {
      expect(section.notice.text).toContain(`-D ${parameter}=`)
    }
  })

  it('refuses to build if the licence did not ship', () => {
    expect(() => assertGeometryLicencePresent('', 'x')).toThrow(GeneratedLicenceError)
    expect(() => assertGeometryLicencePresent(undefined, 'no url here')).toThrow(GeneratedLicenceError)
    // And the real ones do ship.
    expect(() => assertGeometryLicencePresent()).not.toThrow()
    expect(generatedNotice([]).length).toBeGreaterThan(11_000)
  })

  it('is reachable without packing anything, through the async seam', async () => {
    // `loadGeneratedNotice()` is S3's `loadEngineLicence()` shape: the licence
    // text lives behind a dynamic import so it is not in the entry bundle, and a
    // caller that only wants to *show* it does not have to build a pack.
    const module = await loadGeneratedNotice()
    expect(module.generatedNotice([])).toContain('Apache License')
  })
})

/* ------------------------------------------------------------------- the plan */

describe('the plan, with generated meshes in it', () => {
  const scene = sceneOf(placement({ x: 2, y: 2 }))
  const hold = meshOf(50.8, 50.8, 6)
  const holdings = holdingsFor(scene, hold)
  let section: GeneratedArchiveSection
  beforeAll(async () => {
    section = await buildGeneratedPack(billOf(scene, holdings), holdings)
  })

  it('puts the notice before the models and the meshes after them', () => {
    const plan = buildArchivePlan(catalogBill(['tiles/x/wall.stl']), {
      assets: ASSETS,
      generatedAt: GENERATED_AT,
      generated: section,
    })
    expect(plan.entries.map((entry) => entry.name)).toEqual([
      'LICENSE.txt',
      'ATTRIBUTION.csv',
      GENERATED_NOTICE_NAME,
      'models/wall.stl',
      'generated/square-base-2x2.c64c3670.stl',
    ])
    expect(plan.generated).toHaveLength(1)
    // Not in `files`, so `urlListText` cannot hand out a URL that 404s.
    expect(plan.files.map((file) => file.name)).toEqual(['models/wall.stl'])
    expect(urlListText(plan)).toBe(`${originalStlUrl(ASSETS, plan.files[0]!.blob)}\n`)
    expect(urlListShortfall(plan)).toContain('1 generated mesh is not in it')
  })

  it('predicts the archive’s exact length, meshes included', async () => {
    const plan = buildArchivePlan(catalogBill(['tiles/x/wall.stl']), {
      assets: ASSETS,
      generatedAt: GENERATED_AT,
      generated: section,
    })
    const written = await lengthOf(
      openArchiveStream(plan, { source: generatedBlobSource(holdings, r2Fixture()) }),
    )
    expect(written).toBe(plan.predictedLength)
    // The mesh's bytes are in there and are counted, not estimated.
    expect(plan.generated[0]?.bytes).toBe(hold.bytes.byteLength)
  })

  it('packs a room made only of generated bases', async () => {
    const plan = buildArchivePlan(EMPTY_BILL, { assets: ASSETS, generatedAt: GENERATED_AT, generated: section })
    expect(plan.files).toHaveLength(0)
    expect(plan.generated).toHaveLength(1)
    const written = await lengthOf(
      openArchiveStream(plan, { source: generatedBlobSource(holdings, r2Fixture()) }),
    )
    expect(written).toBe(plan.predictedLength)
  })

  it('still refuses an archive with nothing in it at all', () => {
    expect(() => buildArchivePlan(EMPTY_BILL, { assets: ASSETS })).toThrow(EmptyArchiveError)
    expect(() => buildArchivePlan(EMPTY_BILL, { assets: ASSETS, generated: { meshes: [], notice: section.notice } })).toThrow(
      EmptyArchiveError,
    )
  })

  it('fails loudly rather than short when the held bytes are clipped', async () => {
    const plan = buildArchivePlan(EMPTY_BILL, { assets: ASSETS, generatedAt: GENERATED_AT, generated: section })
    // The plan promised the full length; the source now holds one facet less.
    const clipped = new Map(holdings)
    for (const [base, one] of clipped) {
      clipped.set(base, { md5: one.md5, bytes: one.bytes.subarray(0, one.bytes.byteLength - 50) })
    }
    await expect(
      lengthOf(openArchiveStream(plan, { source: generatedBlobSource(clipped, r2Fixture()) })),
    ).rejects.toThrow(GeneratedMeshRefusedError)
  })

  it('fails loudly when a source hands over bytes the plan did not promise', async () => {
    const plan = buildArchivePlan(EMPTY_BILL, { assets: ASSETS, generatedAt: GENERATED_AT, generated: section })
    // A source that is not ours at all, answering with a valid but different
    // mesh. `generatedBlobSource`'s digest check never runs, so the only thing
    // standing between this and a plausible-looking archive holding the wrong
    // mesh is the exact byte count — which is precisely why `stream.ts` has one,
    // and why a generated entry is accounted for in it like every other.
    const other = { md5: '', bytes: binaryStl([...box(50.8, 50.8, 6), ...box(25.4, 25.4, 6)]) }
    const swapped: BlobSource = {
      urlFor: (blob) => originalStlUrl(ASSETS, blob),
      open: () =>
        Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(other.bytes)
              controller.close()
            },
          }),
        ),
    }
    await expect(lengthOf(openArchiveStream(plan, { source: swapped }))).rejects.toThrow(ArchiveLengthMismatchError)
  })

  it('refuses a generated digest that a catalogued file already claims', () => {
    const collided = { ...section, meshes: section.meshes.map((mesh) => ({ ...mesh, blob: CATALOG.records[0]!.blob })) }
    expect(() =>
      buildArchivePlan(catalogBill(['tiles/x/wall.stl']), { assets: ASSETS, generated: collided }),
    ).toThrow(GeneratedDigestCollisionError)
  })

  it('refuses a mesh with no notice, because the licence has to ride with it', () => {
    expect(() =>
      buildArchivePlan(EMPTY_BILL, { assets: ASSETS, generated: { meshes: section.meshes, notice: { name: 'x', text: '  ' } } }),
    ).toThrow(ArchiveNamingError)
  })

  it('disambiguates two meshes whose readable names collide', () => {
    const twin = { ...section.meshes[0]!, blob: 'b'.repeat(32) as (typeof section.meshes)[number]['blob'], bytes: 500 }
    const plan = buildArchivePlan(EMPTY_BILL, {
      assets: ASSETS,
      generatedAt: GENERATED_AT,
      generated: { ...section, meshes: [section.meshes[0]!, twin] },
    })
    const names = plan.generated.map((entry) => entry.name)
    expect(new Set(names).size).toBe(2)
    for (const name of names) expect(name).toMatch(/~[0-9a-f]{32}\.stl$/)
  })

  it('refuses a notice name that a catalogued entry already uses', () => {
    expect(() =>
      buildArchivePlan(catalogBill(['tiles/x/wall.stl']), {
        assets: ASSETS,
        generated: { ...section, notice: { name: 'models/wall.stl', text: section.notice.text } },
      }),
    ).toThrow(ArchiveNamingError)
  })
})

/* ------------------------------------------------------------------ the source */

describe('the composed blob source', () => {
  const scene = sceneOf(placement({ x: 2, y: 2 }))
  const hold = meshOf(50.8, 50.8, 6)
  const holdings = holdingsFor(scene, hold)
  const source = generatedBlobSource(holdings, r2Fixture())

  it('serves a generated digest from memory and everything else from the fallback', async () => {
    expect(await lengthOf(await source.open(hold.md5 as never))).toBe(hold.bytes.byteLength)
    expect(await lengthOf(await source.open(CATALOGUED_BLOB as never))).toBe(4_096)
  })

  it('throws rather than inventing a URL for a mesh that was never published', () => {
    expect(() => source.urlFor(hold.md5 as never)).toThrow(GeneratedMeshRefusedError)
    expect(() => source.urlFor(hold.md5 as never)).toThrow(/no URL/)
    // The fallback still answers for a catalogued blob.
    expect(source.urlFor(CATALOGUED_BLOB as never)).toBe(originalStlUrl(ASSETS, CATALOGUED_BLOB as never))
  })

  it('has nothing to disclose when no mesh was generated', () => {
    expect(urlListShortfall({ generated: [] })).toBeNull()
  })
})
