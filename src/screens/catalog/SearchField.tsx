/**
 * The search input and the live result count — design-contract.md §2.2.
 *
 * ## The input is the one place with local state, and it is not a facet mirror
 *
 * `q` lives in the URL like every other filter, but a URL write per keypress
 * would make typing feel like it is being fought: TanStack revalidates, the
 * screen re-searches, and the cursor position is at the mercy of a controlled
 * value arriving a tick late. So the field holds the *draft* and pushes it after
 * {@link COMMIT_DELAY_MS}.
 *
 * That leaves exactly one hard problem: the draft must follow the URL when the
 * URL changes for a reason that is not this field — a Back press, a shared link,
 * the "Clear filters" button — and must **not** follow it when the change is this
 * field's own navigation echoing back. `committed` is the discriminator: it holds
 * the last value this field sent, so a `q` that differs from it came from
 * somewhere else and wins.
 *
 * The naive version (`useEffect(() => setDraft(q), [q])`) looks identical and is
 * broken in a way that is hard to see: mid-word, the echo of keystroke *n* arrives
 * while the user has typed *n+2*, and the field silently rewinds two characters.
 *
 * ## The count is announced
 *
 * `role="status"` (which is `aria-live="polite"` plus `aria-atomic`) on the count,
 * so filtering tells a screen-reader user what happened. Polite, not assertive:
 * the number changes on every keystroke and every facet click, and an assertive
 * region would interrupt the user typing into the field that caused it.
 */
import { useEffect, useId, useRef, useState } from 'react'

import { MAX_QUERY_LENGTH } from '@/search'

import { countLabel } from './format'

/**
 * How long a keystroke waits before it reaches the URL.
 *
 * 180 ms is below the ~250 ms at which an interface starts to feel unresponsive
 * and above a fast typist's inter-key interval (~120 ms), so a word normally
 * costs one navigation rather than one per letter. The search itself is not what
 * is being deferred — the engine answers an unfiltered query in 2.6 ms and a
 * filtered one in about 1 ms — the history entry and the router round-trip are.
 */
export const COMMIT_DELAY_MS = 180

export interface SearchFieldProps {
  /** `q` from the URL. The source of truth; the draft only leads it briefly. */
  query: string
  /** Matching tiles, from the engine. */
  total: number
  /** Whether any filter or query is active — changes the count's wording. */
  filtered: boolean
  onQueryChange: (text: string) => void
}

export function SearchField({ query, total, filtered, onQueryChange }: SearchFieldProps) {
  const inputId = useId()
  const [draft, setDraft] = useState(query)
  const committed = useRef(query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query === committed.current) return
    // The URL moved on its own — Back, a link, or "Clear filters". Drop any
    // pending commit, or it would immediately undo the navigation that just
    // happened.
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    committed.current = query
    setDraft(query)
  }, [query])

  // Only on unmount: a timer left running would call `onQueryChange` after the
  // screen is gone, which TanStack turns into a navigation to a route nothing is
  // rendering.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  function change(text: string) {
    setDraft(text)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      committed.current = text
      onQueryChange(text)
    }, COMMIT_DELAY_MS)
  }

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
      </p>
    </div>
  )
}
