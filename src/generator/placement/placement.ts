/**
 * Turning a recipe into something on the grid — and the fork that decides which
 * of the two placement models it enters.
 *
 * This is the module `GeneratorDrawer`'s `onPlace` seam feeds. It is on the
 * drawer's side of S4's lazy boundary, deliberately: it needs `recipeKey`, which
 * needs the pinned parameter schemas, and those are 25 KB of JSON that must not
 * follow a generated base into the bill panel or the canvas. Everything the
 * light half of this row needs is in `scene.ts`, `geometry.ts` and `bill.ts`,
 * none of which reach this file. `boundary.test.ts` walks both directions.
 *
 * ## Two answers, because the archive gives three
 *
 * S4's resolver answers `archived`, `ambiguous` or `absent`, and S4's
 * instruction for the first is explicit: *place the archived md5, with an
 * archive bill line.* An archived base **is** a catalog record, so the answer
 * has always been "let the catalog path have it" rather than "mint a generated
 * record". Measured over `public/catalog/catalog.json`,
 * `buildBaseResolver`'s census reports `keys: 682, ambiguous: 27` — so that is
 * the cheapest correct answer for **682 of the archive's 709 resolvable keys**,
 * and it is the one that keeps the OpenSCAD engine out of the page entirely.
 *
 * `ambiguous` and `absent` are the generated cases. They are not distinguished
 * *here* beyond the note, because the distinction is a fact about the catalog
 * build rather than about the placement, and persisting it would go stale on the
 * next import — the same reason the store keeps no resolved variant.
 *
 * ## Row A9: what the archived arm hands over now, and what it no longer decides
 *
 * Until templates it handed over a store `Placement` — one `DesignId` on a cell,
 * mintable here because a placement *was* one identity plus a position. Row A1
 * deleted that model. A placement is now a `TemplateInstance`: a `TemplateId`
 * plus a map of per-slot fills, and **a base is a slot of a template rather than
 * a placement of its own** (§1.7: "a template declares its base as an explicit
 * slot"). So the arm cannot mint the whole record any more, because the one
 * field it would have to invent — the template id — is data the B wave generates
 * and this module must not guess.
 *
 * What it hands over instead is exactly the part it is entitled to decide: **the
 * file, as a {@link SlotFill}, and the position.** That is the currency A1 chose
 * for every fill in the app (decision D1, §2.1: a fill names a file rather than
 * a design, so "a re-import cannot silently change what it contains"), and it is
 * the whole of what an archive resolution actually establishes. Which family the
 * fill lands in, and under which slot name, is the caller's — it holds the
 * family table and this module has no business reaching a screen.
 *
 * Two other answers were tested against the evidence before this one:
 *
 *   - **Into `WorkshopState.generated`, as a `GeneratedPlacement`.** Refused on
 *     three counts. `GeneratedPlacement` has no field a published file could go
 *     in, and `scene.ts` says why it has none — the record holds a recipe and a
 *     position and deliberately nowhere to put bytes or a digest. `bill.ts`'s
 *     honesty argument is built on the archived arm *never reaching it*: a
 *     generated bill line may not name a published file, because the vendored
 *     geometry does not reproduce the archive (below), so routing archived bases
 *     there would collapse the two mirror-image sentences in `provenance.ts`
 *     into one conditional. And it is not cosmetic — the drawer passes
 *     `mesh: null` for an archived resolution, because `usePreview` sets
 *     `status: 'archived'` and never `'ready'`, so every one of those 682 keys
 *     would land as an *unrendered* base: a `warn` bill row and a **refused
 *     download** (`pack.ts`'s `GeneratedMeshMissingError`) for a file sitting in
 *     R2 with a sprite and a name.
 *   - **Re-derive `archived` from the persisted recipe instead of storing the
 *     file.** Attractive, because the store's rule is that anything derivable
 *     from the catalog stays out of `localStorage`, and the resolver is cheap
 *     (measured: `buildMs` 15 ms over 8,702 records). Refused because the two
 *     readers that need the answer cannot ask: `boundary.test.ts` asserts
 *     `bill.ts` and `pack.ts` reach neither `panel/resolve` nor `panel/sweep`,
 *     and the reason is weight — the resolver drags the 25 KB of pinned
 *     parameter schemas, and the engine behind it emits a 298 kB worker chunk.
 *     A1 already answered the same question the same way one field over: a fill
 *     names a file precisely so that no reader has to re-solve it.
 *
 * The third candidate, naming a bare-base family here, is the arm's one genuine
 * dependency rather than a preference; see {@link placeRecipe}.
 *
 * ## The fill is `pinned`, and that is a claim about the recipe
 *
 * `pinned: true`, not `false`. A `pinned` fill is one the lock re-solve must
 * never touch (`schema.ts#SlotFill`), and the archived file's connector set is
 * not a default anybody fell into: `LOCK` is a parameter of the recipe, it is
 * part of `recipeKey`, and `resolutionOf` keys on `recipeKey` — so the file the
 * archive answered with carries the lock the user dialled, by construction. A
 * key two published files both claim is *removed* rather than resolved to either
 * (27 of 709), so there is no arm in which the sweep silently picked the
 * connector for them.
 *
 * That answers the objection row V4 left here in prose — that storing the
 * resolved file would freeze "whatever the *sweep* matched rather than a
 * preference anybody stated". It would have been right about a file chosen by
 * ranking; it is not right about a file chosen by an exact key match on a
 * parameter the user set. And A1 overruled the general form of it anyway.
 *
 * ## What an archived placement may not be called
 *
 * **A hit is not a byte claim, and the note says so in those terms.** S4
 * searched the archived 1×1's whole connector space — 144 renders through
 * `bases-square.scad`, 40 more through the legacy `bases.scad` — and matched
 * neither its md5 nor its facet count: 760 published ASCII facets against 296
 * and 1,428. The archive's bases are ASCII STL from an older revision of this
 * geometry. So the file placed under an `archived` resolution is Devon's
 * published mesh, which is the one that has been printed, and it is *not* a
 * render of these parameters. The two are different files that the same
 * parameters name, and {@link ARCHIVE_PROVENANCE} is the sentence that keeps
 * them apart wherever this placement is described.
 */
import { DEFAULT_ROTATION_STEP_DEG } from '@/catalog'
import type { SlotFill } from '@/store'
import { SlotFill as SlotFillSchema, normalizeRotation } from '@/store'

import type { BaseRecipe } from '../panel/recipe'
import { canonicalise, recipeId, recipeKey } from '../panel/recipe'
import type { ArchiveBase, Resolution } from '../panel/resolve'
import { isPanelEntry } from '../panel/schemas'

import { ARCHIVE_PROVENANCE } from './provenance'
import type { GeneratedPlacement } from './scene'
import { GeneratedPlacement as GeneratedPlacementSchema, generatedBaseId } from './scene'

/** Where on the grid, in the store's own units. */
export interface PlaceAt {
  readonly x: number
  readonly z: number
  /** Folded into `[0, 360)`; defaults to 0. */
  readonly rotation?: number
}

export class GeneratedPlacementError extends Error {
  override readonly name = 'GeneratedPlacementError'
}

/**
 * The rotation step for a generated base — 90°, and it is not a guess.
 *
 * Every footprint this panel can produce is a `rect` on the inch grid (see
 * `panel/footprint.ts`), and `DEFAULT_ROTATION_STEP_DEG` is what the catalog
 * gives a rect. The 893 corpus tiles that need a finer step are all arcs, hexes
 * and diagonals, none of which are offered here — S4's `schemas.ts` says why:
 * *"offering a shape whose footprint the builder cannot place would put a base
 * on the grid that nothing snaps to."*
 */
export const GENERATED_ROTATION_STEP_DEG = DEFAULT_ROTATION_STEP_DEG

/**
 * An archived resolution: the archive's own **file**, ready to fill a slot, plus
 * where it goes and what to say about it.
 *
 * Not a placement record, and the name is kept only because
 * `placement/index.ts` exports it. See the module note: under templates a base
 * is a slot of a family rather than a placement of its own, so the record this
 * used to mint is no longer this module's to mint. The family table is B4's
 * output and lives in `screens/assemblies/templates.ts`, which a module under
 * `src/generator` has no business importing — the same layering
 * `store/schema.ts` states for {@link SlotFill}'s own key type: *"whether an id
 * names a template the build ships is a question for the reader that has the
 * table."*
 *
 * The caller assembles the instance, which is one line and needs nothing this
 * type does not carry:
 *
 * ```ts
 * placeTemplate({ template: BARE_BASE, ...placed.at, fills: { [BASE_SLOT]: placed.fill } })
 * ```
 *
 * `BARE_BASE` and `BASE_SLOT` come from the family table; see
 * {@link placeRecipe} for why they are not constants here.
 */
export interface ArchivedPlacement {
  readonly kind: 'archived'
  /**
   * The published file and the bit that protects it — `pinned: true`.
   *
   * A {@link SlotFill}, so it is the same value a solver or the slot editor
   * would write, and it goes into a fill map unchanged. Parsed rather than cast,
   * which is what checks that the archive's own id really is a `tiles/…` path:
   * `ArchiveBase.id` is typed `string`, so nothing upstream of here would have
   * caught a record id that was not one.
   */
  readonly fill: SlotFill
  /**
   * Where it goes, in the store's own units, with the rotation already folded
   * into `[0, 360)` the way `normalizeRotation` folds it.
   *
   * Separate from {@link ArchivedPlacement.fill} because the two have different
   * owners: the file is what the resolution established, and the cell is what
   * the drawer's `placeAt` chose. Spreadable straight into a `TemplateInstance`.
   */
  readonly at: { readonly x: number; readonly z: number; readonly rotation: number }
  readonly base: ArchiveBase
  /** S4's 8-character handle for the recipe that named this file. Not an identity. */
  readonly recipeId: string
  /** {@link ARCHIVE_PROVENANCE}, prefixed with the file it names. */
  readonly note: string
}

/** An absent or ambiguous resolution: a generated base, in its own model. */
export interface GeneratedBasePlacement {
  readonly kind: 'generated'
  readonly placement: GeneratedPlacement
  readonly recipeId: string
  /** The published files that both claim these parameters, when there are two. */
  readonly ambiguous: readonly string[]
}

export type RecipePlacement = ArchivedPlacement | GeneratedBasePlacement

/**
 * Place a recipe, given what the archive had to say about it.
 *
 * The resolution is passed in rather than looked up, because `buildBaseResolver`
 * lives behind the drawer's lazy boundary and the drawer already holds the
 * answer — it is on screen, in the resolution strip. **S4's `onPlace` hands over
 * only the recipe today**, which is the one change this row needs from that file
 * and cannot make itself; see the report. A caller that has a recipe and no
 * resolution has to resolve it, not guess, because guessing `absent` would
 * render a mesh for a base Devon already publishes and guessing `archived` has
 * no file to point at.
 *
 * Total on a well-formed recipe. Throws only when the recipe names an entry
 * point this panel does not offer, which is a caller bug: the footprint rule and
 * the shape table are both keyed on those five.
 *
 * ## The one thing this row could not close: which family a bare base belongs to
 *
 * The archived arm returns a fill and a cell and **not** a `TemplateId`, because
 * there is no family for "one base, alone" and no row in the series generates
 * one. That is a gap in `docs/templates-plan.md` — §7 lists `src/generator` as
 * untouched and §9 says the plan "does not touch the base generator", and both
 * are wrong about this arm — so it is written down here rather than guessed at.
 *
 * The obvious candidate — a family B4 emits for `role: 'base'`, with size
 * parametric — **does not exist and cannot.** B1's `ROLES` is closed at eight
 * values (wall, floor, riser, insert, column, stair, roof, decor) and `base` is
 * not one of them: `base` is a value of `layer`, a different axis, and B4's
 * family key is `(role, form, build)` (§3.1). Read off B1's *emitted* tags for
 * the 686 records the resolver can answer with, all 686 `layer: 'base'`, the
 * population spreads across **eight** family keys and none is a base:
 *
 * | key | records |
 * | --- | ---: |
 * | `role\|floor form\|straight` | 271 |
 * | `role\|floor form\|curve` | 161 |
 * | `role\|riser form\|straight` | 128 |
 * | `role\|riser form\|curve` | 48 |
 * | `role\|wall form\|corner build\|s2w` | 39 |
 * | `role\|wall form\|straight build\|s2w` | 28 |
 * | `role\|wall form\|internal_corner build\|s2w` | 8 |
 * | `role\|floor form\|curve build\|separate wall` | 3 |
 *
 * So B4's key does not separate a base from the toppers that share its role, and
 * a family keyed on it cannot be *the* base family however many of the 52 land.
 *
 * **The fix needs no new axis, and it is measured.** `layer === 'base'` and the
 * tag `shape|base` are exactly coextensive over the corpus — **1,963 records
 * both ways, zero exceptions in either direction** — so a base slot predicates
 * on `require: [{ tag: 'shape|base' }]` with nothing added to the tag
 * vocabulary, and B4 owes a one-slot bare-base family on that predicate. A base
 * also keeps the role of whatever it sits under (over all 1,963: `role|wall`
 * 1,117, `role|floor` 661, `role|riser` 176, `role|stair` 9), so `(role, form)`
 * plus `shape|base` still distinguishes a base for a wall run from one for a
 * floor if the palette wants that split.
 *
 * Naming a fill here and leaving the family to the caller is what keeps this
 * module honest about the gap: it decides the file, which it knows, and not the
 * family, which nothing in the tree can yet answer. Filling the `base` slot of a
 * `role|floor` family instead would compile and would mislabel a base as a floor
 * in the palette, which is worse than a compile error.
 */
export function placeRecipe(recipe: BaseRecipe, resolution: Resolution, at: PlaceAt): RecipePlacement {
  if (!isPanelEntry(recipe.entry)) {
    throw new GeneratedPlacementError(
      `${recipe.entry} is not one of the shapes this panel offers, so it has no footprint rule to place by`,
    )
  }

  // Canonical before anything reads it: two parameter sets that differ only in
  // which defaults they spell out are one recipe, and this is where S4 decided
  // that. Placing the caller's raw set would give two ids to one base.
  const canonical: BaseRecipe = { v: 1, entry: recipe.entry, parameters: canonicalise(recipe.entry, recipe.parameters) }
  const key = recipeKey(canonical)
  const id = recipeId(key)
  const rotation = normalizeRotation(at.rotation ?? 0)

  if (resolution.kind === 'archived') {
    const { base } = resolution
    return {
      kind: 'archived',
      // The archived base's **file**, pinned. Row A1's decision D1 made a fill
      // name a file rather than a design, which retires the `design` hop row V4
      // put here: `ArchiveBase.design` now has no reader. `pinned` because the
      // recipe named the lock and the resolver matched on it — see the module
      // note for why that is a fact rather than a preference.
      fill: SlotFillSchema.parse({ tile: base.id, pinned: true }),
      at: { x: at.x, z: at.z, rotation },
      base,
      recipeId: id,
      note: `Placed from the generator. ${base.file} is ${ARCHIVE_PROVENANCE}`,
    }
  }

  return {
    kind: 'generated',
    placement: GeneratedPlacementSchema.parse({
      base: generatedBaseId(key),
      recipe: canonical,
      x: at.x,
      z: at.z,
      rotation,
    }),
    recipeId: id,
    ambiguous: resolution.kind === 'ambiguous' ? resolution.files : [],
  }
}
