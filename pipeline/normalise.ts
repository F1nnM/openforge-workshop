/**
 * Tag-drift normalisation — the one place a spelling is collapsed.
 *
 * §16 risk 15. Applied once, in {@link buildCatalog}, to every live row's tag
 * list before anything reads it: before the design index, before the intern
 * table, before `textureRoot`, before the facet vocabulary. Downstream there is
 * exactly one spelling of each thing, so no consumer has to know that a second
 * one ever existed.
 *
 * ── What normalisation is allowed to do, and what it is not ─────────────────
 *
 * A collapse is lossy by construction: it deletes a value a user could
 * previously filter on. So the bar is deliberately high, and it is **not** "two
 * tags mean the same material". It is:
 *
 *   **the two spellings name the same thing, and no model distinguishes them.**
 *
 * That second clause is what most candidates fail, and it is why this table has
 * one entry rather than six. The corpus uses word order as *meaning* all over
 * the place — `component|collapsed|full-low` (49) and `component|collapsed|low-full`
 * (45) are opposite ends of the same wall, `shape|corner|low-minimal-full` and its
 * five permutations are six different corners — so a rule like "sort the
 * compound segments" would destroy real distinctions wholesale. Every candidate
 * below was checked against the models that carry it, not against a string
 * heuristic. See {@link NOT_COLLAPSED} for the ones that failed, and why.
 *
 * ── The one collapse ────────────────────────────────────────────────────────
 *
 * `texture|foundations` (2 tiles) → `texture|foundation` (51 tiles).
 *
 * Same word, singular and plural, and nothing in the corpus separates them:
 *
 *   - The 51 `foundation` tiles are all `foundation#base+wall…` under
 *     `tiles/bases/separate_wall/primary_walls/base#wall%foundation/`. The 2
 *     `foundations` tiles are `foundations#…` under
 *     `tiles/building_facades/yawning_portal/foundations/`. Two folders, one
 *     surface word, spelled as the folder happened to be named.
 *   - **No tile carries both** (verified), so the collapse can never merge two
 *     tags on one record, and no record loses a tag.
 *   - Both already resolve to `rough_stone`, so the appearance does not move —
 *     `src/materials/mapping.ts` had already conceded the material question and
 *     left only the facet-label question open. This is that decision.
 *
 * What it costs, stated plainly: the texture facet loses the value
 * `foundations`, and with it the ability to select exactly those 2 tiles.
 * `foundation` goes 51 → 53 and is the only way to reach them by texture. They
 * stay reachable by `component|goblin_fireplace`, `component|portal` and by
 * their family path, which still reads `…/yawning_portal/foundations`, and free
 * text still finds them — the text index tokenises `record.file`, whose stem is
 * literally `foundations`. Nothing downstream read the split: no display name,
 * no search token, no `require`/`deny` ref in any `config` mentions either
 * spelling (verified over all 8,702 rows).
 *
 * ── Figures this moves ──────────────────────────────────────────────────────
 *
 * Three different numbers, and they are not interchangeable — `texture` on a
 * record is the root of the tile's *first* texture tag, not of all of them:
 *
 *   - texture roots present on any tag:          **38 → 37**
 *   - texture roots reaching `record.texture`:   **37 → 36**
 *   - roots mapped by `TEXTURE_ROOT_MATERIAL`:   **38, unchanged** — the table
 *     keeps the retired spelling on purpose, as belt and braces for a caller
 *     that resolves straight off the fixtures.
 *
 * `stucco` remains the one root that exists but never wins first position, so
 * the all-tags and first-position sets still differ by exactly it. The **scanned
 * vocabulary** goes 916 → 915 distinct strings over an unchanged 84,023
 * references — which is what this module's figures are all about, and is not the
 * size of the emitted table. Row B1 appends two derived tags to every row after
 * this step, so `catalog.json` ships 930 strings over 101,427 references. The
 * two numbers are one collapse apart and one derivation apart, and
 * `normalise.test.ts` measures the first without ever building the second.
 *
 * **Nothing in {@link TAG_ALIASES} may ever name a `role|` or `form|` tag**, and
 * the ordering is what guarantees it rather than a rule: normalisation runs on
 * the way in and the derived tags are appended afterwards, so `normaliseTag`
 * never sees one. If that order were reversed, an alias could rewrite a derived
 * axis into a value the closed enum does not contain and every template slot
 * predicating on it would silently resolve to nothing.
 *
 * Rewriting happens **in place**, first occurrence wins, so a tile's tag order
 * is preserved and first-position selection cannot be perturbed by anything but
 * a rename of the winning root itself. On the 2 affected tiles the only texture
 * tag *is* the renamed one, so no tile changes which root wins.
 */

/**
 * Canonical spelling for a drifted namespace path, applied as a segment-boundary
 * prefix rewrite so a deeper tag under a retired spelling comes along with it
 * (`texture|foundations|x` → `texture|foundation|x`). None exists today; the
 * generality costs one line and removes a way for a future scan to reintroduce
 * the split under a sub-tag.
 *
 * Keyed by full namespace path rather than by bare root, because drift is not a
 * texture-only phenomenon (see {@link NOT_COLLAPSED}) and a bare-root table
 * would silently rewrite an unrelated namespace that reuses the word.
 */
export const TAG_ALIASES: readonly (readonly [retired: string, canonical: string])[] = [
  ['texture|foundations', 'texture|foundation'],
]

/**
 * The drift this deliberately leaves alone, with what it would cost.
 *
 * Documented in code rather than in a commit message because every one of them
 * is a candidate somebody will find again, and the answer is not obvious from
 * the strings. Counts are live blueprints carrying the tag.
 */
export const NOT_COLLAPSED: readonly {
  readonly tags: readonly string[]
  readonly counts: readonly number[]
  readonly reason: string
}[] = [
  {
    tags: ['texture|towne|stone-stucco', 'texture|towne|stucco-stone'],
    counts: [72, 72],
    reason:
      'Not a spelling. The two sets are a perfect 1:1 mirror over 72 shape keys — ' +
      'towne+stone-stucco#riser+high.2x1 and towne+stucco-stone#riser+high.2x1 sit in ' +
      'the same directory with different md5s and different byte sizes — so these are ' +
      '144 distinct models of the same geometry with the two courses swapped. The tint ' +
      'bug is real but it is a mapping bug: a one-colour-per-tile renderer cannot show ' +
      'a two-material wall in either order, so both now resolve to one family in ' +
      'src/materials/mapping.ts. The tag strings stay, and with them the config refs ' +
      'that name them.',
  },
  {
    tags: ['texture|towne|stone|stucco', 'texture|towne|stucco|stone'],
    counts: [7, 7],
    reason:
      'The same 1:1 mirror one level deeper (7 shape keys, distinct md5s), and the ' +
      'four-segment spelling of the pair above: `towne%stone+stucco` and ' +
      '`towne+stone-stucco` are the same authoring gesture through a different scanner ' +
      'branch. Rewriting either onto the other would also orphan it — each of these 14 ' +
      'tiles carries its own three-segment parent, and the corpus has 0 orphan texture ' +
      'children. Unified in the mapping instead, like the pair above.',
  },
  {
    tags: [
      'texture|towne|broken_stucco-a',
      'texture|towne|broken_stucco|a',
      'texture|towne|broken_stucco-b',
      'texture|towne|broken_stucco|b',
      'texture|towne|ruined_stucco-a',
      'texture|towne|ruined_stucco|a',
      'texture|towne|ruined_stucco-b',
      'texture|towne|ruined_stucco|b',
    ],
    counts: [43, 2, 43, 2, 1, 2, 1, 2],
    reason:
      'Genuine delimiter drift — `towne+broken_stucco-a` and `towne%broken_stucco+a` ' +
      'both mean sculpt variant "a" — but it buys nothing. A cosmetic variant letter ' +
      'carries no colour implication (mapping.ts maps none of them), both spellings ' +
      'already resolve to the same family and both already read as worn, and no facet ' +
      'is derived below level 2. Collapsing would churn the intern table and four ' +
      'search tokens to change no answer. Left as found.',
  },
  {
    tags: ['texture|cave', 'texture|cavern'],
    counts: [368, 39],
    reason:
      'Two words, not two spellings, and the corpus treats them as two textures: every ' +
      'one of the 39 cavern tiles is `texture|cavern|volcanic`, which mapping.ts gives ' +
      'its own roughness and grain. Collapsing would delete that override’s reach.',
  },
  {
    tags: ['texture|sewer', 'texture|legacy_sewers'],
    counts: [72, 29],
    reason:
      '`legacy_` is not a plural marker; it names a superseded generation of the sculpt, ' +
      'which is exactly the kind of thing a user filters on.',
  },
  {
    tags: ['texture|cut-stone'],
    counts: [965],
    reason:
      'A delimiter irregularity with no counterpart: this is the only hyphenated root, ' +
      'against 11 underscored ones (dungeon_stone, rough_stone, stone_brick, …). There ' +
      'is no `texture|cut_stone` tag to merge it with, so renaming it would collapse ' +
      'nothing, would break every saved link that selects it, and would break a real ' +
      'composition: `texture|cut-stone` is one of only four texture tags named by a ' +
      'config `require`/`deny` ref. Reported, not touched — note that the MaterialId ' +
      'it maps to IS spelled `cut_stone`, which is the mismatch that makes this look ' +
      'collapsible.',
  },
]

/**
 * The canonical spelling of one tag.
 *
 * Returns the input unchanged when nothing matches, which is the case for 914 of
 * the 916 tag strings in the corpus.
 */
export function normaliseTag(tag: string): string {
  for (const [retired, canonical] of TAG_ALIASES) {
    if (tag === retired) return canonical
    if (tag.startsWith(`${retired}|`)) return `${canonical}${tag.slice(retired.length)}`
  }
  return tag
}

/**
 * One blueprint's tag list, canonicalised.
 *
 * Order is preserved and the first occurrence of a canonical spelling wins, so
 * this cannot move a tag into or out of first position except by renaming the
 * tag that already held it. The de-duplication is a safety net rather than a
 * transform — no live row carries a repeated tag today, and no collapse in
 * {@link TAG_ALIASES} can merge two tags on one record — but a future alias that
 * can must not be able to smuggle a duplicate into the intern table.
 */
export function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const canonical = normaliseTag(tag)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    out.push(canonical)
  }
  return out
}
