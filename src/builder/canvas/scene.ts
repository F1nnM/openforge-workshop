/**
 * The scene: the store's placements plus the catalog, turned into things to draw.
 *
 * **The store is the single source of truth.** This module holds no state; it is
 * a pure projection of `WorkshopState.placements`, recomputed when that map
 * changes. Nothing here caches a placement, and there is no parallel scene graph
 * to fall out of step — which is what makes "reload the page and the room is
 * still there" true by construction rather than by a synchronisation routine.
 *
 * ## Row A4a: one placement is now N drawable parts
 *
 * Row **A1** replaced the placement with a {@link TemplateInstance} — a family, a
 * rotation, and a fill per named slot — so the unit this module projects has
 * changed arity. A {@link PlanPiece} is therefore a **container**: it carries the
 * instance, and a {@link PlanPiecePart} per filled slot, each with its own
 * record, footprint, box, band, style and label. The fields that used to sit on
 * the piece and describe one primitive — `record`, `shape`, `extent`, `angle`,
 * `band`, `axisAligned`, `style`, `caveat` — have all moved down to the part,
 * because for a template *"the wall"* and *"the floor"* have different answers to
 * every one of them.
 *
 * They are **moved, not duplicated up**, which is contract **C-h** applied to
 * this module: a `piece.band` that returned the band of the first part would
 * describe a fifth of a five-part placement and compile everywhere. The one
 * primitive field the piece keeps is `polygons` — the union of its parts'
 * outlines, renamed from `parts` precisely so that every reader of the old field
 * is a compile error rather than an array of the wrong things.
 *
 * Four failure modes are first-class outputs rather than exceptions, because all
 * four are reachable from a *valid* persisted scene:
 *
 *   - **`unknown`** — a fill names a file this catalog build does not hold. A
 *     scene saved last month or a share link can name one: a file leaves the
 *     corpus, or a re-import renames it. `src/assembly/resolve.ts` treats this the
 *     same way: a note and an empty part list, never a throw. One dead file must
 *     not take a room down, and since A1 it must not take the other four parts of
 *     its own instance down either — the instance still draws, one part short.
 *   - **`undrawable`** — the file is in the catalog but its footprint is `none`,
 *     the one case of seven with nothing to draw. 742 tiles left `none` in row W3
 *     and 249 more became placeable in W4, so the population is a moving target
 *     by design. It is listed rather than dropped so the count can be surfaced
 *     instead of the room silently losing pieces.
 *   - **`unfilled`** — the instance has **no filled slots at all**, so there is
 *     nothing to draw and no part to hang a label on. §3.2 places a template with
 *     slots still open (contract **C-g**) and the *fully* open case is the limit
 *     of that: it is a legitimate state, it must not be dropped from the scene,
 *     and it must not be a `PlanPiece` with an empty `parts` array and a
 *     degenerate box. It is reported so the surface can draw a marker over the
 *     cell and the panel can offer a Remove.
 *   - **`conflicts`** — see `overlap.ts`.
 *
 * ## Paint order retires with the single-band piece
 *
 * The old rule was *areas first, then edges, then insertion order*, and it was a
 * statement about a 2D painter: a wall drawn over a floor tile reads as standing
 * on it rather than as a hole in it. A template instance has no band — it has a
 * floor in `area` and two walls in `edge` — so there is nothing left to sort it
 * by, and the pieces list is in insertion order.
 *
 * Nothing is lost, and row **R4** is why: it deleted the painter, and *"in 3D
 * there is no paint order to agree with, because a pick is a raycast and the
 * nearest hit wins by geometry"*. What did depend on the order is {@link pieceAt}
 * — which resolves a pick for `three/edits.ts` — and multi-part instances make
 * *that* case better rather than worse: where a wall crossing a floor used to be
 * two pieces needing a tie-break, one template holding both is one piece and
 * there is no ambiguity to break. {@link PlanScene.generated} still sorts by
 * band, because a generated base really does have exactly one.
 *
 * ## Two populations, one scene — row X9
 *
 * A generated base is not a catalog file and has no `CatalogRecord`, so it
 * cannot be a {@link PlanPiece}: that type requires an instance and a fill map,
 * and a `GeneratedPlacement` has neither — `src/store/schema.ts` sharpened that
 * for A1, the two populations no longer even have the same *arity*. So the store
 * keeps two maps and this module produces two lists —
 * {@link PlanScene.pieces} and {@link PlanScene.generated} — with
 * {@link GeneratedPlanPiece} reusing the field names the two share so the branch
 * that draws it is a **second `map`, not a second pipeline**. Row S5's
 * `geometry.ts` does all the resolving; this module places its output beside the
 * catalog's.
 *
 * Three things are shared rather than duplicated, and each of them would be a
 * defect if it were not:
 *
 *   - **One conflict set.** Both populations enter `findConflicts` in the *same
 *     array*, so a generated base overlapping a catalogued floor is a conflict
 *     on both pieces. Two sweeps would report neither. Since A1 the array holds
 *     one entry **per part**, and {@link sceneSubjects} is the one function that
 *     builds it.
 *   - **One bounds box.** `fitBoxes` and the viewport read it, so a room whose
 *     only content is generated still has somewhere to look.
 *   - **One `PlacementId` space**, which is the store's decision and S5's proof:
 *     `gen:` fails `TileId`'s pattern, so the two id spaces are disjoint and a
 *     single id can name a piece in either list without ambiguity. That is what
 *     lets {@link pieceAt} and `move.ts` take the union.
 */
import type { CatalogRecord, TileId } from '@/catalog'
import { DEFAULT_ROTATION_STEP_DEG } from '@/catalog'
import type { GeneratedPiece } from '@/generator/placement/geometry'
import { generatedPiece } from '@/generator/placement/geometry'
import { GENERATED_SHAPES } from '@/generator/placement/scene'
import type { PlacementId, SlotFill, SlotName, TemplateId, TemplateInstance, WorkshopState } from '@/store'

import type { PlanCatalog, PlanStyle, ResolvedSlotPart } from './catalog'
import type {
  Extent,
  PlanBox,
  PlanCaveat,
  PlanGeometry,
  PlanPart,
  PlanPoint,
  PlanShape,
  SlotLayout,
} from './geometry'
import {
  boxCentre,
  boxShape,
  describeCell,
  describeFootprint,
  footprintShape,
  partsContain,
  placementCaveat,
  planGeometry,
  slotGeometry,
  unionBox,
} from './geometry'
import type { BandSource, ConflictKind, OverlapCandidate, OverlapSubject, PlanBand } from './overlap'
import { findConflicts, levelAt, planBand } from './overlap'

/**
 * One drawable part of one template instance.
 *
 * Everything a {@link PlanPiece} used to be, for one slot: which slot, what
 * filled it, the record that file names, where the recipe puts it, and the
 * geometry, band, style and label that follow.
 *
 * **This is the shape row A4b renders against.** Per part it carries the record
 * (so `record.blob` is the mesh), the slot name, the offset from the instance
 * origin, the rotation and the elevation — the last four all on `layout`, whose
 * docblock in `geometry.ts` states which units they are in and which of them is
 * row B2's to fill in.
 */
export interface PlanPiecePart {
  readonly slot: SlotName
  /** The fill as the store holds it: the file, and whether the user chose it. */
  readonly fill: SlotFill
  readonly record: CatalogRecord
  /** Offset inside the template, own yaw, and elevation in millimetres. */
  readonly layout: SlotLayout
  /** The footprint resolved: extent, intrinsic angle, convex parts and the outline path. */
  readonly shape: PlanShape
  /** The un-rotated footprint extent — what the part *is*, before it was turned. */
  readonly extent: Extent
  /** The axis-aligned box it occupies, anchored at its own world corner. */
  readonly box: PlanBox
  /**
   * The angle actually drawn: `instance.rotation + layout.rotation + shape.angle`.
   *
   * The recipe's yaw and the footprint's intrinsic angle are both folded in, so
   * this differs from the instance's rotation on the 121 `diag` tiles, on every
   * part whose slot rule turns it, and nowhere else.
   */
  readonly angle: number
  /** The part as convex polygons, in world units. Equal to the box's corners for an axis-aligned rect. */
  readonly polygons: readonly PlanPart[]
  readonly band: PlanBand
  /**
   * Whether {@link band} was measured from the footprint or inferred from tags.
   *
   * `overlap.ts#BandVerdict`'s second half, written here beside the band it
   * qualifies. A conflict against an inferred band is never refused, so this
   * has to survive the trip from `planBand` to `subjectsConflict`.
   */
  readonly bandSource: BandSource
  /** Whether the drawn box is the shape. Read by the corner-junction exemption. */
  readonly axisAligned: boolean
  readonly style: PlanStyle
  /** Set when the outline rests on an unmeasured band rule. See `placementCaveat`. */
  readonly caveat: PlanCaveat | null
  /** This part's accessible name — slot, material, name, size, angle, position, caveat. */
  readonly label: string
}

/** One drawable placement: a template instance and its filled slots. */
export interface PlanPiece {
  /**
   * Which of the two populations this is — see the module note.
   *
   * A discriminant rather than a `record === undefined` check, so
   * {@link ScenePiece} narrows in a `switch` and the exhaustiveness is the
   * compiler's rather than a reader's.
   */
  readonly kind: 'catalog'
  readonly id: PlacementId
  readonly placement: TemplateInstance
  /**
   * The instance's drawable parts, one per filled slot that resolved and drew.
   *
   * **Never empty.** An instance with no drawable part is not a piece at all —
   * it lands in {@link PlanScene.unfilled}, {@link PlanScene.unknown} or
   * {@link PlanScene.undrawable} — so a consumer may read `parts[0]` without a
   * guard, and `box` is a real box rather than a degenerate one.
   */
  readonly parts: readonly PlanPiecePart[]
  /**
   * Every convex polygon of every part, in world units.
   *
   * **Renamed from `parts`**, which used to hold exactly this. The rename is the
   * point: `parts` now means the slots, and a reader that was handed polygons and
   * is now handed slot records must not type-check. Hit testing and the SAT read
   * this; per-part collision reads `part.polygons`.
   */
  readonly polygons: readonly PlanPart[]
  /** The axis-aligned box over every part, which is what the instance occupies. */
  readonly box: PlanBox
  readonly conflict: boolean
  /** The accessible name — the family, the parts, the position, and any caveat. */
  readonly label: string
}

/**
 * One drawable generated base.
 *
 * Row S5's {@link GeneratedPiece} plus the two fields a *scene* adds to a piece
 * — the conflict flag and the `caveat` slot the renderer branches on — with
 * `parts` renamed to `polygons` to match {@link PlanPiece}. Nothing else is added
 * and nothing else is renamed: the field names are `PlanPiece`'s deliberately, so
 * one renderer draws both populations. That was `PlanPieces.tsx` until row **R4**
 * deleted it, and it is `three/instances.ts` now.
 *
 * It keeps `shape`, `extent`, `angle`, `band`, `axisAligned` and `style` at the
 * top level where {@link PlanPiece} moved them down to a part, and that is not an
 * inconsistency — it is the arity difference stated in the type. A generated base
 * is **one** primitive: it has one footprint, one angle and one band, so there is
 * nothing to move them down to and no slot for them to be indexed by.
 *
 * `caveat` is `null` and it is the type rather than a value that says so. A
 * caveat is *"the outline rests on an unmeasured band rule"*, which applies to
 * the 462 corpus arcs whose band came from a rule with no accepted mesh fit
 * behind it. A generated base's outline is `x × y` squares of arithmetic over
 * the parameters the user set — there is no measurement to be missing — so the
 * unmeasured hatch must never appear on one, and a `null` literal is how that
 * is stated once instead of trusted at three call sites.
 */
export interface GeneratedPlanPiece {
  readonly kind: 'generated'
  readonly id: PlacementId
  readonly placement: GeneratedPiece['placement']
  /** The footprint in both units, plus height and basis in millimetres. */
  readonly foot: GeneratedPiece['foot']
  readonly shape: PlanShape
  readonly extent: Extent
  readonly box: PlanBox
  readonly angle: number
  /** See {@link PlanPiece.polygons} — row S5's `parts`, under the shared name. */
  readonly polygons: readonly PlanPart[]
  readonly band: PlanBand
  /**
   * Whether {@link band} was measured from the footprint or inferred from tags.
   *
   * `overlap.ts#BandVerdict`'s second half, written here beside the band it
   * qualifies. A conflict against an inferred band is never refused, so this
   * has to survive the trip from `planBand` to `subjectsConflict`.
   */
  readonly bandSource: BandSource
  readonly axisAligned: boolean
  readonly style: PlanStyle
  readonly conflict: boolean
  /** Always `null`. See the interface note. */
  readonly caveat: null
  /** False when `SQUARE_BASIS` is not the grid's, so the piece will not tile. */
  readonly tiles: boolean
  /**
   * `Generated square base` — the short name, in the panel's own words.
   *
   * The counterpart of `record.name`, and computed the way row S5's bill row
   * computes its own `name` so a piece on the plan and its line in the bill are
   * called the same thing. `label` is the long accessible name; this is what a
   * live region says on a grab or a removal, where the long one would be a
   * paragraph.
   */
  readonly name: string
  readonly label: string
}

/**
 * Either population, for the code that does not care which.
 *
 * Hit-testing, the move operation, the cursor's live region and the erase
 * gesture are all about *a piece on the plan*, and none of them reads a
 * `CatalogRecord`. The things that do — the 3D room's `record.blob`, the bill's
 * `record.name`, `rotationStepFor(record)` — take {@link PlanScene.pieces},
 * walk its parts, and are unaffected by this union existing.
 *
 * The fields the union guarantees are exactly `kind`, `id`, `box`, `polygons`,
 * `conflict`, `label` and a `placement` carrying `x`, `z` and `rotation`.
 * Everything else needs the `kind` branch.
 */
export type ScenePiece = PlanPiece | GeneratedPlanPiece

/**
 * A placement, or one slot of one, that could not be drawn — and why.
 *
 * ## `design` is deleted rather than repointed
 *
 * Row V4's field named *"the item the placement names — the only identity there
 * is"*, and since row A1 there is no such thing: an instance names a family and
 * up to five files. Contract **C-h**: the field is deleted so that every reader
 * becomes a compile error, rather than repointed at `template` and left
 * describing a fraction of a multi-part placement.
 *
 * What replaces it is the whole address. `slot` and `tile` are `null` together on
 * an `unfilled` instance, where the omission is about the instance and there is
 * no slot to blame; both are set on an `unknown` or `undrawable` part. The panel
 * that renders these offers a Remove button, and `id` is what identifies the row
 * beside it — one row per omission, so a template with two retired fills reports
 * twice and says which two.
 */
export interface PlanOmission {
  readonly id: PlacementId
  /** The family the instance names. Present in every case; a `TemplateId` always is. */
  readonly template: TemplateId
  /** The slot this is about, or `null` when the whole instance is. */
  readonly slot: SlotName | null
  /** The file that slot names, or `null` when the omission is not about a file. */
  readonly tile: TileId | null
  readonly reason: string
}

export interface PlanScene {
  /** Every instance with at least one drawable part, in insertion order. */
  readonly pieces: readonly PlanPiece[]
  /**
   * The generated bases, in band order, as their own list.
   *
   * Separate from {@link pieces} because a `PlanPiece` carries a template
   * instance and a fill map and a generated base has neither — see the module
   * note. Empty for every caller that passes no generated map, which is every
   * caller outside the builder.
   */
  readonly generated: readonly GeneratedPlanPiece[]
  /**
   * Over **both** lists and every part: a generated base and a wall can conflict.
   *
   * A map of id to {@link ConflictKind} rather than a set, because since the
   * refusal split the two kinds are drawn differently and only one of them
   * blocks an edit. `Map` keeps `.has` and `.size` working for the readers that
   * only ever asked *whether*.
   */
  readonly conflicts: ReadonlyMap<PlacementId, ConflictKind>
  /** One per fill naming a file this build does not hold. */
  readonly unknown: readonly PlanOmission[]
  /** One per fill whose file has a `none` footprint. */
  readonly undrawable: readonly PlanOmission[]
  /** One per instance with no filled slots at all. See the module note. */
  readonly unfilled: readonly PlanOmission[]
  /** The bounding box of everything drawn, generated bases included, or `null`. */
  readonly bounds: PlanBox | null
}

/**
 * The accessible name of one part. Read out when the cursor lands on it.
 *
 * The shape is described per footprint case rather than as its bounding box, and
 * an unmeasured band is *named* here rather than left to the drawing: a hatch
 * over a curve is invisible to a screen reader, and the whole point of carrying
 * `bandBasis` through to the builder is that the user can tell a measured
 * outline from a defaulted one.
 *
 * The **slot** leads, because since row A1 that is what distinguishes this
 * readout from the four beside it: *"right wall, Cut stone wall 2, …"* is what a
 * user stepping through a template needs, and the record name alone would read
 * the same on the left wall.
 */
function describePart(part: Omit<PlanPiecePart, 'label'>): string {
  const angle = part.angle === 0 ? '' : `, turned ${String(Math.round(part.angle * 100) / 100)} degrees`
  const shape = describeFootprint(part.record.foot, part.extent)
  const note = part.caveat === null ? '' : ', unmeasured outline'
  return (
    `${part.slot}: ${part.record.name}, ${part.style.label}, ${shape}${angle}, ` +
    `at ${describeCell(part.box.x, part.box.z)}${note}`
  )
}

/**
 * A {@link TemplateId} as a readout says it.
 *
 * A **presentation of the id, not a name**: the family's real name lives in
 * `src/screens/assemblies/templates.ts`, which `catalog.ts` sets out at length
 * why the canvas must not import. So the slug is de-hyphenated and capitalised
 * rather than looked up — which is a faithful rendering of the only identity the
 * canvas holds, and never an invented one. A panel that holds the table can say
 * it better; nothing here can.
 */
export function describeTemplate(template: TemplateId): string {
  const words = template.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The accessible name of one instance.
 *
 * The family, how many parts are drawn, which slots they are, and where the
 * instance sits. Deliberately **not** the concatenation of the parts' own labels
 * — five of those is a paragraph, and a live region that reads a paragraph on
 * every cursor step is unusable. The parts carry their own labels for the cursor
 * that lands on one.
 *
 * The caveat is summarised rather than repeated: *"1 outline unmeasured"* says
 * the thing the hatch is for without naming which band rule on which of five
 * curves.
 */
function describeInstance(
  instance: TemplateInstance,
  parts: readonly Omit<PlanPiecePart, 'label'>[],
  box: PlanBox,
): string {
  const angle =
    instance.rotation === 0 ? '' : `, turned ${String(Math.round(instance.rotation * 100) / 100)} degrees`
  const count = parts.length
  const slots = parts.map((part) => part.slot).join(', ')
  const unmeasured = parts.filter((part) => part.caveat !== null).length
  const note = unmeasured === 0 ? '' : `, ${String(unmeasured)} outline${unmeasured === 1 ? '' : 's'} unmeasured`
  return (
    `${describeTemplate(instance.template)}, ${String(count)} part${count === 1 ? '' : 's'} — ${slots}` +
    `${angle}, at ${describeCell(box.x, box.z)}${note}`
  )
}

const BAND_ORDER: Readonly<Record<PlanBand, number>> = { area: 0, edge: 1 }

/** One part, resolved from its slot layout and the instance's origin and angle. */
function placePart(
  slot: ResolvedSlotPart,
  shape: PlanShape,
  geometry: PlanGeometry,
  style: (record: CatalogRecord) => PlanStyle,
): PlanPiecePart {
  // One call, two fields: the band and where it came from are written together
  // here so nothing downstream can hold one without the other.
  const band = planBand(slot.record)
  const bare: Omit<PlanPiecePart, 'label'> = {
    slot: slot.slot,
    fill: slot.fill,
    record: slot.record,
    layout: slot.layout,
    shape,
    extent: shape.extent,
    box: geometry.box,
    angle: geometry.angle,
    polygons: geometry.parts,
    band: band.band,
    bandSource: band.source,
    axisAligned: geometry.axisAligned,
    style: style(slot.record),
    caveat: placementCaveat(slot.record) ?? null,
  }
  return { ...bare, label: describePart(bare) }
}

/** An omission plus which of the scene's three lists it belongs in. */
interface PlanOmissionOf {
  readonly list: 'unknown' | 'undrawable' | 'unfilled'
  readonly omission: PlanOmission
}

/**
 * The shape one slot is drawn as: its fill's footprint, or the box the rule
 * narrowed it to.
 *
 * {@link SlotLayout.residual} is present on the `floor` slot of an `s2w` recipe
 * and on nothing else, and it is a smaller `rect` than the fill's own footprint —
 * the part of the cell the separately printed walls do not stand on. Substituting
 * the shape here, rather than adjusting a box downstream, is what makes the
 * narrowing reach every consumer through one value: the box, the polygons,
 * `overlap.ts`, `place.ts#tileMatrix`'s mesh centring, `instances.ts`'s footprint
 * disagreement, and {@link reanchorPiece}, which re-projects from
 * `PlanPiecePart.shape` and so carries it for free.
 *
 * Takes the already-derived shape rather than the footprint, so the *drawability*
 * question — a `none` fill has no shape and earns its own sentence — is still
 * settled before the layout is consulted, which is the ordering the loop below
 * depends on and comments.
 */
function drawnShape(shape: PlanShape, layout: SlotLayout): PlanShape {
  return layout.residual === undefined ? shape : boxShape(layout.residual)
}

/**
 * Resolve one instance into a piece, or say why it is not one.
 *
 * Returns the piece **and** its omissions, because the two are one walk over the
 * fill map: a five-slot template with one retired file and one `none` footprint
 * is a three-part piece *and* two omissions, and computing them separately would
 * walk `catalog.parts` twice and could disagree.
 */
function resolveInstance(
  id: PlacementId,
  instance: TemplateInstance,
  catalog: PlanCatalog,
  style: (record: CatalogRecord) => PlanStyle,
): { readonly piece: PlanPiece | null; readonly omissions: readonly PlanOmissionOf[] } {
  const slots = catalog.parts(instance)
  const omissions: PlanOmissionOf[] = []
  const parts: PlanPiecePart[] = []
  const origin: PlanPoint = [instance.x, instance.z]

  for (const slot of slots) {
    if (slot.kind === 'stranded') {
      omissions.push({
        list: 'unknown',
        omission: {
          id,
          template: instance.template,
          slot: slot.slot,
          tile: slot.fill.tile,
          reason: `${slot.fill.tile} is not in this catalog build; it may have been retired.`,
        },
      })
      continue
    }
    const shape = footprintShape(slot.record.foot)
    if (shape === undefined) {
      omissions.push({
        list: 'undrawable',
        omission: {
          id,
          template: instance.template,
          slot: slot.slot,
          tile: slot.fill.tile,
          reason: `${slot.record.name} has a ${slot.record.foot.shape} footprint, which cannot be drawn on the plan.`,
        },
      })
      continue
    }
    // A drawable footprint the *recipe* has nowhere to put — row D8's
    // `UnplaceableSlotPart`. Checked after the footprint so that a `none` fill
    // keeps its own sentence, which names the footprint rather than the rule.
    // The reason is `slotDoubtSentence`'s, so the plan and C3's slot editor
    // describe one fault the same way.
    if (slot.kind === 'unplaceable') {
      omissions.push({
        list: 'undrawable',
        omission: {
          id,
          template: instance.template,
          slot: slot.slot,
          tile: slot.fill.tile,
          reason: `${slot.reason} It is not drawn.`,
        },
      })
      continue
    }
    const drawn = drawnShape(shape, slot.layout)
    parts.push(placePart(slot, drawn, slotGeometry(drawn, slot.layout, origin, instance.rotation), style))
  }

  const box = unionBox(parts.map((part) => part.box))
  if (box === undefined) {
    // No part drew. When the fill map was empty this is the `unfilled` state and
    // nothing else has reported the instance; when every fill failed, the
    // per-slot omissions above already name it and a third row would double
    // count. Both are decided on `slots`, not on `omissions`, so the two cases
    // cannot overlap.
    if (slots.length === 0) {
      omissions.push({
        list: 'unfilled',
        omission: {
          id,
          template: instance.template,
          slot: null,
          tile: null,
          reason: `${describeTemplate(instance.template)} has no filled slots, so it has nothing to draw yet.`,
        },
      })
    }
    return { piece: null, omissions }
  }

  return {
    piece: {
      kind: 'catalog',
      id,
      placement: instance,
      parts,
      polygons: parts.flatMap((part) => part.polygons),
      box,
      conflict: false,
      label: describeInstance(instance, parts, box),
    },
    omissions,
  }
}

/**
 * Build the scene.
 *
 * `style` is passed in rather than resolved here so the memoised resolver
 * outlives a single projection — see `createStyleResolver`.
 *
 * `generated` is optional and defaults to empty, which keeps every caller
 * outside the builder — the landing hero, row G2's 3D room, the fixtures —
 * unchanged: none of them has a generated map to pass and none of them would
 * know what to do with the second list.
 *
 * A generated base needs no style resolver of its own. Row S5's `generatedStyle`
 * asks `src/materials` for `texture|plain`, which is the tag all 1,235 archived
 * plain bases carry, so a generated base and an archived plain one come out the
 * same family — measured in S5's `corpus.test.ts` rather than assumed. Passing
 * this scene's memoised resolver would not help: it is keyed on a
 * `CatalogRecord`, and there isn't one.
 */
export function buildPlanScene(
  placements: WorkshopState['placements'],
  catalog: PlanCatalog,
  style: (record: CatalogRecord) => PlanStyle,
  generated: WorkshopState['generated'] = {},
): PlanScene {
  const drawable: PlanPiece[] = []
  const unknown: PlanOmission[] = []
  const undrawable: PlanOmission[] = []
  const unfilled: PlanOmission[] = []

  for (const [key, instance] of Object.entries(placements)) {
    const { piece, omissions } = resolveInstance(key as PlacementId, instance, catalog, style)
    if (piece !== null) drawable.push(piece)
    for (const entry of omissions) {
      if (entry.list === 'unknown') unknown.push(entry.omission)
      else if (entry.list === 'undrawable') undrawable.push(entry.omission)
      else unfilled.push(entry.omission)
    }
  }

  const drawableGenerated: GeneratedPlanPiece[] = []
  for (const [key, placement] of Object.entries(generated)) {
    const id = key as PlacementId
    const { parts, ...resolved } = generatedPiece(id, placement)
    drawableGenerated.push({
      ...resolved,
      polygons: parts,
      kind: 'generated',
      conflict: false,
      caveat: null,
      name: `Generated ${GENERATED_SHAPES[placement.recipe.entry].label.toLowerCase()} base`,
    })
  }

  // **One sweep over one array.** Row S5 built `generatedOverlapCandidate` for
  // exactly this, and both populations reduce to `OverlapCandidate` with no
  // conversion and no second implementation, so the separating-axis pass tests a
  // generated base against a template's wall. Two sweeps would find neither of
  // the cross-population conflicts, which are the ones a user actually hits: a
  // base is the thing you put *under* something.
  const conflicts = findConflicts([...drawable.flatMap(subjectsOf), ...drawableGenerated.map(subjectOf)])

  const pieces = drawable.map((piece) => (conflicts.has(piece.id) ? { ...piece, conflict: true } : piece))
  const generatedPieces = drawableGenerated
    .map((piece) => (conflicts.has(piece.id) ? { ...piece, conflict: true } : piece))
    .sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band])

  return {
    pieces,
    generated: generatedPieces,
    conflicts,
    unknown,
    undrawable,
    unfilled,
    bounds: unionBox([...pieces, ...generatedPieces].map((piece) => piece.box)) ?? null,
  }
}

/* ------------------------------------------------------------------ subjects */

/**
 * One part of one instance, as the overlap test sees it.
 *
 * **Every candidate of an instance carries the instance's id**, so the conflict
 * sweep's answer stays a set of {@link PlacementId} and every consumer of
 * `scene.conflicts` is unchanged. `findConflicts` never tests two candidates
 * with the same id against each other — a piece cannot collide with itself, and
 * for a template that is load bearing rather than tidiness: a recipe's `base`
 * and `floor` slots are stacked *by design*, in the same band, on the same
 * square, so without the rule every instance in every room would report a
 * conflict with itself.
 */
function subjectsOf(piece: PlanPiece): readonly OverlapCandidate[] {
  return piece.parts.map((part) => ({
    id: piece.id,
    band: part.band,
    // `levelAt` and not an interval: the underside is the slot rule's
    // `elevationMm`, and there is no thickness to add because no height for a
    // catalog record exists anywhere the app reads — `overlap.ts` counts the
    // 14.8% of records a dev-tool sidecar covers and the zero that reach
    // `catalog.json`. A part is the level it stands at.
    level: levelAt(part.layout.elevationMm),
    box: part.box,
    parts: part.polygons,
    axisAligned: part.axisAligned,
    // Off the part's own `PlanShape`, not re-derived from `foot.shape`: the
    // shape is what produced `polygons`, so its accuracy flag is the one that
    // describes them.
    cover: part.shape.cover,
    bandSource: part.bandSource,
  }))
}

/**
 * A generated base as the overlap test sees it — one primitive, one candidate.
 *
 * **The one piece in either population with a real height.** `foot.heightMm` is
 * arithmetic over the recipe's own parameters (`HEIGHT` for a base, `z`
 * half-squares for a riser), so a 50.8 mm riser is a 50.8 mm interval here and
 * not a level — which is the whole reason `PlanLevel` carries a thickness at all.
 * Its underside is the ground: a generated base is placed on the plan directly
 * and belongs to no template, so there is no slot rule to lift it.
 */
function subjectOf(piece: GeneratedPlanPiece): OverlapCandidate {
  return {
    id: piece.id,
    band: piece.band,
    level: { elevationMm: 0, heightMm: piece.foot.heightMm },
    box: piece.box,
    parts: piece.polygons,
    axisAligned: piece.axisAligned,
    cover: piece.shape.cover,
    bandSource: piece.bandSource,
  }
}

/**
 * Every drawn part of every piece in the scene, as overlap candidates.
 *
 * The one place the scene is flattened for collision, shared by the conflict
 * sweep, the ghost's prediction (`ghost.ts`), the move's preview (`move.ts`) and
 * the vacancy search (`vacancy.ts`). Before row A1 those four each iterated
 * `scene.pieces` and read `piece.band`/`piece.box`/`piece.parts` straight off a
 * piece, which is exactly the single-primitive assumption A1 broke; there is one
 * flattening now and it cannot disagree with itself.
 */
export function sceneSubjects(scene: PlanScene): readonly OverlapCandidate[] {
  return [...scene.pieces.flatMap(subjectsOf), ...scene.generated.map(subjectOf)]
}

/** Every part of a piece as an overlap subject. What a drop is tested against. */
export function pieceSubjects(piece: ScenePiece): readonly OverlapSubject[] {
  return piece.kind === 'catalog' ? subjectsOf(piece) : [subjectOf(piece)]
}

/**
 * The piece as it would be with its origin at `anchor`.
 *
 * A pure re-projection: for a template it re-runs `slotGeometry` for every part
 * against the new origin, and for a generated base it re-runs `planGeometry` on
 * its one primitive. Everything it needs is already on the piece — the parts
 * carry their shapes and layouts — so no catalog lookup and no style resolution
 * happens, which is what lets `move.ts` call it on every pointer event.
 *
 * The result is *the same shape* as the piece that went in, which is the whole
 * point: `move.ts` publishes it as `MovePreview.moved` and a renderer draws the
 * preview with the code it already draws the scene with. `conflict` is left as
 * the caller found it — the move resolves that itself.
 */
export function reanchorPiece(piece: ScenePiece, anchor: PlanPoint): ScenePiece {
  if (piece.kind === 'generated') {
    const geometry = planGeometry(piece.shape, piece.placement.rotation, anchor[0], anchor[1])
    return {
      ...piece,
      box: geometry.box,
      polygons: geometry.parts,
      angle: geometry.angle,
      axisAligned: geometry.axisAligned,
    }
  }
  const parts = piece.parts.map((part) => {
    const geometry = slotGeometry(part.shape, part.layout, anchor, piece.placement.rotation)
    const bare: Omit<PlanPiecePart, 'label'> = {
      ...part,
      box: geometry.box,
      angle: geometry.angle,
      polygons: geometry.parts,
      axisAligned: geometry.axisAligned,
    }
    return { ...bare, label: describePart(bare) }
  })
  // Non-empty by `PlanPiece.parts`'s own invariant, so the union is always a box.
  const box = unionBox(parts.map((part) => part.box)) ?? piece.box
  return {
    ...piece,
    parts,
    polygons: parts.flatMap((part) => part.polygons),
    box,
    label: describeInstance(piece.placement, parts, box),
  }
}

/* ------------------------------------------------------------------ readouts */

/**
 * The short name of any piece — the family, or S5's bill wording.
 *
 * One function so the erase gesture, the move readouts and the cursor's live
 * region say the same thing about a generated base as the bill panel does. The
 * catalog arm was `record.name` until row A1 and there is no single record now;
 * it is {@link describeTemplate} of the family, which is the only name the
 * *placement* has ever had. A caller that wants a file's name wants a part, and
 * `piece.parts[i].record.name` is it.
 */
export function pieceName(piece: ScenePiece): string {
  return piece.kind === 'catalog' ? describeTemplate(piece.placement.template) : piece.name
}

/**
 * A full turn, in degrees. The ceiling {@link pieceRotationStep} clamps to.
 *
 * A step of 360 means *this instance cannot be turned* — every press of ⟳ lands
 * it back where it was — which is the honest answer for a template whose parts'
 * steps have no common multiple below a full circle, and is strictly better than
 * proposing an angle one of its parts cannot mate at.
 */
const FULL_TURN_DEG = 360

/**
 * The scale that makes every corpus rotation step an integer.
 *
 * 4, because 11.25° = 45/4 is the finest step in the corpus (20 arc tiles carry
 * it) and every other observed value — 22.5, 45, 60, 90, 120, 240, 300 — is a
 * multiple of 0.25 as well. Integers are what {@link gcd} needs to be exact;
 * doing the same arithmetic on 11.25 directly would accumulate residue and
 * return a step that is a hair off a divisor of 360.
 */
const STEP_SCALE = 4

/** Euclid, on non-negative integers. */
function gcd(a: number, b: number): number {
  let left = a
  let right = b
  while (right !== 0) {
    const rest = left % right
    left = right
    right = rest
  }
  return left
}

/**
 * The rotation step for any piece.
 *
 * ## For a template instance it is the **least common multiple** of its parts'
 *
 * A template is *"placed and rotated as one unit"* (§1) and its parts do not
 * agree about what a legal angle is: `rotStep` is present on 1,548 tiles and
 * **893 of them carry a value that is not a multiple of 90** (45, 22.5, 11.25,
 * 60, 120, 240, 300), and on all 1,199 `arc` tiles the step *equals the sweep*.
 * So the step for the whole instance has to be an angle **every** part can reach,
 * and that is exactly their least common multiple — 90 for a 45° floor beside a
 * 90° wall, and 180 for a 60° hex wall beside a 90° one.
 *
 * Neither the maximum nor the minimum will do, and both are the obvious wrong
 * answer: the maximum of {60, 90} is 90, which the 60° part cannot mate at, and
 * the minimum is 60, which the 90° part cannot. A 90° global constant would make
 * 645 arc tiles impossible to assemble while looking as though they had been
 * placed, which is the mistake `geometry.ts#rotationStepFor` exists to avoid one
 * level down — this is the same argument over a *set* of steps instead of one.
 *
 * Computed on integers scaled by {@link STEP_SCALE} so it is exact, clamped to
 * {@link FULL_TURN_DEG}, and it falls back to the coarsest step for a catalog
 * whose `rotStep` is not a multiple of a quarter degree — a population that does
 * not exist today and that would otherwise reach the UI as a `NaN` step.
 *
 * ## For a generated base it is {@link DEFAULT_ROTATION_STEP_DEG}
 *
 * Which is what row S5's `GENERATED_ROTATION_STEP_DEG` is *defined* as, and the
 * reason it is spelled out here rather than imported is measured: that constant
 * lives in `placement.ts`, which value-imports `panel/recipe.ts` and its 25 KB of
 * pinned parameter JSON, so importing a number from it would put the schemas in
 * the canvas's chunk — the same regression S4's and S5's boundary tests both
 * exist to prevent. `generatedScene.test.ts` asserts the two constants are equal,
 * so the restatement cannot drift.
 */
export function pieceRotationStep(piece: ScenePiece): number {
  if (piece.kind === 'generated') return DEFAULT_ROTATION_STEP_DEG
  const steps = piece.parts.map((part) => part.record.rotStep ?? DEFAULT_ROTATION_STEP_DEG)
  const scaled = steps.map((step) => step * STEP_SCALE)
  if (!scaled.every((step) => Number.isInteger(step) && step > 0)) return Math.max(...steps)
  let multiple = scaled[0] as number
  for (const step of scaled) multiple = (multiple / gcd(multiple, step)) * step
  const combined = multiple / STEP_SCALE
  return combined > FULL_TURN_DEG ? FULL_TURN_DEG : combined
}

/**
 * Everything drawn, in the order it is drawn, both populations.
 *
 * Generated bases first, so they sit **under** the catalog's pieces. That is not
 * a tie-break, it is what a base is: the thing you put under a topper. All five
 * shapes the panel offers land in the `area` band (S5 measured that off the
 * archive's own records rather than choosing it), so without this they would
 * interleave with floors by insertion order and a base placed after a floor
 * would be drawn over the floor standing on it.
 *
 * `PlanPieces.tsx` rendered the two lists as two `<g>`s in this order, so the
 * DOM's paint order and this function's were the same statement — which is what
 * makes {@link pieceAt}'s "last wins" agree with what the user can see. Row
 * **R4** deleted that renderer and the property survives it differently: in 3D
 * there is no paint order to agree with, because a pick is a raycast and the
 * nearest hit wins by geometry. This function is what `three/edits.ts` resolves a
 * pick *through*, so it is now the only statement of the order rather than one of
 * two that had to match.
 */
export function scenePaintOrder(scene: PlanScene): readonly ScenePiece[] {
  return scene.generated.length === 0 ? scene.pieces : [...scene.generated, ...scene.pieces]
}

/**
 * The topmost piece under a point, or `undefined`.
 *
 * Last in paint order wins, which is the piece drawn on top — so clicking where
 * a floor covers a generated base takes the floor. Tested against the union of a
 * piece's parts, so a click anywhere on a template — its floor, either wall, its
 * column — picks the instance; a wall crossing the floor *of its own template*
 * is no longer two pieces needing a tie-break, which is the ambiguity the old
 * band sort existed to resolve.
 */
export function pieceAt(scene: PlanScene, point: PlanPoint): ScenePiece | undefined {
  const order = scenePaintOrder(scene)
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const piece = order[i] as ScenePiece
    if (partsContain(piece.polygons, point)) return piece
  }
  return undefined
}

/**
 * The part of a piece under a point, or `undefined`.
 *
 * What {@link pieceAt} answers one level down, and the second half of a pick
 * since row A1: the surface resolves *which instance* to grab or erase, and a
 * slot editor resolves *which slot* the user clicked in. A generated base has no
 * parts, so it never answers — the caller already has the whole of it.
 */
export function partAt(piece: ScenePiece, point: PlanPoint): PlanPiecePart | undefined {
  if (piece.kind === 'generated') return undefined
  for (let i = piece.parts.length - 1; i >= 0; i -= 1) {
    const part = piece.parts[i] as PlanPiecePart
    if (partsContain(part.polygons, point)) return part
  }
  return undefined
}

/**
 * Scene order for cursor navigation: reading order down the plan, then across.
 *
 * Not paint order, and not insertion order. A keyboard user stepping through the
 * room with `[` and `]` needs a spatial sequence — the tile *next to* this one —
 * and insertion order is the order things happened to be placed in, which after
 * ten minutes of editing is no order at all.
 */
export function navigationOrder(scene: PlanScene): readonly ScenePiece[] {
  return [...scenePaintOrder(scene)].sort((a, b) => {
    const ac = boxCentre(a.box)
    const bc = boxCentre(b.box)
    return ac.z - bc.z || ac.x - bc.x
  })
}
