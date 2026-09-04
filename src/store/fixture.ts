/**
 * A generated base for tests, built through the production path rather than
 * hand-written.
 *
 * Every generated fixture in this row goes through row S5's `placeRecipe` with
 * an `absent` resolution, which is what the drawer does when the archive
 * publishes no file for a parameter set. That matters more than convenience: a
 * hand-written record would let a test pass against an id this app cannot
 * actually produce — the id **is** the canonical recipe key, so getting it by
 * hand means restating `canonicalise` and `recipeKey`, and a fixture that
 * restated them would stop proving that the store accepts what the drawer emits.
 *
 * `src/builder/panels/fixture.ts` and `src/builder/canvas/fixture.ts` are the
 * precedent for a fixture module living in `src/` rather than beside a test: it
 * is imported by tests in three directories, and a `.test.ts` file cannot be
 * imported by another test file.
 *
 * **This module reaches the pinned parameter schemas** — `placeRecipe` needs
 * `recipeKey` — so nothing shipped may import it. It is test-only, and
 * `src/builder/panels/boundary.test.ts` lists it among the modules no eagerly
 * reachable file may reach, over every eager entry in the store, the canvas and
 * the panels.
 */
import { TileId } from '@/catalog'
import { canonicalise } from '@/generator/panel/recipe'
import type { RecipeValue } from '@/generator/panel/recipe'
import type { PanelEntry } from '@/generator/panel/schemas'
import type { PlaceAt } from '@/generator/placement/placement'
import { placeRecipe } from '@/generator/placement/placement'
import type { GeneratedPlacement } from '@/generator/placement/scene'

import type { TemplateInstance } from './schema'
import { SlotName, TemplateId } from './schema'
import type { NewTemplateInstance } from './workshopStore'

/**
 * The parameter set every fixture starts from: a 2×2 openlock square, on the
 * inch grid.
 *
 * S4's `OPENING_STATE` for the same shape, which is the tuple the archive's
 * square family is largest at — so a test that wanted the *archived* answer
 * would get one, and a test that asks for `absent` here is deliberately
 * pretending the archive is empty. That is legitimate: what the store and the
 * canvas do with a generated base does not depend on whether the archive also
 * publishes one, and `placeRecipe`'s archived arm produces an ordinary
 * `Placement` that never reaches any of this row's new code.
 */
export const A_RECIPE: Readonly<Record<string, RecipeValue>> = {
  x: 2,
  y: 2,
  LOCK: 'openlock',
  MAGNETS: 'flex_magnetic',
  MAGNET_HOLE: 6,
  PRIORITY: 'magnets',
  TOPLESS: 'false',
  SUPPORTS: 'true',
}

export interface GeneratedFixtureOptions extends PlaceAt {
  readonly entry?: PanelEntry
  readonly parameters?: Readonly<Record<string, RecipeValue>>
}

/**
 * One generated base, placed where you say.
 *
 * Throws if `placeRecipe` returns the archived arm, which it cannot here — the
 * resolution is passed in as `absent` — because a fixture that silently produced
 * a catalog `Placement` would make a test about generated bases pass with none
 * in it.
 */
export function aGeneratedBase(options: GeneratedFixtureOptions = { x: 0, z: 0 }): GeneratedPlacement {
  const entry = options.entry ?? 'bases-square.scad'
  const parameters = canonicalise(entry, options.parameters ?? A_RECIPE)
  const placed = placeRecipe({ v: 1, entry, parameters }, { kind: 'absent' }, options)
  if (placed.kind !== 'generated') throw new Error('the fixture resolved to an archived base')
  return placed.placement
}

/** Bytes that pass every one of row S5's four pack checks: a whole binary STL. */
export function aBinaryStl(triangles = 2): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * triangles)
  new DataView(bytes.buffer).setUint32(80, triangles, true)
  // Non-zero vertex data, so two fixtures of different sizes cannot share a
  // digest by both being all zeroes.
  for (let index = 84; index < bytes.length; index += 1) bytes[index] = (index * 31) % 251
  return bytes
}

/* --------------------------------------------------------- template instances */

/**
 * A real shipped template id, and its five real slot names.
 *
 * `s2w-wall-on-tile-corner-low-single-piece` is the first of the 40 in
 * `screens/assemblies/templates.ts`, and §2.1 of the plan names its slots as the
 * worked example — *"the requested floor plus two walls plus a column in the
 * corner, verbatim"*. Spelled out here rather than imported, for the reason
 * `schema.ts#TemplateId` gives at length: `@/store` must not reach a screen, and
 * a fixture that imported the table would make the store's tests depend on the
 * one module in the app that row B4 regenerates wholesale.
 *
 * It is checked against the real table in exactly one place — `corpus.test.ts`
 * asserts that all 40 ids parse as {@link TemplateId} — so a fixture that drifted
 * from the shipped shape would be caught there rather than by 40 duplicated
 * imports.
 */
export const A_TEMPLATE = TemplateId.parse('s2w-wall-on-tile-corner-low-single-piece')

/** The five slots of {@link A_TEMPLATE}, in declared order. */
export const A_TEMPLATE_SLOTS: readonly SlotName[] = [
  'column',
  'right wall',
  'left wall',
  'floor',
  'base',
].map((name) => SlotName.parse(name))

/** Two files, spelled as real catalog paths so `TileId`'s pattern is exercised. */
export const A_TILE = TileId.parse('tiles/dungeon_stone/floor/2x2/openlock/dungeon_stone%2x2.openlock.stl')
export const ANOTHER_TILE = TileId.parse('tiles/cave/thick_wall/wall/corner/openlock/cave%corner.IL.openlock.stl')

/**
 * One template instance, ready to hand to `placeTemplate`.
 *
 * Defaults to **one filled slot of five**, not to a complete fill map, and that
 * is the fixture making contract **C-g** the easy path: §3.2 places a template
 * with slots still open, so a fixture that arrived complete would let a test
 * pass against a shape the app mostly does not produce. Pass `fills: {}` for the
 * fully-open case and {@link aFullFillMap} for the closed one.
 */
export function aTemplateInstance(over: Partial<NewTemplateInstance> = {}): NewTemplateInstance {
  return {
    template: A_TEMPLATE,
    x: 0,
    z: 0,
    rotation: 0,
    fills: { [A_TEMPLATE_SLOTS[0] ?? SlotName.parse('column')]: { tile: A_TILE, pinned: false } },
    ...over,
  }
}

/** Every slot of {@link A_TEMPLATE} filled `auto` with the same file. */
export function aFullFillMap(tile = A_TILE): TemplateInstance['fills'] {
  const fills: Record<string, { tile: TileId; pinned: boolean }> = {}
  for (const slot of A_TEMPLATE_SLOTS) fills[slot] = { tile, pinned: false }
  return fills
}
