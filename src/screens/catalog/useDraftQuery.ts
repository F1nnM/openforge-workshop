/**
 * A text field that leads the URL by one debounce, and follows it otherwise.
 *
 * ## Why this is a hook and not a component
 *
 * Two screens hold a search box over the same engine, and they are not the same
 * control: the catalog's is a 520px field with a live "3,822 tiles · 8,702
 * files" count beside it (`SearchField.tsx`), and the builder's is a 272px
 * column with a count that only appears while a query is live
 * (`src/builder/panels/PalettePanel.tsx`). Sharing the *markup* would mean a
 * component with a props matrix for two callers. What they genuinely share is
 * the state machine below, and it is thirty lines of it.
 *
 * Row X5 extracted it. Before that, both files carried their own copy and the
 * palette's docblock said so — "the debounce logic is what is shared, and it is
 * thirty lines" — which is a correct diagnosis sitting next to the duplicate.
 *
 * ## The state machine, and the bug it exists to avoid
 *
 * `q` lives in the URL like every other filter, but a URL write per keypress
 * makes typing feel fought: the router revalidates, the screen re-searches, and
 * the cursor lands wherever a controlled value arriving a tick late puts it. So
 * the field holds the **draft** and pushes it after {@link COMMIT_DELAY_MS}.
 *
 * That leaves exactly one hard problem: the draft must follow the URL when the
 * URL changes for a reason that is not this field — a Back press, a shared link,
 * a "Clear filters" button — and must **not** follow it when the change is this
 * field's own navigation echoing back. `committed` is the discriminator: it holds
 * the last value this field sent, so a `q` that differs from it came from
 * somewhere else and wins.
 *
 * The naive version (`useEffect(() => setDraft(q), [q])`) looks identical and is
 * broken in a way that is hard to see: mid-word, the echo of keystroke *n*
 * arrives while the user has typed *n+2*, and the field silently rewinds two
 * characters. `src/screens/catalog/catalog.test.tsx` covers both directions —
 * "commits the query to the URL and reports the count" and "follows the URL when
 * the query changes from outside the field" — so a regression here is a red test
 * rather than a feel someone has to notice.
 */
import { useEffect, useRef, useState } from 'react'

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

export interface DraftQuery {
  /** What the input should render. Leads {@link query} by at most one debounce. */
  readonly draft: string
  /** Call from `onChange`. Sets the draft now and commits it after the delay. */
  readonly change: (text: string) => void
}

/**
 * @param query the committed value, from the URL. The source of truth.
 * @param onQueryChange called once per debounce, never once per keystroke.
 */
export function useDraftQuery(query: string, onQueryChange: (text: string) => void): DraftQuery {
  const [draft, setDraft] = useState(query)
  const committed = useRef(query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read through a ref so a caller passing an inline arrow does not have to
  // memoise it to keep this hook's effects from re-running.
  const commit = useRef(onQueryChange)
  commit.current = onQueryChange

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

  return {
    draft,
    change: (text: string) => {
      setDraft(text)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        committed.current = text
        commit.current(text)
      }, COMMIT_DELAY_MS)
    },
  }
}
