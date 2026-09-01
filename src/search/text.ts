/**
 * Tokenisation — the difference between a search box and a decoration.
 *
 * architecture-plan.md §6 calls tokenisation *mandatory*, and the measurement
 * behind that word is worth restating because it is easy to under-read: under a
 * naive substring matcher **every multi-word query returns zero hits**. Not
 * "fewer hits" — zero. `"dungeon stone"`, `"arrow slit"`, `"cave wall"`,
 * `"2x2 floor"` all match nothing, because no filename in the corpus contains a
 * space and only five tag values corpus-wide do. A user's first instinct is to
 * type two words, so the naive matcher fails on the first interaction.
 *
 * Two further traps, both silent, both fixed here rather than downstream:
 *
 *   - **Word boundaries, not substrings.** Substring `cave` matches the 658
 *     *con*cave pieces, taking a query for cave-textured tiles from ~407 hits to
 *     1,080 — mostly wrong, and wrong in a way that looks like a working search.
 *     Splitting on non-alphanumerics makes `concave` a token that `cave` does not
 *     match.
 *   - **No `x` → `×` rewrite.** The mock rewrote the `x` in a size like `4x4`
 *     to a multiplication sign for display and then searched the rewritten text.
 *     `×` occurs **zero** times in the corpus, so that rewrite takes `4x4` from
 *     347 hits to 0. Sizes are matched as the corpus spells them.
 *
 * The separator class is every character that is not `[a-z0-9]`, which is a
 * superset of the `[|_+,%#.-]` §6 names. That is deliberate: the corpus also
 * carries `°` (the hex-corner sweep in a display name), `/` (family paths) and
 * `'` , and each of them is a boundary for the same reason the listed ones are.
 * The consequence is that a non-ASCII *letter* would be dropped rather than
 * folded — no live tag or filename contains one, and the alternative is shipping
 * a Unicode normalisation table into a 355 KB payload.
 */

/**
 * Split text into lowercase alphanumeric tokens.
 *
 * Hand-rolled rather than `text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)`
 * because it runs roughly 300,000 times while the index builds, and the regex
 * form allocates an intermediate array plus an empty leading token for every one
 * of the 98.0% of filenames that begin or end with a separator.
 */
export function tokenise(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  let start = -1

  for (let i = 0; i <= lower.length; i++) {
    const code = i < lower.length ? lower.charCodeAt(i) : -1
    const isWord = (code >= 97 && code <= 122) || (code >= 48 && code <= 57)
    if (isWord) {
      if (start === -1) start = i
    } else if (start !== -1) {
      tokens.push(lower.slice(start, i))
      start = -1
    }
  }

  return tokens
}

/**
 * Most tokens taken from one query. Extras are ignored, not rejected.
 *
 * The longest display name in the corpus is 72 characters and the longest is
 * eight words, so a twelve-word query is already in zero-hit territory; the cap
 * exists to bound the work a hand-built `?q=` can ask for, since each token
 * costs a walk of its postings and `MAX_QUERY_LENGTH` alone would permit 64.
 */
export const MAX_QUERY_TOKENS = 12

/** Tokenise a user query, capped at {@link MAX_QUERY_TOKENS}. */
export function tokeniseQuery(query: string): string[] {
  const tokens = tokenise(query)
  return tokens.length > MAX_QUERY_TOKENS ? tokens.slice(0, MAX_QUERY_TOKENS) : tokens
}

/**
 * Strip a single trailing extension from a filename before tokenising it.
 *
 * Every one of the 8,702 live files is a `.stl`, so `stl` is a token on 100% of
 * documents: it discriminates nothing, and in a scorer without IDF weighting it
 * is pure noise that would rank a query for `stl` as a match on everything.
 * Removing it at the source beats a one-word stop list, because the token is an
 * artefact of the field rather than a property of the language.
 */
export function stripExtension(file: string): string {
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}
