/**
 * What a generated base *is* in a build — its identity, and the record a scene
 * holds for it.
 *
 * A generated base is not a catalog file. It has no `design`, no aggregate, no
 * manifest ordinal, and no `TileId`, because a `TileId` is a `tiles/…` catalog
 * path and row X5 tightened that regex precisely so a string that is not one
 * cannot enter the store. Minting `tiles/@generated/…` would hand the store a
 * path that resolves to nothing and reintroduce exactly the class of value X5
 * removed. So this is a **third identity, and it is its own thing** — the same
 * decision row A1 made when it branded `AggregateAddress` apart from
 * `ManifestOrdinal` rather than converting between them.
 *
 * ## The identity is the recipe key, and only the recipe key
 *
 * {@link generatedBaseId} is `gen:` + the canonical recipe key from
 * `@/generator/panel/recipe`. Two consequences, both load-bearing:
 *
 *   - **Two ids are equal iff the two recipes are equal**, because
 *     `recipeKey` *is* S4's definition of recipe equality — a parameter set that
 *     spells out a default and one that leaves it implicit canonicalise to one
 *     key. Nothing is hashed on this path. `recipeId` is S4's 8-character
 *     handle, and its own docblock says nothing may branch on it; a digest as
 *     the identity would let two different bases collide onto one silently, so
 *     the handle is used for filenames and bill captions and never for equality.
 *   - **A `GeneratedBaseId` can never be a `TileId`.** `gen:` fails
 *     `TileId`'s `^tiles\/…` pattern, so the two id spaces are provably
 *     disjoint rather than conventionally distinct. That is what makes
 *     {@link generatedPlacementKey} safe beside `billView.ts`'s `placementKey`:
 *     row G4's one refusal is an identical twin and its docblock rests on
 *     `tileId|x|z|rotation` being unique, so a generated base must not be able
 *     to produce a string in that space. It cannot, and `placement.test.ts`
 *     asserts it by parsing every generated id through `TileId` and expecting a
 *     failure.
 *
 * ## The mesh is not here, and the schema is why
 *
 * S4: *"persist the recipe, never the mesh"* — ~200 bytes of JSON against
 * 0.5–2.4 MB of STL, and it survives an engine upgrade as a cache miss rather
 * than a broken reference. {@link GeneratedPlacement} has no field a mesh, a
 * digest or a byte count could go in, and `placement.test.ts` asserts that by
 * round-tripping a record that carries one and checking the field is gone. The
 * bytes live for the life of the panel session and enter the download pack from
 * memory; see `pack.ts`.
 *
 * ## Why the schema is here and the factory is not
 *
 * This module imports `zod` and types, and nothing else — `boundary.test.ts`
 * asserts an empty file closure. Deriving an id needs `recipeKey`, which needs
 * `panel/schemas.ts` and its 25 KB of pinned parameter JSON, so
 * {@link generatedBaseId} takes the key **as a string**, exactly as S4's
 * `recipeId(key)` does, and `placement.ts` is the module that computes one.
 *
 * That keeps this module, `provenance.ts`, `geometry.ts` and `bill.ts` — the
 * canvas's and the bill's whole path — clear of the schemas, which was measured
 * rather than assumed: see {@link recipeHandle} for the 20,168 B the one
 * convenient import cost, and `boundary.test.ts` for the assertion that holds
 * the line.
 */
import { z } from 'zod'

import type { PanelEntry } from '../panel/schemas'

import type { PlacementId } from '@/store'

/**
 * The five shapes, with the two facts about each that the light half of this
 * row needs — and cannot import.
 *
 * `panel/schemas.ts` holds `PANEL_ENTRIES` and `ENTRY_LABELS`, and it also
 * eagerly imports five parameter exports totalling 25 KB of JSON. Reading two
 * short strings out of it would move that JSON from the drawer's lazy chunk into
 * whichever chunk the bill panel and the canvas live in — paid by every builder
 * visitor rather than by the ones who open the generator, which is the exact
 * regression S4's barrel note is about. So the table is restated, and
 * `placement.test.ts` asserts its keys equal `PANEL_ENTRIES` and its labels
 * equal `ENTRY_LABELS`: a drift fails the suite rather than showing a stale
 * chip.
 *
 * `kinds` is **measured off the archive**, not chosen. Every plain base the
 * sweep produced for each of these entry points carries exactly these buckets —
 * `plain#base+square` is `["base"]`, `plain#base+s2w+square+wall` is
 * `["base","wall"]`, `plain#riser+low+square` is `["base","riser"]` — and
 * `corpus.test.ts` re-reads them from `catalog.json`. They matter because
 * `planBand` reads `kinds`: all five land in the `area` band, which is correct
 * and is the answer the archive's own records give.
 */
export const GENERATED_SHAPES = {
  'bases-square.scad': { label: 'Square', kinds: ['base'] },
  'bases-square-wall.scad': { label: 'Wall', kinds: ['base', 'wall'] },
  'bases-square-corner.scad': { label: 'Corner', kinds: ['base'] },
  'bases-square-internal_corner.scad': { label: 'Internal corner', kinds: ['base'] },
  'risers_square.scad': { label: 'Riser', kinds: ['base', 'riser'] },
} as const satisfies Readonly<Record<PanelEntry, { readonly label: string; readonly kinds: readonly string[] }>>

/** The entry points a generated placement may name. Keys of {@link GENERATED_SHAPES}. */
export const GENERATED_ENTRIES = Object.keys(GENERATED_SHAPES) as readonly PanelEntry[]

/**
 * The prefix that makes a generated id provably not a catalog path.
 *
 * `:` cannot appear in a `tiles/…` id and `gen:` does not start `tiles/`, so
 * either half of that is enough on its own. Both are asserted.
 */
export const GENERATED_ID_PREFIX = 'gen:'

/**
 * A generated base's identity: `gen:` followed by its canonical recipe key.
 *
 * Long on purpose — a key is `v1 bases-square.scad HEIGHT=6 LOCK="openlock" …`,
 * around 200 characters — because the alternative is a digest, and a digest can
 * collide. It is a map key and an entry-name input, never a caption; the caption
 * uses S4's `recipeId`.
 */
export const GeneratedBaseId = z
  .string()
  .startsWith(GENERATED_ID_PREFIX, 'a generated base id starts `gen:`')
  .min(GENERATED_ID_PREFIX.length + 1, 'a generated base id carries a recipe key')
  .brand<'GeneratedBaseId'>()
export type GeneratedBaseId = z.infer<typeof GeneratedBaseId>

/** Brand a canonical recipe key. See the module note on why this is not a digest. */
export function generatedBaseId(recipeKey: string): GeneratedBaseId {
  return GeneratedBaseId.parse(GENERATED_ID_PREFIX + recipeKey)
}

/** Whether a string is in the generated id space. Total; never throws. */
export function isGeneratedBaseId(value: string): boolean {
  return GeneratedBaseId.safeParse(value).success
}

/** The recipe key back out of an id — the inverse, and the only one there is. */
export function recipeKeyOf(id: GeneratedBaseId): string {
  return id.slice(GENERATED_ID_PREFIX.length)
}

/**
 * S4's 8-character handle for a recipe, computed here — and the measurement
 * that decided it should be.
 *
 * This is `recipeId` from `panel/recipe.ts`, restated. Ten lines of FNV-1a is
 * not a thing anyone wants two copies of, and the first draft of this row
 * imported it. **Then it was built.** `recipeId` sits beside `canonicalise` in a
 * module that value-imports `panel/schemas.ts` and its five pinned parameter
 * exports, so a bill panel that reached for the handle pulled 25 KB of JSON with
 * it: wiring the bill took the entry chunk from **644,915 B to 665,083 B
 * (+20,168 B raw, +4,615 B gzipped)** and dropped `GeneratorDrawer`'s lazy chunk
 * from 45.68 kB to 29.07 kB — the schemas moved out of the chunk S4 put them in
 * and into the one every visitor downloads. That is the same 664,608 B
 * regression S4's own `boundary.test.ts` exists to prevent, reproduced by this
 * row from the other side.
 *
 * So the arithmetic is restated and the *equivalence* is asserted instead:
 * `placement.test.ts` checks `recipeHandle(generatedBaseId(key)) ===
 * recipeId(key)` over every shape and a spread of parameter sets, so a drift
 * fails the suite rather than showing two handles for one base. The same trade
 * this module already makes for {@link GENERATED_SHAPES}, and for the same
 * reason. `recipeId` has no dependency on a schema; moving it one file over
 * would let this be an import, and that is reported to S4.
 *
 * Nothing branches on it — S4's docblock is explicit — so it is a caption, a
 * filename and a bill row's readable handle, and never an identity.
 */
export function recipeHandle(id: GeneratedBaseId): string {
  const key = recipeKeyOf(id)
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ (code + index), 0x85ebca6b) >>> 0
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 8)
}

/**
 * One `-D` value, as a build document stores it.
 *
 * Mirrors S3's `ParameterAssignment` — `number | string | boolean | readonly
 * number[]` — and is written out here rather than imported because importing it
 * as a *value* schema is not possible (it is a type) and this is the shape the
 * persisted document has to be validated against. The vector arm is `readonly`
 * for the same reason S3's is: a `-D` value is data the caller does not own, and
 * a mutable inference here would make a canonical parameter set from
 * `canonicalise` unassignable to this schema's own output type.
 */
export const RecipeValue = z.union([
  z.number().finite(),
  z.string(),
  z.boolean(),
  z.array(z.number().finite()).readonly(),
])

/**
 * The recipe, as {@link GeneratedPlacement} holds it.
 *
 * `v: 1` and a bare `.scad` filename, matching `BaseRecipe`. The entry is
 * constrained to the five this panel offers — a persisted recipe naming
 * `bases-curved.scad` would have no footprint rule and nothing to draw, so it is
 * a parse failure rather than a piece that silently vanishes from the plan.
 */
export const GeneratedRecipe = z.object({
  v: z.literal(1),
  entry: z.enum(GENERATED_ENTRIES as [PanelEntry, ...PanelEntry[]]),
  parameters: z.record(z.string(), RecipeValue),
})
export type GeneratedRecipe = z.infer<typeof GeneratedRecipe>

/**
 * One generated base on the plan-view grid.
 *
 * Deliberately the same four positional fields as the store's `Placement` —
 * `x`, `z`, `rotation` in the same units and the same `[0, 360)` range — so that
 * the canvas, the move operation and the overlap sweep read one geometry
 * vocabulary rather than two. What replaces `tileId` is {@link base}, and the
 * recipe rides alongside it because the id is only *derivable* from the recipe,
 * not the other way round in any cheap sense: `recipeKeyOf` returns the key, and
 * re-parsing a key back into a parameter set would be a second parser for the
 * one thing S4 made canonical.
 *
 * `-0` is folded to `+0` on both coordinates, for the store's own reason:
 * snapping produces `-0`, it survives in memory but not through
 * `JSON.stringify`, and a scene holding one would not compare equal to itself
 * after an export and re-import.
 */
export const GeneratedPlacement = z.object({
  base: GeneratedBaseId,
  recipe: GeneratedRecipe,
  x: z
    .number()
    .finite()
    .transform((value) => value + 0),
  z: z
    .number()
    .finite()
    .transform((value) => value + 0),
  rotation: z.number().finite().nonnegative().lt(360),
})
export type GeneratedPlacement = z.infer<typeof GeneratedPlacement>

/**
 * The scene's generated half, keyed the way the store keys its placements.
 *
 * A **second map beside `placements`**, not a widening of it. `Placement.tileId`
 * is a `TileId` and every reader of that map — the share codec, the migration
 * that runs `TileId.safeParse` over each entry, `billView.ts`'s `placementKey`,
 * `buildBillOfTiles` — is entitled to keep assuming it. A union type in that
 * slot would make all of them conditional. Sharing the `PlacementId` space
 * costs nothing and buys one id namespace across the whole scene, which is what
 * lets {@link generatedPlacementKey} and `findConflicts` mix the two.
 *
 * `src/store/**` is not this row's to edit, so this is the shape the store row
 * adds and not a field that exists yet. Nothing here is persisted today.
 */
export type GeneratedScene = Readonly<Record<PlacementId, GeneratedPlacement>>

/**
 * A generated placement's identity for pairing a scene map with a derived list —
 * the counterpart of `billView.ts`'s `placementKey`, in a disjoint space.
 *
 * Same four-field tuple, same reason (a scene is a set of distinct cells, and
 * reference identity is the thing that stops being true when a caller maps over
 * the list), and no possible collision with the catalog one: the first field is
 * a `GeneratedBaseId`, which starts `gen:` and can therefore never be a
 * `TileId`. Row G4's move refusal — the identical twin — behaves identically
 * here for identical reasons.
 */
export function generatedPlacementKey(placement: GeneratedPlacement): string {
  return `${placement.base}|${String(placement.x)}|${String(placement.z)}|${String(placement.rotation)}`
}
