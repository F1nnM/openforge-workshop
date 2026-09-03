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
 * archive bill line.* Taken literally that is not a new placement model at all —
 * an archived base **is** a catalog record, so it becomes an ordinary
 * `Placement` — addressed by its `design` since row V4 — and rides the store,
 * the canvas, `resolvePlacement`, the bill and the download pack that already
 * exist, with nothing added anywhere.
 * That is why {@link placeRecipe} returns a union rather than always minting a
 * generated record: the cheapest correct answer for 682 of the archive's 709
 * resolvable keys is the one that needs no new machinery.
 *
 * `ambiguous` and `absent` are the generated cases. They are not distinguished
 * *here* beyond the note, because the distinction is a fact about the catalog
 * build rather than about the placement, and persisting it would go stale on the
 * next import — the same reason the store keeps no resolved variant.
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
import type { Placement } from '@/store'
import { Placement as PlacementSchema, normalizeRotation } from '@/store'

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

/** An archived resolution: an ordinary catalog placement, plus what to say about it. */
export interface ArchivedPlacement {
  readonly kind: 'archived'
  /** A plain `Placement`. The store, the canvas and the bill need no notice of it. */
  readonly placement: Placement
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
      // The archived base's **item**, since row V4: a `Placement` names a
      // design, and `ArchiveBase.design` is the field S4's resolver carries for
      // exactly this call. Storing the resolved file instead would be the one
      // place in the app where a preference is frozen into a placement — and it
      // would be frozen to whatever the *sweep* matched rather than to a
      // preference anybody stated.
      placement: PlacementSchema.parse({ design: base.design, x: at.x, z: at.z, rotation }),
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
