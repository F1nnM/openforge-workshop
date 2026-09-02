/**
 * The search input and the live result count — design-contract.md §2.2.
 *
 * ## The input is the one place with local state, and it is not a facet mirror
 *
 * `q` lives in the URL like every other filter, but a URL write per keypress
 * would make typing feel like it is being fought. The draft-and-commit state
 * machine that fixes it — and the mid-word rewind the naive version causes — is
 * `./useDraftQuery.ts`, shared with the builder's palette since row X5. This
 * component owns the markup and the count; the hook owns the timing.
 *
 * ## The count is announced
 *
 * `role="status"` (which is `aria-live="polite"` plus `aria-atomic`) on the count,
 * so filtering tells a screen-reader user what happened. Polite, not assertive:
 * the number changes on every keystroke and every facet click, and an assertive
 * region would interrupt the user typing into the field that caused it.
 *
 * ## It counts items, and says how many files are behind them
 *
 * Row A3. A result is an aggregate, so an unfiltered catalog reports **3,822
 * tiles** where it used to report 8,702. Reporting only the smaller number would
 * look like four fifths of the archive had gone missing, and reporting only the
 * larger one would disagree with the number of cards on screen. So both are
 * shown, and {@link SearchFieldProps.files} is what makes the second honest —
 * it is the files behind *the matching items*, not the corpus total, so it
 * narrows with the filter like everything else on the line.
 *
 * "tile" stays the noun. design-contract.md §2.2 writes the count that way, and
 * an aggregate is closer to what a user means by "a tile" than a file is: one
 * thing you choose, place and print, whichever of its 2.28 files you end up
 * printing.
 */
import { useId } from 'react'

import { MAX_QUERY_LENGTH } from '@/search'

import { countLabel } from './format'
import { useDraftQuery } from './useDraftQuery'

export interface SearchFieldProps {
  /** `q` from the URL. The source of truth; the draft only leads it briefly. */
  query: string
  /** Matching items, from the engine — `SearchResult.total`. */
  total: number
  /**
   * Files behind those items, summed over their variants.
   *
   * Equal to {@link total} when every match is a singleton, and then the clause
   * is dropped: "6 tiles · 6 files" states the same thing twice.
   */
  files: number
  /** Whether any filter or query is active — changes the count's wording. */
  filtered: boolean
  onQueryChange: (text: string) => void
}

export function SearchField({ query, total, files, filtered, onQueryChange }: SearchFieldProps) {
  const inputId = useId()
  const { draft, change } = useDraftQuery(query, onQueryChange)

  return (
    <div className="of-catalog-search">
      <label className="of-sr-only" htmlFor={inputId}>
        Search the catalog
      </label>
      <input
        id={inputId}
        className="of-search-input"
        type="search"
        autoComplete="off"
        spellCheck={false}
        // The schema drops a longer query rather than truncating it, so the
        // field stops the user at the same bound instead of silently discarding
        // what they typed.
        maxLength={MAX_QUERY_LENGTH}
        placeholder="Search tiles, textures, sizes…"
        value={draft}
        onChange={(event) => {
          change(event.target.value)
        }}
      />
      <p className="of-result-count" role="status">
        <span className="of-result-total">{countLabel(total)}</span>{' '}
        {total === 1 ? 'tile' : 'tiles'}
        {filtered ? ' match' : ''}
        {files > total ? (
          <span className="of-result-files">
            {' · '}
            {countLabel(files)} files
          </span>
        ) : null}
      </p>
    </div>
  )
}
