/**
 * One control axis, as a row of chips — the palette's and the slot editor's.
 *
 * ## Why this is a module rather than two components
 *
 * The filters are a property of a placed instance, so the same three axes are
 * operated in two places: the **palette row**, where they arm what the next
 * click will place, and the **slot editor**, where they change what an instance
 * already on the plan is. Two spellings of one chip would drift — in the
 * `aria-pressed` rule, in the abbreviation, in the `any` position's meaning —
 * and each of those three has already been got wrong once here (see
 * {@link sizeChipLabel} and `families.ts#positionIn`). One component is the
 * point of the lift rather than a side effect of it.
 *
 * ## The pressed rule is `positionIn`'s and nothing else's
 *
 * A chip is pressed when it is **the most specific position of its own axis that
 * the current tag list satisfies**. That single rule replaced two that were each
 * wrong on one axis; `families.ts#positionIn` carries the measurement. The `any`
 * position — `tags: []` — is therefore pressed exactly when no other position of
 * this axis matches, which is what makes it a real position rather than the
 * absence of one.
 *
 * ## What the caller decides
 *
 * The axis's **vocabulary** and what a press means. This component holds no
 * `PositionAxis`, no `TemplateFamily` and no store write: the palette binds a
 * family and an axis into {@link AxisControlProps.onChoose} and the editor binds
 * an instance and a re-solve, and neither has to know what the other does with
 * the same chip. `badge` is the one visual difference — the palette's size axis
 * carries a candidate count and nothing else does.
 *
 * **An axis with fewer than two positions renders nothing**, because a
 * one-position axis is a control that cannot be operated. That is already what
 * `families.ts#sizesFor` does to a one-position size table (the 8 corner
 * assemblies, whose whole domain is the 2x2 their slots require outright), so the
 * guard here makes one rule out of two.
 */
import type { ReactNode } from 'react'

import type { SizePosition } from './families'
import { ANY_SIZE_LABEL, isChosenPosition, positionIn } from './families'

/* The stylesheet that defines this component's three classes, imported here
   rather than left to the palette. The slot editor mounts these chips inside a
   dialog and the palette may not be on screen at all, so a component that only
   looked styled when its original neighbour happened to be mounted would be a
   surface with two appearances. Imported, not copied: the rules stay defined
   once, and the bundler folds the second import. */
import './panels.css'

export interface AxisControlProps {
  /** The axis's name, for the group and each chip's accessible name: `Component`. */
  readonly label: string
  /** What the axis belongs to, so the group label names it: a family, or a recipe. */
  readonly of: string
  readonly entries: readonly SizePosition[]
  /**
   * The tags currently armed or stored, **every axis joined**.
   *
   * Joined rather than per-axis because that is the shape both callers hold —
   * `PlanTools.armedPosition` and `TemplateInstance.filters` — and
   * {@link positionIn} only ever considers this axis's own positions, so the
   * other axes' tags cannot press a chip here.
   */
  readonly position: readonly string[]
  readonly onChoose: (tags: readonly string[]) => void
  /**
   * Abbreviate each label to the width of a chip — see {@link sizeChipLabel}.
   *
   * The size axis's labels are authored for a sentence and every other axis's
   * are authored for a chip, so this is a property of the axis rather than of
   * the surface.
   */
  readonly abbreviate?: boolean
  /** Extra content inside each chip, and its wording for the accessible name. */
  readonly badge?: (entry: SizePosition) => { readonly node: ReactNode; readonly label: string }
}

export function AxisControl({
  label,
  of,
  entries,
  position,
  onChoose,
  abbreviate = false,
  badge,
}: AxisControlProps) {
  // One position is nothing to choose, and none is nothing to show.
  if (entries.length < 2) return null
  const best = positionIn(entries, position)
  return (
    <div className="of-pal-sizes" role="group" aria-label={`${label} for ${of}`}>
      {entries.map((entry) => {
        const extra = badge?.(entry)
        return (
          <button
            key={entry.label}
            type="button"
            className="of-pal-sizebtn"
            aria-pressed={isChosenPosition(entry, best)}
            /* The authored label in full, because the visible text may be
               abbreviated — and a badge's number with no noun beside it says
               nothing on its own. */
            aria-label={`${label}: ${entry.label}${extra === undefined ? '' : `, ${extra.label}`}`}
            onClick={() => {
              onChoose(entry.tags)
            }}
          >
            {abbreviate ? sizeChipLabel(entry.label) : entry.label}
            {extra === undefined ? null : <span className="of-pal-sizecount">{extra.node}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A position's label, abbreviated to the width of a chip.
 *
 * *"2 wide by 2 deep"* is authored for a sentence and is 16 characters in a
 * column that fits about 12; `2 x 2` is the same claim. **Lossless, and the
 * distinction it must not lose is B4's own**: 251 positions are a *cell* (a
 * width and a depth) and 48 are a *run* (a width, because the corpus does not
 * tag a wall's depth), so *"2 wide"* stays *"2 wide"* rather than becoming
 * `2 x ?`. `any size` is unchanged. The full label is on the button's
 * `aria-label`.
 *
 * **The run figure was 48 and is measured at 47**, and 24 of those 47 now say
 * *"N wide, any depth"* because they admit records at two to seven depths and sat
 * in the same control as the `(w, d)` position they contain.
 * `pipeline/families.test.ts` carries the biconditional.
 */
export function sizeChipLabel(label: string): string {
  if (label === ANY_SIZE_LABEL) return label
  const pair = /^(.+) wide by (.+) deep$/.exec(label)
  if (pair !== null) return `${pair[1]!} × ${pair[2]!}`
  /* *"2 wide, any depth"* — a run position that admits records at more than one
     depth, and 24 of the 47 do. `2 × any` keeps the distinction the abbreviation
     above must not lose, in the same width as `2 × 2` and beside it: the chip has
     to say that this position is the *wider* of the two, which plain `2 wide`
     read as the narrower. */
  const anyDepth = /^(.+) wide, any depth$/.exec(label)
  return anyDepth === null ? label : `${anyDepth[1]!} × any`
}
