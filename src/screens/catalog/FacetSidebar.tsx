/**
 * The 238px facet sidebar — design-contract.md §2.2, with the plan's corrections.
 *
 * ## The contract's facets are wrong and this is what replaced them
 *
 * §2.2 describes three groups of single-select toggles with no hierarchy. Every
 * part of that is contradicted by the corpus, and architecture-plan.md §6 lists
 * the corrections. This component implements the corrected shapes:
 *
 * | group | contract | here | the fact |
 * | --- | --- | --- | --- |
 * | Component | single-select | **multi-select checkboxes** + an "All components" row | 19.5% of tiles are in 2+ buckets, 11.9% in none — so a tile is not in exactly one group, and `Other` has to be a visible value or 1,032 tiles are unreachable |
 * | Texture set | 6 chips | **38 roots, prefix-matched**, top 12 with a "more" affordance | selecting `dungeon_stone` must also match `texture\|dungeon_stone\|eroded`, and 38 chips is not a sidebar |
 * | Build system | single-select | single-select **plus a first-class Unspecified** | 2,978 tiles (34.2%) carry no `build\|` tag, so absence is a filter value |
 * | Connection | absent | **multi-select** | 2,493 tiles (28.6%) carry 2+ systems; fusing it into build would make `openforge` — the project's own flagship connector — unreachable |
 *
 * ## Native inputs, not buttons
 *
 * Multi-select groups are `<input type="checkbox">`, the single-select group is
 * `<input type="radio">`. Both are visually a pill or a row, and neither is a
 * `<button aria-pressed>`, for three reasons: a screen reader announces
 * checked/unchecked state and group membership without any ARIA of ours; a radio
 * group is one tab stop with arrow keys, which matters when the sidebar already
 * holds ~35 controls; and `:has()` puts the focus ring on the pill rather than on
 * a 1px input. The input is the label's only child that is focusable, so clicking
 * the pill and pressing Space are the same event.
 *
 * The `ToggleGroup` primitive would have given the multi-select groups a roving
 * tabindex too, but it is single-select by construction (see its docblock) and
 * `src/ui/primitives/**` belongs to PR 12.
 *
 * ## Counts are live and come from the engine
 *
 * Every count is `FacetBucket.count`, computed with that facet's *own* filter
 * excluded (`src/search/facets.ts`). That is what makes selecting one texture
 * leave the other 37 counts non-zero instead of turning the sidebar into a dead
 * end. Nothing here derives a count.
 *
 * A bucket that the current cross-facet filters reduce to zero is rendered
 * **disabled rather than hidden**: hiding it would reflow the sidebar on every
 * keystroke, and a control that vanishes cannot tell the user why.
 */
import { useId, useState } from 'react'

import type { FacetBucket, FacetCounts } from '@/search'
import { BUILD_ANY } from '@/search'
import { Chip, Eyebrow } from '@/ui/primitives'

import type { FacetActions, MultiFacetKey } from './facetState'
import { buildLabel, connLabel, countLabel, humaniseSegment, kindLabel } from './format'

/**
 * Texture roots shown before the "more" affordance.
 *
 * Twelve covers every root with more than 80 tiles — `dungeon_stone` (3,130)
 * down to `stone_brick` (84) — which is 8,247 of the 8,702 tiles reachable
 * without expanding. The remaining 26 roots are long-tail: `bamboo`, `calendar`
 * and `mosaic` carry one tile each.
 */
const TEXTURE_VISIBLE = 12

export interface FacetSidebarProps {
  facets: FacetCounts
  /** Corpus size, for the "All components" row. */
  total: number
  actions: FacetActions
  /** Whether any filter or query is active — gates "✕ Clear filters". */
  filtered: boolean
}

export function FacetSidebar({ facets, total, actions, filtered }: FacetSidebarProps) {
  return (
    <aside className="of-facets" aria-label="Filters">
      <MultiFacetGroup
        label="Component"
        facetKey="kinds"
        variant="list"
        buckets={facets.kinds}
        actions={actions}
        toLabel={kindLabel}
        allRow={{ label: 'All components', count: total }}
      />

      <MultiFacetGroup
        label="Texture set"
        facetKey="tex"
        variant="pills"
        buckets={facets.tex}
        actions={actions}
        toLabel={humaniseSegment}
        visible={TEXTURE_VISIBLE}
      />

      <BuildFacetGroup buckets={facets.build} total={total} actions={actions} />

      <MultiFacetGroup
        label="Connection"
        facetKey="conn"
        variant="pills"
        buckets={facets.conn}
        actions={actions}
        toLabel={connLabel}
      />

      {filtered ? (
        <button type="button" className="of-facet-clear" onClick={actions.clearAll}>
          <span aria-hidden="true">✕ </span>Clear filters
        </button>
      ) : null}
    </aside>
  )
}

/* -------------------------------------------------------------- multi-select */

interface MultiFacetGroupProps {
  label: string
  facetKey: MultiFacetKey
  variant: 'list' | 'pills'
  buckets: readonly FacetBucket[]
  actions: FacetActions
  toLabel: (value: string) => string
  /** Buckets shown before the "more" affordance. All of them by default. */
  visible?: number
  /** A row that clears the facet, shown above the values. */
  allRow?: { label: string; count: number }
}

function MultiFacetGroup({
  label,
  facetKey,
  variant,
  buckets,
  actions,
  toLabel,
  visible,
  allRow,
}: MultiFacetGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const headingId = useId()
  const shown = visibleBuckets(buckets, expanded ? undefined : visible)
  const hidden = buckets.length - shown.length

  return (
    // A `div role="group"`, not a `<section>`: four labelled sections in a
    // sidebar would be four landmarks, and a screen-reader rotor listing
    // "Component", "Texture set", "Build system", "Connection" as regions beside
    // the real ones is noise. `group` gives the same name association without
    // joining the landmark map.
    <div className="of-facet-group" role="group" aria-labelledby={headingId}>
      <Eyebrow as="div" className="of-facet-heading">
        <span id={headingId}>{label}</span>
      </Eyebrow>

      {allRow === undefined ? null : (
        <button
          type="button"
          className="of-facet-row of-facet-all"
          aria-pressed={buckets.every((bucket) => !bucket.selected)}
          onClick={() => {
            actions.clearValues(facetKey)
          }}
        >
          <span className="of-facet-text">{allRow.label}</span>{' '}
          <Chip tone="count">{countLabel(allRow.count)}</Chip>
        </button>
      )}

      <div className={variant === 'list' ? 'of-facet-list' : 'of-facet-pills'}>
        {shown.map((bucket) => (
          <FacetCheckbox
            key={bucket.value}
            bucket={bucket}
            variant={variant}
            label={toLabel(bucket.value)}
            onToggle={() => {
              actions.toggleValue(facetKey, bucket.value)
            }}
          />
        ))}
      </div>

      {hidden > 0 || expanded ? (
        <button
          type="button"
          className="of-facet-more"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value)
          }}
        >
          {expanded ? 'Show fewer' : `+ ${countLabel(hidden)} more`}
        </button>
      ) : null}
    </div>
  )
}

/**
 * The buckets a group renders, honouring a limit.
 *
 * A selected value is always shown, even past the limit. Two things arrive that
 * way and both need a control the user can reach: a **deeper texture path**
 * (`cave|sandstone`) is filterable but is not a top-level chip, and a value from
 * a rotted link has a count of zero and no place in the vocabulary. Dropping
 * either would leave a filter narrowing the results with nothing on screen to
 * undo it.
 */
function visibleBuckets(buckets: readonly FacetBucket[], limit?: number): readonly FacetBucket[] {
  if (limit === undefined || buckets.length <= limit) return buckets
  const head = buckets.slice(0, limit)
  const tail = buckets.slice(limit).filter((bucket) => bucket.selected)
  return tail.length === 0 ? head : [...head, ...tail]
}

interface FacetCheckboxProps {
  bucket: FacetBucket
  variant: 'list' | 'pills'
  label: string
  onToggle: () => void
}

function FacetCheckbox({ bucket, variant, label, onToggle }: FacetCheckboxProps) {
  // A bucket at zero that is not selected cannot narrow anything further, so it
  // is inert. Selected ones stay live regardless — that is the only way out of
  // a filter combination that matches nothing.
  const empty = bucket.count === 0 && !bucket.selected

  return (
    <label
      className={variant === 'list' ? 'of-facet-row' : 'of-facet-pill'}
      data-selected={bucket.selected ? '' : undefined}
      data-empty={empty ? '' : undefined}
    >
      <input
        type="checkbox"
        className="of-facet-input"
        checked={bucket.selected}
        disabled={empty}
        onChange={onToggle}
      />
      <span className="of-facet-text">{label}</span>{' '}
      <Chip tone="count">{countLabel(bucket.count)}</Chip>
    </label>
  )
}

/* ------------------------------------------------------------- single-select */

interface BuildFacetGroupProps {
  buckets: readonly FacetBucket[]
  total: number
  actions: FacetActions
}

/**
 * Build system — one choice, and "Any" is one of the choices.
 *
 * A radio group needs a member for "no filter", or the only way to clear it is a
 * separate button; §2.2's own device for that is the "All components" row, so the
 * same shape is used here. Absence of a build tag is *not* that member: it has
 * its own value, the `!none` sentinel, which the engine emits as a bucket like
 * any other and this group renders as **Unspecified**.
 */
function BuildFacetGroup({ buckets, total, actions }: BuildFacetGroupProps) {
  const headingId = useId()
  const name = useId()
  const anySelected = buckets.every((bucket) => !bucket.selected)

  return (
    <div className="of-facet-group" role="group" aria-labelledby={headingId}>
      <Eyebrow as="div" className="of-facet-heading">
        <span id={headingId}>Build system</span>
      </Eyebrow>

      <div className="of-facet-pills" role="radiogroup" aria-labelledby={headingId}>
        <label className="of-facet-pill" data-selected={anySelected ? '' : undefined}>
          <input
            type="radio"
            className="of-facet-input"
            name={name}
            checked={anySelected}
            onChange={() => {
              actions.setBuild(BUILD_ANY)
            }}
          />
          <span className="of-facet-text">Any</span>{' '}
          <Chip tone="count">{countLabel(total)}</Chip>
        </label>

        {buckets.map((bucket) => {
          const empty = bucket.count === 0 && !bucket.selected
          return (
            <label
              key={bucket.value}
              className="of-facet-pill"
              data-selected={bucket.selected ? '' : undefined}
              data-empty={empty ? '' : undefined}
            >
              <input
                type="radio"
                className="of-facet-input"
                name={name}
                checked={bucket.selected}
                disabled={empty}
                onChange={() => {
                  actions.setBuild(bucket.value)
                }}
              />
              <span className="of-facet-text">{buildLabel(bucket.value)}</span>{' '}
              <Chip tone="count">{countLabel(bucket.count)}</Chip>
            </label>
          )
        })}
      </div>
    </div>
  )
}
