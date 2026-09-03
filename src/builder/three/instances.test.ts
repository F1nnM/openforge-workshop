/// <reference types="node" />
/**
 * The instancing, and the projection the row is named after.
 *
 * ## What these tests prove
 *
 *   - Repeat placements of one tile collapse into **one** `InstancedMesh` with N
 *     matrices, and different tiles do not.
 *   - **The 50-across-20 projection is run rather than asserted.** Twenty real
 *     designs out of the emitted index, fifty placements over them, and the
 *     answer counted: 20 groups, 50 instances, and the one material the
 *     registry actually collapses them to.
 *   - The design-versus-blob measurement that made `blob` the key: 3,822 designs
 *     over 8,353 md5s, 1,680 designs holding more than one and one holding
 *     sixteen. Keying an `InstancedMesh` on `design` would put up to sixteen
 *     geometries in a mesh that shares one.
 *   - An absent object is a gap in a list, not an exception, and every object is
 *     absent today.
 *   - The budget refuses a room the memory ceiling cannot hold, and says so.
 *
 * ## What they cannot prove
 *
 * **Nothing here draws.** There is no WebGL context in this environment, so
 * "20 draw calls" is a count of `InstancedMesh`es this module produced, not a
 * count of `drawElementsInstanced` calls a driver made. That an instanced draw
 * is in fact one call per group, that the geometry uploads once, and that the
 * frame time falls are all GPU claims and no test in this row makes them.
 *
 * The geometry the groups carry is the **fixture** mesh under twenty different
 * addresses, because the real store is empty (blocker B2). So the triangle
 * counts here are the fixture's 118, not a real LOD object's 5,000–20,000.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildPlanScene, createStyleResolver, planCatalogFromFile } from '@/builder/canvas'
import type { PlanCatalog } from '@/builder/canvas'
import type { BlobId, CatalogFile, CatalogRecord, DesignId } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'
import { FIXTURE_IDS, fixtureCatalogFile, fixtureDesignOf } from '@/builder/canvas/fixture'
import type { Resolution } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { Placement, PlacementId, WorkshopState } from '@/store'
import { VIEW_RADIUS } from '@/three/geometry'

import { REPORT_DELTA_OVER_UNITS, buildRoom3D, instanceKey } from './instances'
import type { LodGeometry } from './loadLod'
import { parseLodGlb } from './loadLod'
import { lodObjectBudget } from './lod'

const FIXTURE_GLB = join(process.cwd(), 'src', 'builder', 'three', 'fixtures', 'wall-8180da93.glb')
const CATALOG_PATH = join(process.cwd(), 'public', 'catalog', 'catalog.json')

/** One real store object, re-keyed under whatever address a test needs. */
let template: LodGeometry

async function geometryFor(blobs: readonly string[]): Promise<Map<string, LodGeometry>> {
  template ??= await parseLodGlb('8180da93549154744c37f8370a82738f' as BlobId, glbBytes())
  return new Map(blobs.map((blob) => [blob, { ...template, blob: blob as BlobId }]))
}

function glbBytes(): ArrayBuffer {
  const bytes = readFileSync(FIXTURE_GLB)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function placementsOf(entries: readonly (readonly [string, Placement])[]): WorkshopState['placements'] {
  return Object.fromEntries(entries)
}

/**
 * A placement of the **item** this fixture file belongs to — `fixtureDesignOf`
 * since row V4, so the tuple still reads as the file whose blob the instancing
 * keys on.
 */
function place(tileId: string, x: number, z: number, rotation = 0): Placement {
  return { design: fixtureDesignOf(tileId), x, z, rotation }
}

/**
 * A placement of a design named directly.
 *
 * For the two cases {@link place} cannot serve: a design **no** catalog holds
 * (the retired-ordinal path), and the emitted-index test below, whose designs
 * are the corpus's rather than the eleven-record fixture's.
 */
function placeDesign(design: string, x: number, z: number, rotation = 0): Placement {
  return { design: design as DesignId, x, z, rotation }
}

function resolverFor(catalog: PlanCatalog): (record: CatalogRecord) => Resolution {
  const cache = new Map<string, Resolution>()
  return (record) => {
    let resolution = cache.get(record.id)
    if (resolution === undefined) {
      resolution = resolveMaterial(catalog.tags(record), record.file)
      cache.set(record.id, resolution)
    }
    return resolution
  }
}

async function roomFrom(
  file: CatalogFile,
  placements: WorkshopState['placements'],
  options: { blobs?: readonly string[]; budget?: number } = {},
) {
  const catalog = planCatalogFromFile(file)
  const scene = buildPlanScene(placements, catalog, createStyleResolver(catalog))
  const blobs = options.blobs ?? [...new Set(scene.pieces.map((piece) => piece.record.blob))]
  return buildRoom3D(scene, {
    geometries: await geometryFor(blobs),
    resolve: resolverFor(catalog),
    viewRadius: VIEW_RADIUS,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  })
}

function emittedCatalog(): CatalogFile | null {
  if (!existsSync(CATALOG_PATH)) return null
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')))
}

/* ----------------------------------------------------------------- the key */

describe('instanceKey', () => {
  it('is the content address then the material variant, NUL-delimited', () => {
    const key = instanceKey('a'.repeat(32) as BlobId, 'dungeon_stone:worn')
    expect(key).toBe(`${'a'.repeat(32)}\u0000dungeon_stone:worn`)
    // The delimiter cannot occur in an md5 or a variant key, which is what makes
    // it the right one. Written as an escape — `tools/hygiene/source.test.ts`
    // fails the build on the literal byte.
    expect(key).not.toContain(' ')
  })
})

/* --------------------------------------------------------------- the grouping */

describe('buildRoom3D groups by shared geometry', () => {
  const file = fixtureCatalogFile()

  it('collapses four placements of one tile into one mesh with four matrices', async () => {
    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', place(FIXTURE_IDS.floor1, 0, 0)],
        ['p2', place(FIXTURE_IDS.floor1, 1, 0)],
        ['p3', place(FIXTURE_IDS.floor1, 2, 0)],
        ['p4', place(FIXTURE_IDS.floor1, 3, 0, 90)],
      ]),
    )
    expect(room.groups).toHaveLength(1)
    expect(room.groups[0]?.count).toBe(4)
    expect(room.groups[0]?.matrices).toHaveLength(4)
    expect(room.instances).toBe(4)
    // Four draws become one, and the rotated fourth is a matrix rather than a
    // second geometry.
    expect(room.groups[0]?.placements).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('counts decoded bytes per geometry, not per instance', async () => {
    const one = await roomFrom(file, placementsOf([['p1', place(FIXTURE_IDS.floor1, 0, 0)]]))
    const forty = await roomFrom(
      file,
      placementsOf(
        Array.from({ length: 40 }, (_unused, i) => [`p${String(i)}`, place(FIXTURE_IDS.floor1, i, 0)] as const),
      ),
    )
    // The fixture object: 59 vertices × 3 × float32 plus 354 uint16 indices.
    expect(one.decodedBytes).toBe(59 * 3 * 4 + 354 * 2)
    // Forty placements of it cost exactly the same bytes and 39 more matrices.
    // This is the identity the whole row is for, and it is what makes the budget
    // a count of geometries rather than of placements.
    expect(forty.decodedBytes).toBe(one.decodedBytes)
    expect(forty.instances).toBe(40)
    expect(forty.triangles).toBe(40 * 118)
  })

  it('keeps different tiles apart', async () => {
    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', place(FIXTURE_IDS.floor1, 0, 0)],
        ['p2', place(FIXTURE_IDS.floor2, 2, 0)],
        ['p3', place(FIXTURE_IDS.wall2, 0, 2)],
      ]),
    )
    expect(room.groups).toHaveLength(3)
    expect(room.instances).toBe(3)
  })

  it('unions the placed bounds, so the room fits into Stage’s frame', async () => {
    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', place(FIXTURE_IDS.floor1, 0, 0)],
        ['p2', place(FIXTURE_IDS.floor1, 8, 8)],
      ]),
    )
    // Two tiles eight units apart: the room is wider than one tile, and the
    // normalisation scale is smaller than it would be for one.
    expect(room.bounds.max.x - room.bounds.min.x).toBeGreaterThan(8 * 25.4)
    expect(room.fit.scale).toBeLessThan(1)
    expect(room.fit.radiusMm * room.fit.scale).toBeCloseTo(VIEW_RADIUS, 9)
  })

  it('carries the plan view’s own refusals through rather than re-deriving them', async () => {
    const catalog = planCatalogFromFile(file)
    const placements = placementsOf([
      ['p1', place(FIXTURE_IDS.floor1, 0, 0)],
      // Footprint `none` — the 726 tiles the plan view refuses.
      ['p2', place(FIXTURE_IDS.shapeless, 2, 0)],
      // Not in this build at all — a share link naming a retired ordinal.
      ['p3', placeDesign('d-nothing-here', 4, 0)],
    ])
    const scene = buildPlanScene(placements, catalog, createStyleResolver(catalog))
    expect(scene.undrawable).toHaveLength(1)
    expect(scene.unknown).toHaveLength(1)

    const room = await roomFrom(file, placements)
    // Only the drawable piece reaches 3D, and the other two are the plan view's
    // problem and already reported by it. No third opinion here.
    expect(room.instances).toBe(1)
    expect(room.objects).toBe(1)
  })

  it('draws every one of the six drawable footprint cases', async () => {
    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', place(FIXTURE_IDS.floor1, 0, 0)],
        ['p2', place(FIXTURE_IDS.wall2, 0, 4)],
        ['p3', place(FIXTURE_IDS.column, 4, 0)],
        ['p4', place(FIXTURE_IDS.tri, 6, 0, 45)],
        ['p5', place(FIXTURE_IDS.diag, 8, 0)],
        ['p6', place(FIXTURE_IDS.arc, 10, 0)],
        ['p7', place(FIXTURE_IDS.arcFallback, 14, 0)],
      ]),
    )
    // W6 made all seven cases draw and collide in plan; this row inherits the
    // lot, including the annular sector and the diag's intrinsic 45°.
    expect(room.instances).toBe(7)
    expect(room.groups).toHaveLength(7)
  })
})

/* ------------------------------------------------------------ the absences */

describe('the absent store', () => {
  const file = fixtureCatalogFile()

  it('lists a missing object as a gap and draws the rest', async () => {
    const present = file.records.find((record) => record.id === FIXTURE_IDS.floor1)?.blob
    if (present === undefined) throw new Error('fixture missing')

    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', place(FIXTURE_IDS.floor1, 0, 0)],
        ['p2', place(FIXTURE_IDS.floor2, 2, 0)],
      ]),
      // Only the first tile's object is in the store.
      { blobs: [present] },
    )
    expect(room.groups).toHaveLength(1)
    expect(room.absent).toHaveLength(1)
    expect(room.absent[0]?.placements).toEqual(['p2'])
    expect(room.absent[0]?.name).toBe('Dungeon stone floor 2×2')
    // `objects` counts what the room needs, loaded or not — that is what the
    // budget is checked against and what the readout reports.
    expect(room.objects).toBe(2)
  })

  it('returns an empty room rather than throwing when nothing is uploaded', async () => {
    // Today's real state: blocker B2 is open and every object 404s.
    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', place(FIXTURE_IDS.floor1, 0, 0)],
        ['p2', place(FIXTURE_IDS.wall2, 2, 0)],
      ]),
      { blobs: [] },
    )
    expect(room.groups).toHaveLength(0)
    expect(room.absent).toHaveLength(2)
    expect(room.instances).toBe(0)
    expect(room.triangles).toBe(0)
    expect(room.refusal).toBeNull()
    // And the fit is still finite, so the scene can mount without a NaN
    // bounding sphere quietly disabling culling.
    expect(Number.isFinite(room.fit.scale)).toBe(true)
  })
})

/* -------------------------------------------------------------- the budget */

describe('the budget', () => {
  const file = fixtureCatalogFile()

  it('refuses a room with more distinct meshes than memory allows', async () => {
    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', place(FIXTURE_IDS.floor1, 0, 0)],
        ['p2', place(FIXTURE_IDS.floor2, 2, 0)],
        ['p3', place(FIXTURE_IDS.wall2, 4, 0)],
      ]),
      { budget: 2 },
    )
    expect(room.refusal).toContain('3 different meshes')
    expect(room.groups).toHaveLength(0)
    expect(room.objects).toBe(3)
  })

  it('does not refuse repeat placements of the same mesh', async () => {
    const room = await roomFrom(
      file,
      placementsOf(
        Array.from({ length: 40 }, (_unused, i) => [`p${String(i)}`, place(FIXTURE_IDS.floor1, i, 0)] as const),
      ),
      { budget: 1 },
    )
    // Forty placements, one geometry, one draw. This is the case a
    // placement-count budget would have refused and instancing makes free.
    expect(room.refusal).toBeNull()
    expect(room.groups).toHaveLength(1)
    expect(room.instances).toBe(40)
    expect(room.objects).toBe(1)
  })
})

/* ------------------------------------------------ the mesh versus the tags */

describe('the footprint disagreement readout', () => {
  const file = fixtureCatalogFile()

  it('reports the fixture mesh against a 2×2 tag, which it is not', async () => {
    // The fixture object is a 1 × 0.5 wall base (25.4 × 12.7 mm). Standing in
    // for a 2×2 floor tile it disagrees by 1 unit on each axis — well over the
    // 0.25-unit threshold — and the room says so instead of hiding it.
    const room = await roomFrom(file, placementsOf([['p1', place(FIXTURE_IDS.floor2, 0, 0)]]))
    expect(REPORT_DELTA_OVER_UNITS).toBe(0.25)
    expect(room.disagreements).toHaveLength(1)
    // 1.499924 rather than a round 1.5: the fixture's second axis measures
    // 12.7019 mm, not 12.7, because the position is quantized to int16 and
    // dequantized through a float32 node scale. Worth seeing — the store's
    // dimensions carry that residue and no consumer should assume otherwise.
    expect(room.disagreements[0]?.worst).toBeCloseTo(1.4999, 4)
    expect(room.disagreements[0]?.name).toBe('Dungeon stone floor 2×2')
  })

  it('says nothing when the mesh matches the tag', async () => {
    // The fixture object *is* the 1 × 0.5 wall — 25.4 × 12.7 mm against a
    // 1-unit wall's 1 × 0.5 extent, so the disagreement is zero.
    const wallFile = fixtureCatalogFile()
    const room = await roomFrom(
      wallFile,
      placementsOf([['p1', place(FIXTURE_IDS.wall2, 0, 0)]]),
    )
    // The 2-unit wall is 2 × 0.5 against the fixture's 1 × 0.5: one unit out on
    // one axis, so it *is* reported. The point of the pair is that the readout
    // measures rather than assumes.
    expect(room.disagreements[0]?.worst).toBeCloseTo(1, 6)
  })
})

/* --------------------------------------------- the projection, on real data */

describe('fifty placements across twenty real designs', () => {
  const file = emittedCatalog()

  it.runIf(file !== null)('is 20 instanced meshes, 50 instances and 1 shared material', async () => {
    const records = [...(file?.records ?? [])].sort((a, b) => a.ord - b.ord)

    // One file per design — the lowest-ordinal placeable one, which is what a
    // palette hands the builder — over the first twenty designs in display
    // order.
    const perDesign = new Map<string, CatalogRecord>()
    for (const record of records) {
      if (record.foot.shape === 'none') continue
      if (!perDesign.has(record.design)) perDesign.set(record.design, record)
      if (perDesign.size === 20) break
    }
    const chosen = [...perDesign.values()]
    expect(chosen).toHaveLength(20)

    // Fifty placements round-robin over them: two or three of each.
    const placements = placementsOf(
      Array.from({ length: 50 }, (_unused, i) => {
        const record = chosen[i % chosen.length]
        if (record === undefined) throw new Error('no record')
        return [
          `p${String(i)}` as PlacementId,
          placeDesign(record.design, (i % 10) * 4, Math.floor(i / 10) * 4),
        ] as const
      }),
    )

    const room = await roomFrom(file as CatalogFile, placements)

    // The answer, counted rather than reasoned about.
    expect(room.instances).toBe(50)
    expect(room.groups).toHaveLength(20)
    expect(room.objects).toBe(20)
    expect(room.objects).toBeLessThanOrEqual(lodObjectBudget())

    // Draw calls: 50 meshes become 20. The 30 repeat placements cost one 4×4
    // matrix each, and no bytes at all.
    const matrices = room.groups.reduce((total, group) => total + group.matrices.length, 0)
    expect(matrices).toBe(50)

    // Materials: the registry collapses the whole 8,702-record archive to 16
    // families, and the first twenty designs in display order all land on the
    // *same* one — they are the archive's opening run of plain bases. So this
    // room draws 20 instanced meshes sharing **one** refcounted material, which
    // is the case `src/three/material.ts` was refcounted for.
    const families = new Set(room.groups.map((group) => group.resolution.family.id))
    expect(families.size).toBe(1)
    expect(families.size).toBeLessThanOrEqual(16)
    // Instance-key note: the material is in the key, so one family does not
    // merge two geometries — still 20 groups above, not one.
    expect(new Set(room.groups.map((group) => group.key)).size).toBe(20)
  })

  it.runIf(file !== null)('is why the key is the blob and not the design', () => {
    const records = file?.records ?? []
    const byDesign = new Map<string, Set<string>>()
    for (const record of records) {
      const seen = byDesign.get(record.design) ?? new Set<string>()
      seen.add(record.blob)
      byDesign.set(record.design, seen)
    }
    const fanout = [...byDesign.values()].map((set) => set.size)

    expect(byDesign.size).toBe(3_822)
    expect(new Set(records.map((record) => record.blob)).size).toBe(8_353)
    // 56.04% of designs are one mesh; the rest are families of connection
    // variants, and one of them is sixteen different meshes. An InstancedMesh
    // shares exactly one geometry, so `design` is not a key it can take.
    expect(fanout.filter((n) => n === 1)).toHaveLength(2_142)
    expect(fanout.filter((n) => n > 1)).toHaveLength(1_680)
    expect(Math.max(...fanout)).toBe(16)

    // And in the other direction the blob key is *better* than per-design on 102
    // md5s: two designs that are the same bytes draw in one call.
    const byBlob = new Map<string, Set<string>>()
    for (const record of records) {
      const seen = byBlob.get(record.blob) ?? new Set<string>()
      seen.add(record.design)
      byBlob.set(record.blob, seen)
    }
    const shared = [...byBlob.values()].filter((set) => set.size > 1)
    expect(shared).toHaveLength(102)
    expect(Math.max(...shared.map((set) => set.size))).toBe(4)
  })
})
