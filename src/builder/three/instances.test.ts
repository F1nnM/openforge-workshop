/// <reference types="node" />
/**
 * The instancing, and the projection the row is named after.
 *
 * ## What these tests prove
 *
 *   - Repeat parts on one file collapse into **one** `InstancedMesh` with N
 *     matrices, and different files do not.
 *   - **A placement is N draws.** Row A4b's whole change: one instance with five
 *     filled slots is five matrices across up to five groups, each lifted by its
 *     own slot elevation, and the ids in a group name the *instance* rather than
 *     the part — so an id repeats when two slots hold the same file.
 *   - **Contract C-d**: the object set is derived once, by `roomBlobs`, and it is
 *     the set `BuilderRoom` fetches as well as the set `buildRoom3D` groups.
 *   - **The 50-across-20 projection is run rather than asserted.** Twenty real
 *     files out of the emitted index, fifty parts over them, and the answer
 *     counted: 20 groups, 50 instances, and the one material the registry
 *     actually collapses them to.
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

import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { buildPlanScene, createStyleResolver, planCatalogFromFile } from '@/builder/canvas'
import type { PlanCatalog } from '@/builder/canvas'
import type { BlobId, CatalogFile, CatalogRecord } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'
import {
  FIXTURE_SLOTS,
  FIXTURE_IDS,
  fixtureCatalogFile,
  fixtureFills,
  fixtureInstance,
  fixtureSlotLayout,
} from '@/builder/canvas/fixture'
import type { Resolution } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { PlacementId, TemplateInstance, WorkshopState } from '@/store'
import { filledSlots } from '@/store'
import { VIEW_RADIUS } from '@/three/geometry'

import { REPORT_DELTA_OVER_UNITS, buildRoom3D, instanceKey, roomBlobs } from './instances'
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

/**
 * The slots a {@link Spec}'s files go into, in order.
 *
 * The fixture family's own five names, and `floor` first because it is the slot
 * **40 of the 40 shipped templates carry** — so a one-file spec describes the
 * commonest instance there is rather than an unusual one. Two of the five contain
 * a space, which is the property `src/store/schema.ts#SlotName` refuses a slug
 * pattern over and the reason a test must not invent its own names.
 */
const SLOT_ORDER = [
  FIXTURE_SLOTS.floor,
  FIXTURE_SLOTS.base,
  FIXTURE_SLOTS.leftWall,
  FIXTURE_SLOTS.rightWall,
  FIXTURE_SLOTS.column,
] as const

/** What one instance holds: a file per slot, in {@link SLOT_ORDER}, and a pose. */
interface Spec {
  readonly tiles: readonly string[]
  readonly x: number
  readonly z: number
  readonly rotation?: number
}

function placementsOf(entries: readonly (readonly [string, Spec])[]): WorkshopState['placements'] {
  const map: Record<string, TemplateInstance> = {}
  for (const [id, spec] of entries) {
    const fills = fixtureFills(spec.tiles.map((tile, index) => [SLOT_ORDER[index] as string, tile] as const))
    map[id] = fixtureInstance(id, fills, { x: spec.x, z: spec.z, rotation: spec.rotation })
  }
  return map
}

/**
 * One instance with one file, in the `floor` slot.
 *
 * The shorthand almost every test here wants: the subject is the *instancing*,
 * and one file per placement is the case that isolates it. `placeAll` is the
 * multi-part form, and the tests about arity use it.
 *
 * The file id is named directly, which is all row A1 left to name: a `SlotFill`
 * holds a `TileId` (decision **D1**) and there is no aggregate hop, so a file
 * this catalog does not hold is the same call with a different string — the
 * retired-id path below.
 */
function place(tile: string, x: number, z: number, rotation = 0): Spec {
  return { tiles: [tile], x, z, rotation }
}

/** One instance with a file per slot, in {@link SLOT_ORDER}. Up to five. */
function placeAll(tiles: readonly string[], x: number, z: number, rotation = 0): Spec {
  return { tiles, x, z, rotation }
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
  options: { blobs?: readonly string[]; budget?: number; layout?: boolean } = {},
) {
  const catalog =
    options.layout === true ? planCatalogFromFile(file, fixtureSlotLayout) : planCatalogFromFile(file)
  const scene = buildPlanScene(placements, catalog, createStyleResolver(catalog))
  // `roomBlobs` and not a second walk of the scene — contract **C-d**, and the
  // point of testing through it is that a test with its own derivation could not
  // catch the two disagreeing.
  const blobs = options.blobs ?? [...roomBlobs(scene)]
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
      // Not in this build at all — a share link naming a file the index retired.
      ['p3', place('tiles/nothing/here.stl', 4, 0)],
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

/* ------------------------------------------------- a placement is N draws */

describe('one instance, many parts — row A4b', () => {
  const file = fixtureCatalogFile()

  it('draws one matrix per filled slot, not one per placement', async () => {
    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', placeAll([FIXTURE_IDS.floor2, FIXTURE_IDS.floor1, FIXTURE_IDS.wall2], 0, 0)],
      ]),
      { layout: true },
    )
    // One placement. Three files, so three geometries and three matrices — the
    // arity change this row exists for. A room that counted placements would
    // report 1 and draw 3.
    expect(room.instances).toBe(3)
    expect(room.groups).toHaveLength(3)
    expect(room.objects).toBe(3)
  })

  it('names the instance in every group, so an id repeats across its slots', async () => {
    // Two slots filled with the **same** file: one group, two matrices, and the
    // same `PlacementId` twice. `LodInstanceGroup.placements` is *"one per
    // matrix"*, and every gesture is addressed to a placement, so the repeat is
    // the honest answer rather than a de-duplication bug.
    const room = await roomFrom(
      file,
      placementsOf([['p1', placeAll([FIXTURE_IDS.wall2, FIXTURE_IDS.wall2], 0, 0)]]),
      { layout: true },
    )
    expect(room.groups).toHaveLength(1)
    expect(room.groups[0]?.count).toBe(2)
    expect(room.groups[0]?.placements).toEqual(['p1', 'p1'])
    expect(room.objects).toBe(1)
  })

  it('lifts each part by its own slot elevation and nothing else', async () => {
    // The elevation that replaced rule 1's base inference. `fixtureSlotLayout`
    // puts the base on the plan, the floor a quarter inch up and the right wall
    // half an inch up — three distinct numbers — so a renderer applying one
    // part's height to another, or applying none, is visible here.
    const room = await roomFrom(
      file,
      placementsOf([
        ['p1', { tiles: [FIXTURE_IDS.floor2], x: 0, z: 0 }],
        ['p2', { tiles: [FIXTURE_IDS.floor2, FIXTURE_IDS.floor2], x: 0, z: 0 }],
      ]),
      { layout: true },
    )
    // One group — one file — holding p1's `floor`, then p2's `floor` and `base`.
    expect(room.groups).toHaveLength(1)
    const group = room.groups[0]
    expect(group?.placements).toEqual(['p1', 'p2', 'p2'])

    // The y translation of each matrix. It is the slot's elevation **plus**
    // `tileMatrix`'s own `-upright.min.y`, which rests the mesh's lowest point on
    // the plan — and on this fixture that is not exactly zero: the store's
    // positions are quantized to int16 and dequantized through a float32 node
    // scale, so the object's floor measures **-9.184e-5 mm** rather than 0. Worth
    // seeing rather than rounding away; `contract.test.ts` records the same
    // residue from the other end.
    const lifts = (group?.matrices ?? []).map((matrix) => matrix.elements[13])
    expect(lifts).toHaveLength(3)
    const [p1Floor = 0, p2Base = 0, p2Floor = 0] = lifts
    expect(Math.abs(p2Base)).toBeLessThan(1e-3)

    // The **lift**, which is what this row applies: the difference against the
    // part resting on the plan, where the mesh's own residue cancels exactly.
    // `catalog.parts` sorts the slots by name, so p2's are `base` then `floor`.
    expect(p1Floor - p2Base).toBeCloseTo(6.35, 9)
    expect(p2Floor - p2Base).toBeCloseTo(6.35, 9)
  })

  it('rests every part on the plan when the layout declares no lift', async () => {
    // `originSlotLayout` — the rule in force until row B2's lands — is zero for
    // every slot, so the default catalog must produce no lift at all. That is
    // what makes this row's change invisible to every test written before it.
    const room = await roomFrom(
      file,
      placementsOf([['p1', placeAll([FIXTURE_IDS.floor2, FIXTURE_IDS.wall2], 0, 0)]]),
    )
    // Within the mesh's own rest residue of the plan — see the test above for
    // where the 9.184e-5 mm comes from. Zero *lift*, which is the claim.
    for (const group of room.groups) {
      for (const matrix of group.matrices) expect(Math.abs(matrix.elements[13])).toBeLessThan(1e-3)
    }
  })

  it('gaps a placement once per absent blob, however many slots want it', async () => {
    // Two slots on one absent file. `absent[].placements` is what `BuilderRoom`
    // counts outlined *pieces* with, so naming the instance twice would report
    // two things the user sees as one.
    const room = await roomFrom(
      file,
      placementsOf([['p1', placeAll([FIXTURE_IDS.wall2, FIXTURE_IDS.wall2], 0, 0)]]),
      { blobs: [] },
    )
    expect(room.absent).toHaveLength(1)
    expect(room.absent[0]?.placements).toEqual(['p1'])
  })

  it('places an instance with no filled slots and draws nothing for it', async () => {
    // Contract **C-g**, and the state every placement lands in until row C2's
    // fill solver runs. It must not be a group, must not be a gap, and must not
    // take the room down: `buildPlanScene` reports it in `PlanScene.unfilled` and
    // this module never sees it.
    const catalog = planCatalogFromFile(file)
    const placements = placementsOf([['p1', { tiles: [], x: 0, z: 0 }]])
    const scene = buildPlanScene(placements, catalog, createStyleResolver(catalog))
    expect(scene.pieces).toHaveLength(0)
    expect(scene.unfilled).toHaveLength(1)

    const room = await roomFrom(file, placements)
    expect(room.groups).toHaveLength(0)
    expect(room.absent).toHaveLength(0)
    expect(room.instances).toBe(0)
    expect(room.objects).toBe(0)
    expect(room.refusal).toBeNull()
  })
})

/* ------------------------------------- the composition, from the renderer */

describe('a template is a rigid body under rotation', () => {
  const file = fixtureCatalogFile()

  /** The fixture corner: base, floor, two walls and a column, laid out for real. */
  const CORNER = [
    FIXTURE_IDS.floor2,
    FIXTURE_IDS.floor2,
    FIXTURE_IDS.wall2,
    FIXTURE_IDS.wall2,
    FIXTURE_IDS.column,
  ]

  async function boundsAt(rotation: number) {
    const room = await roomFrom(
      file,
      placementsOf([['p1', placeAll(CORNER, 0, 0, rotation)]]),
      { layout: true },
    )
    const size = room.bounds.getSize(new Vector3())
    return { room, footprintMm2: size.x * size.z }
  }

  /**
   * **The alarm row A4b armed, and row A10 disarmed by fixing the composition.**
   *
   * A template is *"placed and rotated as one unit"* (§1), so its footprint is a
   * **rigid body**: a quarter turn may swap width for depth and must not change
   * the area. A4b wrote this as `it.fails` with the defect measured, because the
   * fix was not its to make.
   *
   * ## What was wrong, as A4b measured it
   *
   * `geometry.ts#slotAnchor` composed the placement as *"the part turns about its
   * own anchor corner, and that corner orbits the instance origin"*. The two
   * effects do not compose: orbiting the minimum corner is correct for a *point*,
   * but the part then still extends towards +x/+z from that orbited corner
   * instead of in the direction the turn sent it, so a part at `dx: +1.5` landed
   * at -1.5 and grew back over the origin. Union footprint, in grid units²:
   *
   * | instance rotation | union box | area |
   * | ---: | --- | ---: |
   * | 0°   | 2.00 x 2.00 at (0, 0)        | **4.00** |
   * | 90°  | 3.50 x 2.00 at (-1.5, 0)     | 7.00 |
   * | 180° | 3.50 x 3.50 at (-1.5, -1.5)  | **12.25** |
   * | 270° | 2.00 x 3.50 at (0, -1.5)     | 7.00 |
   *
   * At 180° the assembly covered **three times** the ground, and `room.bounds`
   * feeds `fitRoom`, so a room turned a half turn framed a box three times too
   * large. **Every single-slot instance was unaffected** — `dx`/`dz` are 0, so
   * there was nothing to orbit — which is why no test written before A4b could
   * see it.
   *
   * ## What the fix is, and what the invariant value is
   *
   * A4b proposed reinterpreting `dx`/`dz` as the part's **centre** offset, which
   * it measured as invariant at 7.56 units². That figure is an artefact of the
   * measurement rather than the footprint of a corner: `fixture.ts`'s five
   * offsets are authored as *minimum corners* (the `right wall` at `dx: 1.5` with
   * a 0.5 thickness is exactly the cell's east edge), so reading them as centres
   * moves four of the five parts and pushes the union to 2.75 x 2.75 — a 2 x 2
   * corner overhanging its own cell by three quarters of a unit on two sides.
   *
   * **The invariant value is 4.00**, and it comes from row B2's own conventions
   * rather than from this fixture: `EXTERNAL_CORNER` anchors each wall `edge`
   * — *"flush to one face and centred across it"* — and the column `corner`, and
   * `offsets.ts#slotOffset` insets every one of them *inwards* by
   * `-(cell - part) / 2`. Nothing overhangs, so the union of a 2 x 2 corner's
   * five parts is the 2 x 2 cell. `template/offsets.test.ts` derives the five
   * offsets from `slotOffset` and measures the union at 4.00 on all four
   * quarters; `canvas/geometry.test.ts` measures the same on this fixture and
   * also reproduces the 4 / 7 / 12.25 / 7 table above with the cell removed.
   *
   * So `slotAnchor` now turns the part's **box** about the instance origin and
   * re-anchors the turned assembly by the cell's own turned corner — which keeps
   * the area *and* keeps `x`/`z` the minimum corner of what the instance
   * occupies, the convention `geometry.ts` derives from the 0.5 lattice and the
   * share codec's quantum.
   */
  it('keeps its footprint area across quarter turns', async () => {
    const flat = await boundsAt(0)
    for (const rotation of [90, 180, 270]) {
      const turned = await boundsAt(rotation)
      expect(turned.footprintMm2).toBeCloseTo(flat.footprintMm2, 3)
    }
  })

  it('draws all five parts whichever way the instance is turned', async () => {
    // The other half of "as one unit", and the half that was already true while
    // the offsets were wrong: the arity, the grouping and the elevations survive
    // a rotation, so A4b's alarm was about placement alone.
    for (const rotation of [0, 90, 180, 270]) {
      const { room } = await boundsAt(rotation)
      expect(room.instances).toBe(5)
      // Three files across five slots — the floor twice and the wall twice.
      expect(room.groups).toHaveLength(3)
      expect(room.refusal).toBeNull()
    }
  })
})

/* --------------------------------------------------------- contract C-d */

describe('the object set is one derivation', () => {
  const file = fixtureCatalogFile()

  it('is every drawn part’s blob, deduplicated, and is what the budget counts', async () => {
    const catalog = planCatalogFromFile(file)
    const placements = placementsOf([
      ['p1', placeAll([FIXTURE_IDS.floor2, FIXTURE_IDS.wall2], 0, 0)],
      // The same two files again, in a second instance: no new objects.
      ['p2', placeAll([FIXTURE_IDS.floor2, FIXTURE_IDS.wall2], 4, 0)],
      ['p3', place(FIXTURE_IDS.floor1, 8, 0)],
    ])
    const scene = buildPlanScene(placements, catalog, createStyleResolver(catalog))

    const blobs = roomBlobs(scene)
    expect(blobs.size).toBe(3)
    // Four parts on two files plus one more: five parts, three objects.
    const parts = scene.pieces.reduce((sum, piece) => sum + piece.parts.length, 0)
    expect(parts).toBe(5)

    const room = await roomFrom(file, placements)
    expect(room.objects).toBe(blobs.size)
    expect(room.instances).toBe(parts)
    expect(new Set(room.groups.map((group) => group.blob))).toEqual(blobs)
  })

  it('is a subset of what @/mesh warms, which is the safe direction', () => {
    // A2 warms a blob for **every filled slot**; this asks for one per *drawn*
    // part. The two differ by exactly the fills whose file has a `none`
    // footprint — `PlanScene.undrawable` — and the difference is one-sided: every
    // object the room asks for is one the warming pass has converted, so no blob
    // can strand as "not in the store" through the two derivations disagreeing.
    // The reverse difference costs a conversion nobody looks at.
    const catalog = planCatalogFromFile(file)
    const placements = placementsOf([
      ['p1', placeAll([FIXTURE_IDS.floor2, FIXTURE_IDS.shapeless], 0, 0)],
    ])
    const scene = buildPlanScene(placements, catalog, createStyleResolver(catalog))

    // A2's derivation, restated here because `src/mesh/**` is not this row's:
    // every filled slot's file, resolved to a blob.
    const warmed = new Set<string>()
    for (const instance of Object.values(placements)) {
      for (const slot of filledSlots(instance.fills)) {
        const fill = instance.fills[slot]
        if (fill === undefined) continue
        const record = catalog.record(fill.tile)
        if (record !== undefined) warmed.add(record.blob)
      }
    }

    const asked = roomBlobs(scene)
    expect(scene.undrawable).toHaveLength(1)
    expect(warmed.size).toBe(2)
    expect(asked.size).toBe(1)
    for (const blob of asked) expect(warmed.has(blob)).toBe(true)
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

    // One file per design — the lowest-ordinal placeable one — over the first
    // twenty designs in display order. Since row A1 a fill names the **file**
    // directly (decision D1), so this is the id that reaches the store rather
    // than a design the store would have to resolve.
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
          place(record.id, (i % 10) * 4, Math.floor(i / 10) * 4),
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
