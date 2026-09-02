/**
 * `constrain` semantics, ported from the catalog frontend rather than derived.
 *
 * ## Why this is a port and not a reading of the spec
 *
 * `docs/config-spec.md` in the catalog repository is 332 lines and it is *prose*.
 * §5 of `docs/architecture-plan.md` calls `constrain` the plan's largest open
 * question for a measured reason: under one reading of it the median slot has
 * **1,868** candidates and under another **14**, and both of those numbers are
 * measured on this corpus in `corpus.test.ts`. A two-orders-of-magnitude spread
 * is not something to settle from prose, so this file is a line-by-line port of
 * `openforge-catalog/src/utils/config-processing.ts` — the function the live
 * catalog has actually been serving compositions with — together with all **69**
 * of its tests, in `config.test.ts` (34 from `config-processing.test.ts`, 35 from
 * `config-spec-compliance.test.ts`).
 *
 * ## The reading, in one paragraph
 *
 * `constrain` is a **join, evaluated at selection time**, and it is *not* a
 * filter. Each `{ tag }` entry names a tag *prefix*; the entry collects every tag
 * under that prefix from the parent (unless `parent: false`) and from the
 * sibling parts already selected (all of them unless `siblings` names a subset,
 * none if `siblings: []`), drops anything a `{ filter }` entry in the same
 * `constrain` array touches, keeps the exact match plus the **most general**
 * survivors, and adds those to the slot's `require` list. `require` and `deny`
 * are exact tag equality — verified against the backend's own SQL, which joins
 * `tags.tag = ARRAY[…]` for a require and `NOT IN (…same…)` for a deny — while
 * `accept` is the positional/prefix form. So the resolved output of a slot is
 * always an exact-match `{ require, deny }` pair, and `constrain` is the only
 * part of the grammar that reads tags off *other* objects.
 *
 * Three things follow, and they are the whole substance of this row:
 *
 *   1. **`parent` defaults to `true`,** so a slot is narrowed by its own tile's
 *      tags *before any interaction happens*. That, not the wide reading, is the
 *      corpus's initial state — median 14 candidates, not 1,868.
 *   2. **Sibling selections are runtime state,** so no precomputed candidate set
 *      is correct for longer than one click. `candidates.ts` therefore resolves
 *      in the browser and the artefact gains **0 bytes**; `measure.ts` carries
 *      what the four alternatives were measured to cost.
 *   3. **Nothing here interprets `filter` as a standalone constraint.** A
 *      `constrain` array of filters alone resolves to nothing at all — one of the
 *      69 tests pins exactly that, and it is the difference between a filter and
 *      a `deny`.
 *
 * ## What changed for a static client, and what did not
 *
 * {@link processConfigValues} is the catalog's function with its control flow
 * intact — the same two passes, the same insertion-ordered `Set`s, the same
 * `startsWith` prefix test, the same "default to true if not specified" on
 * `parent`. What changed is around it:
 *
 *   - **Types.** The catalog imports `ConfigTags` from a server-shaped model
 *     (`@/types`); this takes {@link SlotTags}, which `PartSlot['tags']` from
 *     `@/catalog` is assignable to.
 *   - **`ConstrainEntry` is wider than the schema's `ConstrainRef`.** The
 *     schema models `{ tag }` and `{ filter }` only, because **zero live
 *     `constrain` entries carry `siblings` or `parent`** — measured over all
 *     9,180 of them in the fixtures. The grammar permits both, so this file
 *     reads them; if a fixture ever writes one, `src/catalog/schema.ts` has to
 *     widen `ConstrainRef` or Zod will strip it and the source control will be
 *     lost in silence. That is reported to the schema's owner rather than fixed
 *     here.
 *   - **`accept` is implemented rather than ignored.** The catalog's function
 *     drops it (one of the 69 tests asserts that it does, because the catalog's
 *     *backend* enforces it); a static client has no backend to defer to, so
 *     {@link resolveSlotTags} carries it through and `candidates.ts` applies it
 *     positionally per the spec. **Zero live slots use it** and the schema does
 *     not model it either — same report, same reason.
 *   - **`buildNestedConfigs` is adapted, not verbatim.** Its catalog form reads
 *     `Blueprint.blueprint_config.parts` off an API object. {@link nestedSlots}
 *     is the same three lines over `CatalogRecord.config.parts`. It has no test
 *     in the 69 — the catalog never wrote one — so it is the one function here
 *     whose behaviour rests on reading rather than on a ported assertion, and it
 *     is three lines of property access.
 *   - **`createDeepLink` came across verbatim, with its 12 tests.** It is the
 *     inverse of resolution — a resolved `{ require, deny }` as a catalog query —
 *     and it is what C2 needs for "browse every candidate for this slot" rather
 *     than the inline grid. Its grammar is the *catalog's* (`tag=`/`deny=`), not
 *     this app's; `src/search/searchSchema.ts` owns this app's, and row A4 owns
 *     that file. Dropping the function would have dropped 12 of the 69 tests,
 *     which is 12 semantics taken on trust.
 */
import type { PartSlot, TagRef } from '@/catalog'

/* -------------------------------------------------------------- the grammar */

/**
 * One `constrain` entry, in the **grammar's** shape rather than the corpus's.
 *
 * `src/catalog/schema.ts`'s `ConstrainRef` is `{ tag } | { filter }`, which is
 * everything the 9,180 live entries are. The spec's two source-control
 * properties are modelled here because {@link processConfigValues} reads them and
 * a port that quietly ignored half its input grammar would be exactly the
 * "semantic you are guessing at" this row exists to avoid.
 */
export interface ConstrainEntry {
  /** A tag *prefix* to inherit under. Never an exact-match requirement itself. */
  readonly tag?: string
  /** A prefix to remove from what the `tag` entries collected. Cannot carry source control. */
  readonly filter?: string
  /**
   * Which sibling parts to inherit from.
   *
   * `undefined` — every sibling. A non-empty list — only those part names. `[]` —
   * **no siblings at all**, which is a third state and not the same as absent.
   * The catalog's function distinguishes all three and so does this one.
   */
  readonly siblings?: readonly string[]
  /** `false` to exclude the parent's own tags. Absent means `true`. */
  readonly parent?: boolean
}

/**
 * A slot's constraint block.
 *
 * `PartSlot['tags']` is assignable to this. `accept` is here because the spec has
 * it and the ported tests pass it; **no live slot carries one**, and
 * `src/catalog/schema.ts` does not model it, so one arriving in a fixture would
 * be stripped before it ever reached this type.
 */
export interface SlotTags {
  readonly require?: readonly TagRef[]
  readonly deny?: readonly TagRef[]
  readonly accept?: readonly TagRef[]
  readonly constrain?: readonly ConstrainEntry[]
}

/** What the catalog's function returns: two exact-match tag lists. */
export interface ProcessedTags {
  readonly require: string[]
  readonly deny: string[]
}

/** One sibling part's current selection — its name, and the tags of what fills it. */
export interface SiblingSelection {
  readonly partName: string
  readonly tags: readonly string[]
}

/* ------------------------------------------------------------------ the port */

/**
 * Drop the more specific tags from a set, keeping exact matches.
 *
 * A tag is "more specific" than another when it starts with it plus a pipe. The
 * exact match for the constraint tag is always kept — `texture` and
 * `texture|stone` can both survive one pass, which is why this is not simply
 * "the shortest".
 *
 * Verbatim from the catalog's `filterSpecificTags`, `Set` semantics included.
 */
function filterSpecificTags(tags: ReadonlySet<string>, constraintTag: string): Set<string> {
  const result = new Set<string>()
  const tagsArray = [...tags]

  // Always include exact matches for the constraint tag
  for (const tag of tagsArray) if (tag === constraintTag) result.add(tag)

  // For prefix matches (excluding exact matches), filter to most general
  const prefixMatches = tagsArray.filter((tag) => tag !== constraintTag && tag.startsWith(`${constraintTag}|`))

  for (const tag of prefixMatches) {
    let isMostGeneral = true
    for (const otherTag of prefixMatches) {
      if (otherTag !== tag && tag.startsWith(`${otherTag}|`)) {
        isMostGeneral = false
        break
      }
    }
    if (isMostGeneral) result.add(tag)
  }

  return result
}

/**
 * The tags a single `constrain` entry inherits, before specificity filtering.
 *
 * Split out of the catalog's one long loop because the source control is the
 * part of the grammar with three states rather than two, and it is the part with
 * **zero corpus coverage** — so it is the part most worth being able to read on
 * its own. The insertion order is load-bearing: parent tags first, then siblings
 * in selection order, which is what makes `require` deterministic and is what
 * six of the ported tests assert on.
 */
function inheritedTags(
  entry: ConstrainEntry,
  parentTags: readonly string[],
  siblingSelections: readonly SiblingSelection[],
): Set<string> {
  const allowed = new Set<string>()

  // Add parent tags if parent inheritance is enabled. Default to true if unspecified.
  if (entry.parent !== false) for (const tag of parentTags) allowed.add(tag)

  const siblings = entry.siblings
  if (siblings === undefined) {
    // Default behaviour: consider all siblings.
    for (const sibling of siblingSelections) for (const tag of sibling.tags) allowed.add(tag)
  } else if (siblings.length > 0) {
    // Specific siblings only. An empty array adds nothing, deliberately.
    for (const sibling of siblingSelections) {
      if (siblings.includes(sibling.partName)) for (const tag of sibling.tags) allowed.add(tag)
    }
  }

  return allowed
}

/**
 * Resolve a slot's constraint block against a parent and the siblings selected
 * so far.
 *
 * The port of `processConfigValues`. Returns the **exact-match** `require` and
 * `deny` lists the catalog sends to `/api/blueprint/tags/` and that
 * `candidates.ts` intersects postings with here.
 *
 * `configValues` is nullable because the catalog's is and one of the 69 tests
 * calls it with `null`.
 */
export function processConfigValues(
  configValues: SlotTags | null,
  parentTags: readonly string[] = [],
  siblingSelections: readonly SiblingSelection[] = [],
): ProcessedTags {
  const requireTags = new Set<string>()
  const denyTags = new Set<string>()

  if (!configValues) return { require: [], deny: [] }

  for (const data of configValues.require ?? []) if (data.tag) requireTags.add(data.tag)
  for (const data of configValues.deny ?? []) if (data.tag) denyTags.add(data.tag)

  const constrain = configValues.constrain
  if (constrain) {
    // Every filter in the array applies to every tag entry in it. The catalog
    // collects them in one pass before the loop, and that is not an
    // optimisation: a filter written *after* the tag entry it moderates still
    // moderates it, and 906 of the corpus's `shape` constraints rely on it.
    const filterTags = constrain
      .map((entry) => entry.filter)
      .filter((filter): filter is string => filter !== undefined)

    for (const data of constrain) {
      const constraintTag = data.tag
      if (constraintTag === undefined || constraintTag === '') continue

      const allowedTags = inheritedTags(data, parentTags, siblingSelections)

      const matchingTags = new Set<string>()
      for (const tag of allowedTags) {
        // Must match the constraint type…
        if (!tag.startsWith(constraintTag)) continue
        // …and must not be touched by any filter, in either direction: a filter
        // removes its own descendants and also the ancestors that would let them
        // back in.
        let shouldInclude = true
        for (const filterTag of filterTags) {
          if (tag === filterTag || tag.startsWith(`${filterTag}|`) || filterTag.startsWith(`${tag}|`)) {
            shouldInclude = false
            break
          }
        }
        if (shouldInclude) matchingTags.add(tag)
      }

      if (matchingTags.size > 0) {
        for (const tag of filterSpecificTags(matchingTags, constraintTag)) requireTags.add(tag)
      }
    }
  }

  return { require: [...requireTags], deny: [...denyTags] }
}

/**
 * The resolved constraint of one slot: exact-match `require`/`deny` plus the
 * positional `accept` the catalog's frontend leaves to its backend.
 *
 * The one place this port is deliberately *wider* than its source. A static
 * client is both halves of the catalog's split — §"Implementation Architecture"
 * of the spec gives `accept` to the backend — so dropping it here would drop it
 * entirely rather than delegating it. Zero live slots carry one.
 */
export interface ResolvedSlot extends ProcessedTags {
  /** Positional prefix matches: `shape|wall` admits `shape|wall|corner`. */
  readonly accept: string[]
}

/** {@link processConfigValues}, with `accept` carried through instead of dropped. */
export function resolveSlotTags(
  tags: SlotTags | null,
  parentTags: readonly string[] = [],
  siblingSelections: readonly SiblingSelection[] = [],
): ResolvedSlot {
  const processed = processConfigValues(tags, parentTags, siblingSelections)
  const accept = new Set<string>()
  for (const data of tags?.accept ?? []) if (data.tag) accept.add(data.tag)
  return { ...processed, accept: [...accept] }
}

/* ------------------------------------------------------------------ adapters */

/**
 * The slots a set of selections brings with them, by the part name they fill.
 *
 * The catalog's `buildNestedConfigs` over this app's record shape: a part filled
 * by a tile that itself declares slots opens those slots one level down. §"
 * Hierarchical Resolution" of the spec is explicit that each level resolves
 * independently — no constraint tunnelling — so this returns the slots and
 * nothing else. **21 tiles corpus-wide can fill a slot at all** (`config.fulfills`),
 * and the deepest live nesting is one level.
 */
export function nestedSlots(
  selections: Readonly<Record<string, { readonly config?: { readonly parts?: readonly PartSlot[] } }>>,
): Record<string, readonly PartSlot[]> {
  const nested: Record<string, readonly PartSlot[]> = {}
  for (const [partName, record] of Object.entries(selections)) {
    const parts = record.config?.parts
    if (parts !== undefined) nested[partName] = parts
  }
  return nested
}

/**
 * A resolved constraint as a catalog query string.
 *
 * Verbatim from the catalog's `createDeepLink`, `URLSearchParams` and all. The
 * grammar is the catalog's — repeated `tag=` and `deny=` plus `search=` — and it
 * is **not** this app's: `src/search/searchSchema.ts` owns a compact codec and
 * row A4 owns that file. Kept because it is the inverse of resolution and
 * because its 12 tests are 12 of the 69.
 */
export function createDeepLink(tags: readonly string[], searchTerm?: string | null, denyTags?: readonly string[]): string {
  const params = new URLSearchParams()
  for (const tag of tags) params.append('tag', tag)
  for (const tag of denyTags ?? []) params.append('deny', tag)
  if (searchTerm) params.set('search', searchTerm)
  return params.toString()
}
