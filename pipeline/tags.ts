/**
 * Tag primitives, and the intern table.
 *
 * A tag is pipe-delimited: `namespace|segment|segment…`. Every accessor here
 * mirrors a helper in `docs/verify-catalog-facts.py` so the two cannot drift —
 * where that script and this module disagree, the script wins and a test says so.
 */

/** The segment following `prefix|`, from the **first** matching tag. Mirrors `tag_value`. */
export function tagValue(tags: readonly string[], prefix: string): string | undefined {
  const head = `${prefix}|`
  for (const tag of tags) {
    if (tag.startsWith(head)) return tag.slice(head.length).split('|')[0]
  }
  return undefined
}

/**
 * {@link tagValue} parsed as a finite number, or `undefined`.
 *
 * Mirrors `numeric`. The `undefined` return is load-bearing: `size|width|sw`
 * (33 tiles) and `size|width|wot` (50) are build markers wearing a width tag,
 * and reading them as widths would push 83 tiles into the wrong footprint.
 */
export function numericTagValue(tags: readonly string[], prefix: string): number | undefined {
  const raw = tagValue(tags, prefix)
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** Every distinct segment appearing directly after `namespace|`, in first-seen order. */
export function namespaceRoots(tags: readonly string[], namespace: string): string[] {
  const head = `${namespace}|`
  const roots: string[] = []
  for (const tag of tags) {
    if (!tag.startsWith(head)) continue
    const root = tag.slice(head.length).split('|')[0]
    if (root && !roots.includes(root)) roots.push(root)
  }
  return roots
}

/** Whether any tag starts with `prefix` (prefix match, not segment match). */
export function hasTagPrefix(tags: readonly string[], prefix: string): boolean {
  return tags.some((tag) => tag.startsWith(prefix))
}

/**
 * Whether any tag **is** `path`, or is a descendant of it at a segment boundary.
 *
 * The distinction from {@link hasTagPrefix} is the boundary, and it is what a
 * ladder over the shape vocabulary needs: `hasTagPrefix(tags, 'part')` also
 * matches a hypothetical `partition|`, and `hasTagPrefix(tags, 'shape|base')`
 * also matches `shape|baseboard`. Neither string exists in the corpus today —
 * the two functions return the same answer on all 8,702 records for every prefix
 * either is called with, and `derive.test.ts` pins that — so this is not a bug
 * fix. It is the difference between a rule that is right and a rule that is
 * right by luck, and `pipeline/role.ts` reads the tag tree at eleven prefixes
 * across eight namespaces, which is more luck than one derivation should need.
 *
 * `hasTagPrefix` stays as it is: `classifyLayer` and `hasCurveMarker` were both
 * measured against it, and re-pointing them would be a derivation change for no
 * observable difference.
 */
export function hasTagSegment(tags: readonly string[], path: string): boolean {
  const head = `${path}|`
  return tags.some((tag) => tag === path || tag.startsWith(head))
}

/* ------------------------------------------------------------------ interning */

/**
 * The tag intern table.
 *
 * 101,427 tag references over 930 distinct strings — 109 repetitions of each
 * string on average. 84,023 references over 915 strings come off the scan; the
 * remaining 17,404 over 15 strings are row B1's derived `role|<x>` and
 * `form|<x>` axes, which `build.ts` appends to each row's list **before** this
 * function sees it, precisely so that they are ordered by frequency along with
 * everything else. Ids are assigned **by descending frequency**, so the tags
 * that appear tens of thousands of times get one- and two-digit ids: the
 * reference arrays are the single largest repeated structure in the payload and
 * their digit count is most of their cost.
 *
 * Ties break on the tag string, so the table is a pure function of the corpus
 * and two runs over identical input produce identical ids.
 */
export function buildTagTable(taggedRows: readonly (readonly string[])[]): {
  table: string[]
  idOf: ReadonlyMap<string, number>
} {
  const counts = new Map<string, number>()
  for (const tags of taggedRows) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }

  const table = [...counts.keys()].sort((a, b) => {
    const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
    return byCount !== 0 ? byCount : a < b ? -1 : a > b ? 1 : 0
  })

  const idOf = new Map<string, number>()
  table.forEach((tag, index) => idOf.set(tag, index))
  return { table, idOf }
}
