/// <reference types="node" />
/**
 * The base under each topper: that it is the bill's base, that it sits where the
 * bill's base will be printed, and that it lifts the thing standing on it.
 *
 * ## The load-bearing assertion
 *
 * `the base the bill lists` is the one that matters, and it is written as an
 * equality between two independent derivations rather than as a check of one:
 * `sceneBases` on one side and `buildBillOfTiles` on the other, over the same
 * placements and the same preference, compared on the **blob**. It can only pass
 * if the room's base and the download's base are the same file, which is the
 * claim the whole row rests on. Row **D1** is why: a ranking that fell through to
 * file size handed out a *topless* base — a base with no top surface, a different
 * product — for **79.1%** of openlock toppers, and a room drawing one of those
 * under a tile would be a picture of something unbuildable.
 *
 * ## What these tests cannot prove
 *
 * **Nothing here draws.** jsdom has no WebGL context and reports every element
 * as 0 × 0, so *"the user sees the base"* is not a claim any test in this file
 * makes — it is a matrix, a count and a millimetre. The pixels were checked in
 * Chromium against `vite preview` of the real build, and that check is in the
 * PR body, not here.
 *
 * The elevation is asserted against a **fixture** mesh's own upright height,
 * because the `/lod/` store is empty (blocker **B2**) and the real base meshes
 * are 0.9–49.7 MB apiece. The corpus figures that decide the *design* — a median
 * base 6.002 mm tall against a median floor tile 4.5 mm — were measured by
 * fetching 193 real bases from `/models/` and are recorded in `bases.ts`; they
 * are not re-derived here, because a unit suite must not download 118 MB.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AssemblyIndex } from '@/assembly'
import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import type { PlanCatalog, PlanScene } from '@/builder/canvas'
import { buildPlanScene, createStyleResolver, planCatalogFromFile } from '@/builder/canvas'
import type { BlobId, CatalogFile as CatalogFileType, DesignId } from '@/catalog'
import { CatalogFile } from '@/catalog'
import { resolveMaterial } from '@/materials'
import type { LockSystem, Placement, PlacementId, WorkshopState } from '@/store'
import { VIEW_RADIUS } from '@/three/geometry'

import { ABSENT_BASE_ELEVATION_MM, baseElevationMm, designBase, sceneBases } from './bases'
import { buildRoom3D } from './instances'
import type { LodGeometry } from './loadLod'
import { parseLodGlb } from './loadLod'
import { PLATE_HEIGHT_MM } from './markers'
import { meshHeightMm } from './surface'

/* -------------------------------------------------------------- the fixture */

/**
 * Two records that make rule 1 fire, and one that makes it not.
 *
 * A hand-built catalog rather than the eleven-record canvas fixture, which holds
 * **no** `connection|openforge` topper and **no** base at all — so rule 1 finds
 * nothing in it and every test here would pass vacuously. The three records are
 * the smallest set that separates the three outcomes: a topper with a congruent
 * base, a topper with none, and a base a user can place by hand.
 */
const FIXTURE: unknown = {
  version: { schema: 1, pipeline: 1, fixtures: 'r3-bases', manifest: 1, built: '2026-01-01T00:00:00Z' },
  assets: {
    models: 'https://objects.openforge.tools/models/',
    sprites: 'https://objects.openforge.tools/sprites/',
    thumbs: 'https://objects.openforge.tools/thumbs/',
    lod: 'https://objects.openforge.tools/lod/',
  },
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: ['shape|floor', 'shape|base', 'texture|cut_stone', 'texture|plain', 'connection|openforge'],
  records: [
    {
      id: 'tiles/cut_stone/floor/1x1.openforge.stl',
      ord: 0,
      blob: 'a'.repeat(32),
      file: '1x1.openforge.stl',
      bytes: 4_000_000,
      sprite: true,
      thumb: false,
      family: 'tiles/cut_stone/floor',
      design: 'd-topper',
      name: 'Cut stone floor 1×1',
      kinds: ['floor'],
      conn: ['openforge'],
      layer: 'topper',
      texture: 'cut_stone',
      tags: [0, 2, 4],
      foot: { shape: 'rect', w: 1, d: 1 },
    },
    {
      id: 'tiles/plain/base/1x1.openlock.stl',
      ord: 1,
      blob: 'b'.repeat(32),
      file: 'base+square.1x1.openlock.stl',
      bytes: 900_000,
      sprite: true,
      thumb: false,
      family: 'tiles/plain/base',
      design: 'd-base',
      name: 'Plain square base 1×1',
      kinds: ['base'],
      conn: ['openlock'],
      layer: 'base',
      texture: 'plain',
      tags: [1, 3],
      foot: { shape: 'rect', w: 1, d: 1 },
    },
    {
      id: 'tiles/cut_stone/floor/2x2.openlock.stl',
      ord: 2,
      blob: 'c'.repeat(32),
      file: '2x2.openlock.stl',
      bytes: 6_000_000,
      sprite: true,
      thumb: false,
      family: 'tiles/cut_stone/floor',
      design: 'd-integral',
      name: 'Cut stone floor 2×2',
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'cut_stone',
      tags: [0, 2],
      foot: { shape: 'rect', w: 2, d: 2 },
    },
  ],
}

const TOPPER = 'd-topper' as DesignId
const BASE = 'd-base' as DesignId
const INTEGRAL = 'd-integral' as DesignId
const BASE_BLOB = 'b'.repeat(32) as BlobId

let fixtureFile: CatalogFileType | undefined
function file(): CatalogFileType {
  fixtureFile ??= CatalogFile.parse(FIXTURE)
  return fixtureFile
}

function place(design: DesignId, x = 0, z = 0): Placement {
  return { design, x, z, rotation: 0 }
}

function placements(entries: readonly (readonly [string, Placement])[]): WorkshopState['placements'] {
  return Object.fromEntries(entries)
}

function sceneOf(
  entries: readonly (readonly [string, Placement])[],
  lock?: LockSystem,
): { scene: PlanScene; catalog: PlanCatalog; assembly: AssemblyIndex } {
  const catalog = planCatalogFromFile(file(), lock)
  const scene = buildPlanScene(placements(entries), catalog, createStyleResolver(catalog))
  return { scene, catalog, assembly: buildAssemblyIndex(file()) }
}

/* ------------------------------------------------------------- the geometry */

const FIXTURE_GLB = join(process.cwd(), 'src', 'builder', 'three', 'fixtures', 'wall-8180da93.glb')

let template: LodGeometry | undefined
async function geometryFor(blobs: readonly string[]): Promise<Map<string, LodGeometry>> {
  if (template === undefined) {
    const bytes = readFileSync(FIXTURE_GLB)
    template = await parseLodGlb(
      '8180da93549154744c37f8370a82738f' as BlobId,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    )
  }
  const held = template
  return new Map(blobs.map((blob) => [blob, { ...held, blob: blob as BlobId }]))
}

/* -------------------------------------------------------------------- which */

describe('sceneBases', () => {
  it('gives an openforge topper the congruent base and gives an integral tile none', () => {
    const { scene, assembly } = sceneOf([
      ['p0', place(TOPPER)],
      ['p1', place(INTEGRAL, 4, 4)],
    ])

    const bases = sceneBases(scene, assembly, 'openlock')

    expect(bases.get('p0' as PlacementId)?.record.blob).toBe(BASE_BLOB)
    expect(bases.has('p1' as PlacementId)).toBe(false)
  })

  it('gives every placement of one item the same base, and asks rule 1 once for it', () => {
    const { scene, assembly } = sceneOf([
      ['p0', place(TOPPER, 0, 0)],
      ['p1', place(TOPPER, 2, 0)],
      ['p2', place(TOPPER, 4, 0)],
    ])

    const bases = sceneBases(scene, assembly, 'openlock')

    expect([...bases.values()].map((base) => base.record.blob)).toEqual([BASE_BLOB, BASE_BLOB, BASE_BLOB])
  })

  it('keys on the topper, because a base has no placement of its own', () => {
    const { scene, assembly } = sceneOf([['p0', place(TOPPER)]])
    const bases = sceneBases(scene, assembly, 'openlock')
    expect(bases.get('p0' as PlacementId)?.id).toBe('p0')
  })

  it('flags a topper standing on a base the user placed by hand — X10’s note, drawn', () => {
    // The two bases occupy one cell, and the bill lists both. What this flag
    // exists for is that two solids there would read as one object.
    const { scene, assembly } = sceneOf([
      ['p0', place(TOPPER, 0, 0)],
      ['p1', place(BASE, 0, 0)],
    ])

    const bases = sceneBases(scene, assembly, 'openlock')

    expect(bases.get('p0' as PlacementId)?.duplicate).toBe(true)
  })

  it('does not flag a hand-placed base that is somewhere else', () => {
    const { scene, assembly } = sceneOf([
      ['p0', place(TOPPER, 0, 0)],
      ['p1', place(BASE, 8, 8)],
    ])

    expect(sceneBases(scene, assembly, 'openlock').get('p0' as PlacementId)?.duplicate).toBe(false)
  })

  it('does not flag a topper standing on an ordinary floor tile', () => {
    // `duplicate` is about a *base*, not about anything underneath. A floor
    // under a wall is the commonest arrangement in the archive and must not
    // suppress the wall's base.
    const { scene, assembly } = sceneOf([
      ['p0', place(TOPPER, 0, 0)],
      ['p1', place(INTEGRAL, 0, 0)],
    ])

    expect(sceneBases(scene, assembly, 'openlock').get('p0' as PlacementId)?.duplicate).toBe(false)
  })
})

describe('designBase', () => {
  it('answers for the armed item, which has no placement to look one up by', () => {
    const { assembly } = sceneOf([])
    expect(designBase(TOPPER, assembly, 'openlock')?.record.blob).toBe(BASE_BLOB)
    expect(designBase(INTEGRAL, assembly, 'openlock')).toBeUndefined()
  })
})

/* ---------------------------------------------------------------- how high */

describe('baseElevationMm', () => {
  it('is the base mesh’s own upright height once the mesh is there', async () => {
    const { scene, assembly } = sceneOf([['p0', place(TOPPER)]])
    const bases = sceneBases(scene, assembly, 'openlock')
    const geometries = await geometryFor([BASE_BLOB])
    const lod = geometries.get(BASE_BLOB)!

    const elevation = baseElevationMm(bases.get('p0' as PlacementId), geometries)

    // The *upright* height — the store's `z` extent, not its `y`. Taking the raw
    // `y` would report this 4 × 1 wall strip as 101.6 mm tall.
    expect(elevation).toBeCloseTo(meshHeightMm(lod.bounds), 10)
    expect(elevation).toBeGreaterThan(0)
  })

  it('falls back to two plate thicknesses when the base has no mesh', async () => {
    const { scene, assembly } = sceneOf([['p0', place(TOPPER)]])
    const bases = sceneBases(scene, assembly, 'openlock')

    const elevation = baseElevationMm(bases.get('p0' as PlacementId), await geometryFor([]))

    // Two, not one: one plate thickness would make the topper's underside
    // coplanar with the plate standing in for the base, and two coplanar faces
    // at one depth flicker per fragment.
    expect(elevation).toBe(ABSENT_BASE_ELEVATION_MM)
    expect(ABSENT_BASE_ELEVATION_MM).toBe(PLATE_HEIGHT_MM * 2)
  })

  it('is zero for a piece with no base, so nothing the plan view ever drew moves', async () => {
    expect(baseElevationMm(undefined, await geometryFor([]))).toBe(0)
  })
})

/* -------------------------------------------------------- the room it builds */

describe('buildRoom3D with bases', () => {
  const TOPPER_BLOB = 'a'.repeat(32)

  async function roomOf(
    entries: readonly (readonly [string, Placement])[],
    loaded: readonly string[],
    withBases = true,
  ) {
    const catalog = planCatalogFromFile(file(), 'openlock')
    const scene = buildPlanScene(placements(entries), catalog, createStyleResolver(catalog))
    const assembly = buildAssemblyIndex(file())
    const bases = sceneBases(scene, assembly, 'openlock')
    const geometries = await geometryFor(loaded)
    return {
      geometries,
      bases,
      room: buildRoom3D(scene, {
        geometries,
        resolve: (record) => resolveMaterial(catalog.tags(record), record.file),
        viewRadius: VIEW_RADIUS,
        ...(withBases ? { bases } : {}),
      }),
    }
  }

  /**
   * A matrix's own `y` translation. `Matrix4.elements` is column-major.
   *
   * Compared as a **difference against the ungrounded matrix** rather than
   * against zero, because the fixture is a real meshopt-compressed GLB and
   * quantisation leaves its upright `min.y` **9.18e-5 mm** off the origin. That
   * residue is three orders of magnitude below anything visible and it is not
   * this row's to fix; asserting a delta measures the lift and nothing else.
   */
  const liftOf = (matrix: { elements: readonly number[] } | undefined): number => matrix?.elements[13] ?? NaN

  it('draws the base as its own group and the topper standing on it', async () => {
    const { room, geometries } = await roomOf([['p0', place(TOPPER)]], [TOPPER_BLOB, BASE_BLOB])
    const grounded = await roomOf([['p0', place(TOPPER)]], [TOPPER_BLOB, BASE_BLOB], false)
    const height = meshHeightMm(geometries.get(BASE_BLOB)!.bounds)
    const floor = liftOf(grounded.room.groups[0]?.matrices[0])

    expect(room.baseGroups.map((group) => group.blob)).toEqual([BASE_BLOB])
    expect(room.baseGroups[0]?.count).toBe(1)
    expect(room.baseGroups[0]?.placements).toEqual(['p0'])
    // The base rests on the plan, exactly where the topper used to.
    expect(liftOf(room.baseGroups[0]?.matrices[0])).toBeCloseTo(floor, 9)
    // And the topper is lifted off it by exactly the base's measured height.
    expect(liftOf(room.groups[0]?.matrices[0]) - floor).toBeCloseTo(height, 9)
    expect(height).toBeGreaterThan(0)
  })

  it('collapses one base under many toppers into one draw', async () => {
    // Instancing's whole argument, applied to the half of the room this row
    // added: 84 distinct base blobs serve the corpus under openlock.
    const { room } = await roomOf(
      [
        ['p0', place(TOPPER, 0, 0)],
        ['p1', place(TOPPER, 2, 0)],
        ['p2', place(TOPPER, 4, 0)],
      ],
      [TOPPER_BLOB, BASE_BLOB],
    )

    expect(room.baseGroups).toHaveLength(1)
    expect(room.baseGroups[0]?.count).toBe(3)
    expect(room.instances).toBe(3)
    expect(room.baseInstances).toBe(3)
  })

  it('counts the base against the object budget, once', async () => {
    const { room } = await roomOf(
      [
        ['p0', place(TOPPER, 0, 0)],
        ['p1', place(TOPPER, 2, 0)],
      ],
      [TOPPER_BLOB, BASE_BLOB],
    )
    expect(room.objects).toBe(2)
  })

  it('reports a base with no mesh as a gap and stands the topper on the plate’s height', async () => {
    const { room } = await roomOf([['p0', place(TOPPER)]], [TOPPER_BLOB])
    const grounded = await roomOf([['p0', place(TOPPER)]], [TOPPER_BLOB], false)

    expect(room.baseGroups).toEqual([])
    expect(room.absentBases.map((gap) => gap.blob)).toEqual([BASE_BLOB])
    expect(room.absentBases[0]?.placements).toEqual(['p0'])
    expect(liftOf(room.groups[0]?.matrices[0]) - liftOf(grounded.room.groups[0]?.matrices[0])).toBeCloseTo(
      ABSENT_BASE_ELEVATION_MM,
      9,
    )
  })

  it('rings rather than draws a base already on the plan', async () => {
    const { room } = await roomOf(
      [
        ['p0', place(TOPPER, 0, 0)],
        ['p1', place(BASE, 0, 0)],
      ],
      [TOPPER_BLOB, BASE_BLOB],
    )

    // The hand-placed base is a placement and is drawn as a tile; the
    // auto-inserted one is suppressed and named instead.
    expect(room.duplicateBases).toEqual(['p0'])
    expect(room.baseGroups).toEqual([])
    expect(room.groups.map((group) => group.blob).sort()).toEqual([TOPPER_BLOB, BASE_BLOB].sort())
  })

  it('is exactly the pre-R3 room when no bases are passed', async () => {
    // The default's regression guard: every caller that has no assembly index —
    // the fixtures, the older suites — gets the room it got before, with every
    // topper resting on `y = 0`.
    const { room, geometries } = await roomOf([['p0', place(TOPPER)]], [TOPPER_BLOB, BASE_BLOB], false)

    expect(room.baseGroups).toEqual([])
    expect(room.absentBases).toEqual([])
    expect(room.duplicateBases).toEqual([])
    expect(room.objects).toBe(1)
    // Resting on the plan to the mesh's own precision: `tileMatrix` puts the
    // upright box's `min.y` at the origin, and what is left is the GLB's
    // quantisation residue rather than an elevation.
    const upright = geometries.get(TOPPER_BLOB)!.bounds
    expect(Math.abs(liftOf(room.groups[0]?.matrices[0]))).toBeLessThan(1e-3)
    expect(upright.isEmpty()).toBe(false)
  })
})

/* --------------------------------------------- the base is the bill's base */

describe('the base the bill lists', () => {
  it('is the base the room resolves, on the fixture', () => {
    const entries = [
      ['p0', place(TOPPER, 0, 0)],
      ['p1', place(TOPPER, 2, 0)],
    ] as const
    const { scene, assembly } = sceneOf(entries)

    const drawn = new Set([...sceneBases(scene, assembly, 'openlock').values()].map((base) => base.record.blob))
    const bill = buildBillOfTiles(
      entries.map(([, placement]) => placement),
      assembly,
      { lock: 'openlock' },
    )
    const billed = new Set(bill.lines.filter((line) => line.baseQuantity > 0).map((line) => line.blob))

    expect([...drawn].sort()).toEqual([...billed].sort())
    expect(drawn.size).toBe(1)
  })
})

/* ------------------------------------------------------------- the corpus */

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)
const describeCorpus = present ? describe : describe.skip
const title = present
  ? 'the base rule against the real corpus'
  : `the base rule — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

let corpus: { file: CatalogFileType; assembly: AssemblyIndex } | undefined
function real(): { file: CatalogFileType; assembly: AssemblyIndex } {
  if (corpus === undefined) {
    const parsed = CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
    corpus = { file: parsed, assembly: buildAssemblyIndex(parsed) }
  }
  return corpus
}

describeCorpus(title, () => {
  const LOCKS: readonly (LockSystem | undefined)[] = ['openlock', 'dragonlock', 'magnetic', undefined]

  /** Every design in the corpus, and the base rule 1 gives it under one lock. */
  function basesUnder(lock: LockSystem | undefined): { designs: number; blobs: Set<string> } {
    const { file: parsed, assembly } = real()
    const catalog = planCatalogFromFile(parsed, lock)
    const designs = new Set<string>()
    const blobs = new Set<string>()
    for (const record of parsed.records) {
      const design = record.design
      if (designs.has(design)) continue
      designs.add(design)
      const scene = buildPlanScene(
        placements([['p0', place(design)]]),
        catalog,
        createStyleResolver(catalog),
      )
      const base = sceneBases(scene, assembly, lock).get('p0' as PlacementId)
      if (base !== undefined) blobs.add(base.record.blob)
    }
    return { designs: designs.size, blobs }
  }

  it('reproduces the v3 plan’s with-base count under openlock, from the drawing side', () => {
    // 1,878 is the plan's `with-base` figure for openlock, derived there through
    // `resolveVariant`. Reached here through `sceneBases` — a different entry
    // point over the same rule — so the room and the plan cannot disagree about
    // how much of the corpus needs a base drawn.
    const { file: parsed, assembly } = real()
    const catalog = planCatalogFromFile(parsed, 'openlock')
    let based = 0
    const seen = new Set<string>()
    for (const record of parsed.records) {
      if (seen.has(record.design)) continue
      seen.add(record.design)
      const scene = buildPlanScene(
        placements([['p0', place(record.design)]]),
        catalog,
        createStyleResolver(catalog),
      )
      if (sceneBases(scene, assembly, 'openlock').size > 0) based += 1
    }

    expect(seen.size).toBe(3822)
    expect(based).toBe(1878)
  })

  it('needs only a handful of distinct base meshes for the whole archive', () => {
    // The number that makes drawing them affordable at all: instancing collapses
    // a room's bases into two or three draws, and a library's bases into two or
    // three downloads.
    const counts = LOCKS.map((lock) => basesUnder(lock).blobs.size)
    expect(counts).toEqual([84, 111, 112, 84])
  })

  it('draws exactly the base the bill lists, for every item in the archive', () => {
    // The load-bearing assertion, at corpus scale rather than on a fixture.
    // Both sides resolve independently from the same index and the same
    // preference; the equality is what says a topper is never drawn standing on
    // a file the download does not contain.
    const { file: parsed, assembly } = real()
    const catalog = planCatalogFromFile(parsed, 'openlock')
    const seen = new Set<string>()
    let compared = 0
    for (const record of parsed.records) {
      if (seen.has(record.design)) continue
      seen.add(record.design)
      const placement = place(record.design)
      const scene = buildPlanScene(placements([['p0', placement]]), catalog, createStyleResolver(catalog))
      const drawn = sceneBases(scene, assembly, 'openlock').get('p0' as PlacementId)?.record.blob
      const bill = buildBillOfTiles([placement], assembly, { lock: 'openlock' })
      const billed = bill.lines.find((line) => line.baseQuantity > 0)?.blob
      expect(drawn).toBe(billed)
      if (drawn !== undefined) compared += 1
    }
    // The guard against a vacuous pass, and it is exact rather than a floor:
    // 1,878 of the 3,822 items really are compared against a base line, so the
    // equality above ran on every one of them and matched.
    expect(seen.size).toBe(3822)
    expect(compared).toBe(1878)
  })

  it('hands out the plain print, never a topless one, under openlock', () => {
    // Row D1's whole point. A topless base has no top surface, so a topper drawn
    // standing on one would be a picture of something unbuildable — and before
    // D1 the ranking chose one for 79.1% of openlock toppers, because the
    // topless print of a base is its smallest file.
    const { file: parsed, assembly } = real()
    const seen = new Set<string>()
    const options = new Map<string, number>()
    for (const record of parsed.records) {
      if (seen.has(record.design)) continue
      seen.add(record.design)
      const part = designBase(record.design, assembly, 'openlock')
      if (part?.match === undefined) continue
      options.set(part.match.option, (options.get(part.match.option) ?? 0) + 1)
    }
    expect([...options]).toEqual([['plain', 1878]])
  })
})
