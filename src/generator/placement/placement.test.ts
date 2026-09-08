/// <reference types="node" />
/**
 * Identity, footprint and collision for a generated base.
 *
 * **What these prove.** Every assertion here is arithmetic or a schema parse, so
 * they hold wherever the suite runs. The identity tests are the load-bearing
 * ones: they show that a generated id cannot enter the `TileId` space and that
 * `generatedPlacementKey` therefore cannot collide with `billView.ts`'s
 * `placementKey`, which row G4's move refusal depends on being unique.
 *
 * **What they cannot prove.** Nothing here renders anything: no engine is
 * loaded, and no mesh exists. The footprint claims are about `x`, `y` and the
 * basis, which is exactly why S4 computes them from parameters rather than from
 * geometry — but a claim that the *mesh* is the size the footprint says is not
 * in this file and is not in this row. And these tests do not draw: jsdom
 * rasterises nothing and measures no layout, so "the outline is right" here
 * means "the polygon has these coordinates", never "it looks right".
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { GRID_UNIT_MM, TileId } from '@/catalog'
import { footprintShape, planGeometry } from '@/builder/canvas/geometry'
import { findConflicts, levelAt, planBand } from '@/builder/canvas/overlap'
import type { PlacementId } from '@/store'
import { TemplateInstance as TemplateInstanceSchema } from '@/store'

import { BASIS_MM, GRID_BASIS } from '../panel/footprint'
import { canonicalise, recipeId, recipeKey } from '../panel/recipe'
import type { ArchiveBase } from '../panel/resolve'
import { ENTRY_LABELS, PANEL_ENTRIES, panelSchema } from '../panel/schemas'

import { buildGeneratedBill } from './bill'
import { generatedFootprint, generatedOverlapCandidate, generatedPiece } from './geometry'
import { GENERATED_ROTATION_STEP_DEG, placeRecipe } from './placement'
import { SCAD_UPSTREAM } from './provenance'
import type { GeneratedPlacement } from './scene'
import {
  GENERATED_ENTRIES,
  GENERATED_ID_PREFIX,
  GENERATED_SHAPES,
  GeneratedPlacement as GeneratedPlacementSchema,
  generatedBaseId,
  generatedPlacementKey,
  isGeneratedBaseId,
  recipeHandle,
  recipeKeyOf,
} from './scene'

/* ------------------------------------------------------------------ fixtures */

const SQUARE = 'bases-square.scad' as const

function recipeOf(entry: (typeof PANEL_ENTRIES)[number], values: Record<string, number | string | boolean>) {
  return { v: 1 as const, entry, parameters: canonicalise(entry, values) }
}

/** A resolution with no archived answer — the ordinary generated case. */
const ABSENT = { kind: 'absent' } as const

function archiveBase(overrides: Partial<ArchiveBase> = {}): ArchiveBase {
  return {
    blob: '0'.repeat(32) as ArchiveBase['blob'],
    file: 'plain#base+square.2x2.openlock,magnetic+flex.stl',
    bytes: 106_092,
    sprite: true,
    name: 'Plain Square Base 2x2',
    id: 'tiles/bases/plain/openlock,magnetic+flex/plain#base+square.2x2.openlock,magnetic+flex.stl',
    // The item this archived file is one connection variant of. S4's resolver
    // carries it for row V4's `Placement`, which named a design — row A9 stopped
    // reading it, because A1's fills name files. Kept here only because
    // `ArchiveBase` still declares it; the field has no reader left in `src`.
    design: 'd-plain-square-2x2' as ArchiveBase['design'],
    swept: {
      file: 'plain#base+square.2x2.openlock,magnetic+flex.stl',
      entry: SQUARE,
      parameters: { x: 2, y: 2 },
      dirname: 'openlock,magnetic+flex',
      priority: 'magnets',
      historical: false,
    },
    ...overrides,
  }
}

function placementOf(values: Record<string, number | string | boolean>, at = { x: 0, z: 0 }): GeneratedPlacement {
  const placed = placeRecipe(recipeOf(SQUARE, values), ABSENT, at)
  if (placed.kind !== 'generated') throw new Error('expected a generated placement')
  return placed.placement
}

/* ------------------------------------------------------------------ identity */

describe('a generated base’s identity', () => {
  it('is the canonical recipe key, so equal recipes are equal ids', () => {
    // The whole point of `canonicalise`: one set spells out a default the other
    // leaves implicit, and they are one recipe.
    const spelled = placementOf({ x: 2, y: 2, HEIGHT: panelSchema(SQUARE).parameters.find((p) => p.name === 'HEIGHT')?.initial as number })
    const implicit = placementOf({ x: 2, y: 2 })
    expect(spelled.base).toBe(implicit.base)
    expect(placementOf({ x: 3, y: 2 }).base).not.toBe(implicit.base)
  })

  it('is never a TileId, in both of the two ways that can be shown', () => {
    for (const entry of GENERATED_ENTRIES) {
      const id = generatedBaseId(recipeKey(recipeOf(entry, { x: 2, y: 2 })))
      expect(TileId.safeParse(id).success).toBe(false)
      expect(String(id).startsWith('tiles/')).toBe(false)
      expect(String(id).startsWith(GENERATED_ID_PREFIX)).toBe(true)
    }
  })

  it('produces a placement key that cannot collide with billView’s', () => {
    // `billView.ts`: `${tileId}|${x}|${z}|${rotation}`. Row G4's one move
    // refusal is an identical twin and its docblock rests on that tuple being
    // unique, so the generated key has to live in a disjoint space. It does,
    // because the first field can never be a `TileId`.
    const placement = placementOf({ x: 2, y: 2 }, { x: 1, z: -2 })
    const key = generatedPlacementKey(placement)
    expect(key).toBe(`${placement.base}|1|-2|0`)
    const [head] = key.split('|')
    expect(TileId.safeParse(head).success).toBe(false)
    // And the two keys are equal iff all four fields are — the twin case.
    expect(generatedPlacementKey(placementOf({ x: 2, y: 2 }, { x: 1, z: -2 }))).toBe(key)
    expect(generatedPlacementKey(placementOf({ x: 2, y: 2 }, { x: 1, z: -3 }))).not.toBe(key)
  })

  it('round-trips to the key it was made from', () => {
    const key = recipeKey(recipeOf(SQUARE, { x: 4, y: 2 }))
    expect(recipeKeyOf(generatedBaseId(key))).toBe(key)
  })

  it('hands out exactly S4’s 8-character handle, without importing it', () => {
    // `recipeHandle` restates `recipeId`, because importing it pulls
    // `panel/schemas.ts` and 25 KB of pinned parameter JSON into the bill
    // panel's chunk — measured at +20,168 B on the entry bundle, see
    // `scene.ts`. This is the equivalence that makes the restatement safe: a
    // drift fails here rather than showing two handles for one base.
    for (const entry of GENERATED_ENTRIES) {
      for (const values of [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 8, y: 8, HEIGHT: 12 }, { x: 3, y: 3, SQUARE_BASIS: 'wyloch' }]) {
        const key = recipeKey(recipeOf(entry, values))
        expect(recipeHandle(generatedBaseId(key)), `${entry} ${JSON.stringify(values)}`).toBe(recipeId(key))
      }
    }
    // And it is what the bill row shows.
    const key = recipeKey(recipeOf(SQUARE, { x: 4, y: 2 }))
    const bill = buildGeneratedBill({ ['p1' as PlacementId]: placementOf({ x: 4, y: 2 }) })
    expect(bill.lines[0]?.recipeId).toBe(recipeId(key))
    expect(bill.lines[0]?.recipeId).toHaveLength(8)
  })

  it('rejects a string that is not in its space', () => {
    expect(isGeneratedBaseId('tiles/bases/plain/x.stl')).toBe(false)
    expect(isGeneratedBaseId(GENERATED_ID_PREFIX)).toBe(false)
    expect(isGeneratedBaseId(`${GENERATED_ID_PREFIX}v1 bases-square.scad x=2`)).toBe(true)
  })
})

/* -------------------------------------------------------------- the schema */

describe('what a generated placement persists', () => {
  it('holds the recipe and has nowhere to put a mesh', () => {
    const parsed = GeneratedPlacementSchema.parse({
      base: generatedBaseId(recipeKey(recipeOf(SQUARE, { x: 2, y: 2 }))),
      recipe: recipeOf(SQUARE, { x: 2, y: 2 }),
      x: 0,
      z: 0,
      rotation: 0,
      // S4's rule: persist the recipe, never the mesh. Zod strips what the
      // schema does not declare, so a caller that tried would not get it back.
      mesh: new Uint8Array([1, 2, 3]),
      md5: 'f'.repeat(32),
    })
    expect(parsed).not.toHaveProperty('mesh')
    expect(parsed).not.toHaveProperty('md5')
    expect(Object.keys(parsed).sort()).toEqual(['base', 'recipe', 'rotation', 'x', 'z'])
    // ~200 bytes against 0.5–2.4 MB of STL, which is the argument for storing it.
    expect(JSON.stringify(parsed.recipe).length).toBeLessThan(500)
  })

  it('normalises -0 the way the store’s own coordinate does', () => {
    const parsed = GeneratedPlacementSchema.parse({
      base: generatedBaseId(recipeKey(recipeOf(SQUARE, { x: 2, y: 2 }))),
      recipe: recipeOf(SQUARE, { x: 2, y: 2 }),
      x: -0,
      z: -0,
      rotation: 0,
    })
    expect(Object.is(parsed.x, 0)).toBe(true)
    expect(Object.is(parsed.z, 0)).toBe(true)
    // The same value the store's own placement record produces, so a scene of
    // both compares equal to itself after an export and re-import. The template
    // id here names no family — this is `schema.ts#coordinate`'s `+ 0` under
    // test, and nothing else.
    const catalogue = TemplateInstanceSchema.parse({
      id: 'p1',
      template: 'a-family',
      x: -0,
      z: -0,
      rotation: 0,
      fills: {},
    })
    expect(Object.is(catalogue.x, parsed.x)).toBe(true)
  })

  it('refuses an entry point with no footprint rule', () => {
    expect(
      GeneratedPlacementSchema.safeParse({
        base: `${GENERATED_ID_PREFIX}v1 bases-curved.scad x=2`,
        recipe: { v: 1, entry: 'bases-curved.scad', parameters: { x: 2 } },
        x: 0,
        z: 0,
        rotation: 0,
      }).success,
    ).toBe(false)
  })
})

/* ------------------------------------------------------- S4’s tables, unmoved */

describe('the restated tables', () => {
  it('cover exactly the five shapes S4 offers, with S4’s labels', () => {
    expect(GENERATED_ENTRIES).toEqual([...PANEL_ENTRIES])
    for (const entry of PANEL_ENTRIES) {
      expect(GENERATED_SHAPES[entry].label).toBe(ENTRY_LABELS[entry])
    }
  })

  it('pins the same upstream commit the refresh script does', () => {
    // The third copy of the SHA in the repository. `src/generator/scad/**` and
    // `scripts/refresh-scad.ts` are not this row's to edit, so a refresh that
    // moves the pin and forgets this file fails here.
    const script = readFileSync('scripts/refresh-scad.ts', 'utf8')
    expect(script).toContain(SCAD_UPSTREAM.commit)
    expect(script).toContain(SCAD_UPSTREAM.repo)
  })

  it('turns a rect on the grid, 90° at a time', () => {
    expect(GENERATED_ROTATION_STEP_DEG).toBe(90)
  })
})

/* ----------------------------------------------------------------- footprint */

describe('the footprint, in the grid’s own squares', () => {
  it('is the identity on the inch basis, at every x the schema offers', () => {
    const options = panelSchema(SQUARE).parameters.find((p) => p.name === 'x')?.options ?? []
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      const x = option.value as number
      const foot = generatedFootprint(placementOf({ x, y: x, SQUARE_BASIS: GRID_BASIS }))
      expect(foot.tiles).toBe(true)
      expect(foot.gridFootprint).toEqual({ shape: 'rect', w: x, d: x })
      // Without the rounding this is 2.9999999999999996 at x = 3.
      expect(foot.gridFootprint).toEqual(foot.footprint)
    }
  })

  it('converts a non-inch basis rather than understating the piece', () => {
    for (const [basis, mm] of Object.entries(BASIS_MM)) {
      if (basis === GRID_BASIS) continue
      const foot = generatedFootprint(placementOf({ x: 2, y: 2, SQUARE_BASIS: basis }))
      expect(foot.tiles).toBe(false)
      expect(foot.basisMm).toBe(mm)
      // Two squares of this basis, expressed in 25.4 mm grid squares.
      const expected = Math.round(((2 * mm) / GRID_UNIT_MM) * 1_000_000) / 1_000_000
      expect(foot.gridFootprint).toEqual({ shape: 'rect', w: expected, d: expected })
      // The claim the conversion exists for: a wyloch 2x2 is 2.5 squares, and
      // drawing it at 2 would understate a real object by 25%.
      if (basis === 'wyloch') expect(expected).toBe(2.5)
    }
  })

  it('ignores NOTCH for the bounding footprint, as the catalog does', () => {
    // `plain#base+square.4x4+notch` carries `{rect, w:4, d:4}`. A placement that
    // claimed the notch would refuse a legal neighbour.
    const notched = generatedFootprint(placementOf({ x: 4, y: 4, NOTCH: 'true' }))
    expect(notched.gridFootprint).toEqual({ shape: 'rect', w: 4, d: 4 })
  })
})

/* ----------------------------------------------------------------- collision */

describe('reaching the plan view’s collision', () => {
  const idOf = (n: number) => String(n) as PlacementId

  it('is W6’s own geometry, not a second copy of it', () => {
    const placement = placementOf({ x: 2, y: 2 }, { x: 1, z: 1 })
    const piece = generatedPiece(idOf(1), placement)
    // Every field is what W6's functions return for this footprint.
    const shape = footprintShape({ shape: 'rect', w: 2, d: 2 })
    expect(shape).toBeDefined()
    const geometry = planGeometry(shape!, 0, 1, 1)
    expect(piece.box).toEqual(geometry.box)
    expect(piece.parts).toEqual(geometry.parts)
    expect(piece.axisAligned).toBe(geometry.axisAligned)
    expect(piece.band).toBe(planBand({ foot: { shape: 'rect', w: 2, d: 2 }, kinds: ['base'] }).band)
    // A base fills its square, which is the archive's own answer for a record
    // whose kinds are ["base"].
    expect(piece.band).toBe('area')
  })

  it('collides with a catalog placement in the same sweep', () => {
    // The candidates are structural, so a generated base and a `PlanPiece` go
    // into one array and `findConflicts` tests them against each other.
    const generated = generatedOverlapCandidate(idOf(1), placementOf({ x: 2, y: 2 }, { x: 0, z: 0 }))
    const shape = footprintShape({ shape: 'rect', w: 2, d: 2 })
    const overlapping = planGeometry(shape!, 0, 1, 1)
    const catalogue = {
      id: idOf(2),
      band: 'area' as const,
      // A catalog part is the level it stands at — there is no height for one
      // anywhere the app reads. `levelAt(0)` is the **ground-level** part of an
      // instance, which since row C6's real layout rule means its `base`: that
      // rule rests the base on the plan and lifts the `floor`, `wall` and
      // `column` one base thickness (`BASE_LIFT_MM`, 6 mm) above it. A base is
      // what a generated base competes with for a square anyway, and it is the
      // part that carries the instance's whole cell, so this is the pair worth
      // asserting rather than the easy one. The generated base's own interval
      // starts at the ground and is 6 mm tall, so the two share vertical space
      // and the sweep reaches the geometry.
      level: levelAt(0),
      box: overlapping.box,
      parts: overlapping.parts,
      axisAligned: overlapping.axisAligned,
      cover: 'exact' as const,
      bandSource: 'kinds' as const,
    }
    expect([...findConflicts([generated, catalogue]).keys()].sort()).toEqual([idOf(1), idOf(2)])

    const clear = planGeometry(shape!, 0, 4, 4)
    expect(
      findConflicts([generated, { ...catalogue, box: clear.box, parts: clear.parts }]).size,
    ).toBe(0)
  })

  it('does not conflict with a neighbour it merely touches', () => {
    const a = generatedOverlapCandidate(idOf(1), placementOf({ x: 2, y: 2 }, { x: 0, z: 0 }))
    const b = generatedOverlapCandidate(idOf(2), placementOf({ x: 2, y: 2 }, { x: 2, z: 0 }))
    expect(findConflicts([a, b]).size).toBe(0)
  })

  it('says in words that a non-tiling basis will not tile', () => {
    const piece = generatedPiece(idOf(1), placementOf({ x: 2, y: 2, SQUARE_BASIS: 'wyloch' }))
    expect(piece.tiles).toBe(false)
    expect(piece.label).toContain('31.75 mm to the square')
    expect(generatedPiece(idOf(2), placementOf({ x: 2, y: 2 })).label).not.toContain('mm to the square')
  })
})

/* -------------------------------------------------------- the archived fork */

describe('an archived resolution', () => {
  it('hands over the archive’s own file as a pinned SlotFill, and the cell', () => {
    const base = archiveBase()
    const placed = placeRecipe(recipeOf(SQUARE, { x: 2, y: 2 }), { kind: 'archived', base }, { x: 3, z: 4 })
    expect(placed.kind).toBe('archived')
    if (placed.kind !== 'archived') return
    // Row A1's decision D1: a fill names a **file**. So the arm hands over the
    // exact published STL rather than the design it is a variant of — the
    // `design` hop row V4 put here has no reader left.
    expect(placed.fill).toEqual({ tile: base.id, pinned: true })
    expect(TileId.safeParse(placed.fill.tile).success).toBe(true)
    expect(placed.at).toEqual({ x: 3, z: 4, rotation: 0 })
  })

  it('pins the fill, because the recipe named the lock the resolver matched on', () => {
    // Contract C-k: a `pinned` fill survives a lock re-solve and an `auto` one
    // does not. `LOCK` is a recipe parameter and part of `recipeKey`, and
    // `resolutionOf` keys on `recipeKey`, so the archived file carries the lock
    // the user dialled rather than one the sweep picked — which is what makes
    // `true` honest here. `false` would let a later lock change swap the file
    // out from under a parameter set that named it exactly.
    for (const lock of ['openlock', 'dragonlock']) {
      const placed = placeRecipe(
        recipeOf(SQUARE, { x: 2, y: 2, LOCK: lock }),
        { kind: 'archived', base: archiveBase() },
        { x: 0, z: 0 },
      )
      if (placed.kind !== 'archived') throw new Error('expected an archived placement')
      expect(placed.fill.pinned).toBe(true)
    }
  })

  it('names no template and no slot, because neither is this module’s to name', () => {
    // The load-bearing claim of row A9. A base is a *slot* of a family under
    // templates (§1.7), there is no family for one base alone, and B4's
    // `(role, form, build)` key cannot produce one — B1's `ROLES` has no `base`
    // and all 686 archive-answerable bases carry a role of what they sit under.
    // So the arm decides the file and stops; the caller, which holds the family
    // table, decides the family. An invented id here would be a placement that
    // draws nothing and prices nothing.
    const placed = placeRecipe(
      recipeOf(SQUARE, { x: 2, y: 2 }),
      { kind: 'archived', base: archiveBase() },
      { x: 0, z: 0 },
    )
    if (placed.kind !== 'archived') throw new Error('expected an archived placement')
    expect(Object.keys(placed).sort()).toEqual(['at', 'base', 'fill', 'kind', 'note', 'recipeId'])
  })

  it('refuses a record id that is not a catalog path, rather than casting it', () => {
    // `ArchiveBase.id` is typed `string`, so this parse is the only thing in the
    // chain that checks it — and a fill carrying a non-`tiles/…` id would be a
    // slot the catalog can never resolve, surfacing at render time as an empty
    // slot rather than here as a parse failure.
    expect(() =>
      placeRecipe(
        recipeOf(SQUARE, { x: 2, y: 2 }),
        { kind: 'archived', base: archiveBase({ id: 'plain#base+square.2x2.stl' }) },
        { x: 0, z: 0 },
      ),
    ).toThrow(/catalog path/)
  })

  it('never calls the archived file a render of these parameters', () => {
    const base = archiveBase()
    const placed = placeRecipe(recipeOf(SQUARE, { x: 2, y: 2 }), { kind: 'archived', base }, { x: 0, z: 0 })
    if (placed.kind !== 'archived') throw new Error('expected an archived placement')
    expect(placed.note).toContain(base.file)
    expect(placed.note).toContain('rather than a render of these parameters')
    // The measurement behind the sentence, so it cannot be softened into a hedge.
    expect(placed.note).toContain('matched neither its md5 nor its facet count')
    expect(placed.note).not.toContain('Generated')
  })

  it('folds an out-of-range rotation the way the store does, in both arms', () => {
    // One fold, before the fork, so the two arms cannot disagree about the angle
    // — which they could when each parsed its own record through a different
    // schema.
    const generated = placeRecipe(recipeOf(SQUARE, { x: 2, y: 2 }), ABSENT, { x: 0, z: 0, rotation: 450 })
    if (generated.kind !== 'generated') throw new Error('expected a generated placement')
    expect(generated.placement.rotation).toBe(90)

    const archived = placeRecipe(
      recipeOf(SQUARE, { x: 2, y: 2 }),
      { kind: 'archived', base: archiveBase() },
      { x: 0, z: 0, rotation: 450 },
    )
    if (archived.kind !== 'archived') throw new Error('expected an archived placement')
    expect(archived.at.rotation).toBe(90)
  })

  it('reports both files when the archive answers twice', () => {
    const files = ['plain#base+s2w+square+wall.2x2.openlock.stl', 'plain#base+s2w+wall_locks+square+wall.2x2.openlock.stl']
    const placed = placeRecipe(recipeOf(SQUARE, { x: 2, y: 2 }), { kind: 'ambiguous', files }, { x: 0, z: 0 })
    expect(placed.kind).toBe('generated')
    if (placed.kind !== 'generated') return
    expect(placed.ambiguous).toEqual(files)
  })

  it('refuses an entry point this panel does not offer', () => {
    expect(() =>
      placeRecipe({ v: 1, entry: 'bases-curved.scad', parameters: { x: 2 } }, ABSENT, { x: 0, z: 0 }),
    ).toThrow(/no footprint rule/)
  })
})
