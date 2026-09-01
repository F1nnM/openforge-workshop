/**
 * OpenForge Workshop — texture tag → material family.
 *
 * Ported from `docs/texture-materials.draft.ts`. Every count in the comments is
 * live blueprints carrying that tag, re-derived over the whole 8,702-row index;
 * all 38 root counts and all 25 sub-tag counts in the draft reproduce exactly.
 *
 * ── How many roots there are, and how many you can reach ────────────────────
 * **38 roots exist. 37 can appear in a record's `texture` field. All 38 are
 * mapped here.** Those are three different numbers and conflating them is how a
 * mapping ends up with a hole in it.
 *
 * `CatalogRecord.texture` is derived by PR 4's `textureRoot`, which takes the
 * root of the *first* texture tag on the tile. `texture|stucco` occurs on 24
 * tiles and every one of them also carries `texture|shingles`, which sorts
 * earlier, so `stucco` never wins that position — measured: 38 distinct roots
 * across all texture tags, 37 distinct roots in first position, and `stucco` is
 * the one that is never first.
 *
 * That is a fact about the derived field, not about the corpus. This module
 * resolves from a record's **full tag list**, where all 38 roots are reachable,
 * and `texture|stucco` resolves to `stucco` on exactly those 24 tiles because
 * `ROOT_PRECEDENCE` prefers the inset material. So:
 *
 *   - the root table below is complete at 38, because a root that cannot
 *     currently reach the `texture` field may reach it after any retag, and a
 *     hole would then surface as a wrong colour rather than a build failure;
 *   - `mapping.test.ts` asserts 38 mapped roots and 37 reachable-as-`texture`,
 *     separately, rather than asserting one number that is only half true.
 *
 * ── `foundation` vs `foundations` ───────────────────────────────────────────
 * PR 4 deliberately left this to PR 8: `texture|foundation` (51) and
 * `texture|foundations` (2) are distinct roots and almost certainly one
 * material, and collapsing them would take the root count 38 → 37. **The
 * material question is already answered — both map to `rough_stone`, so as an
 * appearance they are one material today.** Collapsing the *tag* is a facet
 * label question (it changes a user-visible filter count), which belongs to
 * whoever owns the facet list, not to a tint table. No collapse here.
 *
 * ── Divergence from `CatalogRecord.texture`, on purpose ─────────────────────
 * On the 80 tiles carrying two roots, this module's answer and the record's
 * `texture` field differ *by design* on all 80: `textureRoot` picks the design
 * family (first tag), `ROOT_PRECEDENCE` picks the inset material. A pool set
 * into a dungeon-stone floor should render as water. **Consumers must therefore
 * pass the record's full tag list**, not a reconstructed `` `texture|${texture}` ``,
 * or those 80 tiles lose the distinction that is the reason they exist.
 */
import type { Confidence, GrainSpec, MaterialId, MortarSpec, SurfaceTreatment } from './palette'

/* ------------------------------------------------------------- level-1 roots */

/**
 * All 38 level-1 texture roots, so root lookup never fails for a known tag.
 *
 * `%` and `+` in a filename both produce deeper tags, and the scanner's output
 * makes the two indistinguishable — `towne+stone` and `towne%stone` both yield
 * `texture|towne|stone`. Level 2 is therefore treated uniformly as "material
 * variant", never as "qualifier vs sub-texture".
 */
export const TEXTURE_ROOT_MATERIAL: Readonly<Record<string, MaterialId | undefined>> = {
  dungeon_stone: 'dungeon_stone', // 3130
  plain: 'plain', // 1235 — bases; "no surface sculpt", not a material
  'cut-stone': 'cut_stone', //  965
  towne: 'stucco', //  711 — a building SET; stucco is its dominant surface
  rough_stone: 'rough_stone', //  537
  cave: 'cave', //  368
  aztlan: 'aztlan', //  323
  wood: 'wood', //  169
  brick: 'brick', //  161
  streets: 'rough_stone', //  103 — a setting; sub-levels carry the material
  necro: 'necro', //   92
  stone_brick: 'cut_stone', //   84 — reads as dressed ashlar, not fired clay
  shingles: 'wood', //   82
  pool: 'water', //   82
  dwarven_halls: 'cut_stone', //   79 — precision ashlar; see FINISH_OVERRIDES
  sewer: 'sewer', //   72
  mine: 'cave', //   69 — hewn rock; its timber shoring is a separate part
  timber: 'wood', //   59
  stone: 'cut_stone', //   57 — orphaned by the `%` parse; dressed is the safe default
  foundation: 'rough_stone', //   51
  mortar_and_stone: 'rough_stone', //   40
  cavern: 'cave', //   39
  ironbound_wood: 'wood', //   35
  legacy_sewers: 'sewer', //   29
  tudor: 'stucco', //   29 — half-timbered; plaster dominates the area
  stucco: 'stucco', //   24 — never reaches `CatalogRecord.texture`; see the header
  large_brick: 'brick', //   18
  wrought_iron: 'metal', //   15
  metal: 'metal', //    9
  cracked_ice: 'ice', //    8
  goblin_fireplace: 'rough_stone', //    5 — a named prop, not a texture
  sandstone: 'sandstone', //    5
  foundations: 'rough_stone', //    2 — spelling split of `foundation`
  catacombs: 'cut_stone', //    2
  bamboo: 'wood', //    1
  calendar: 'aztlan', //    1 — carved relief motif, not a substance
  mosaic: 'aztlan', //    1
  trim: 'aztlan', //    1
}

/* --------------------------------------------------------- exact tag overrides */

/**
 * Exact-tag overrides, for the deeper tags whose sub-level names a DIFFERENT
 * substance from its root.
 *
 * Anything not listed inherits its root, so cosmetic sculpt variants (`|2`,
 * `|3`, `|a`…`|d`, `|fracture`, `|xenolith`, `|3-2_joint`) need no entries —
 * they carry no colour implication.
 */
export const TEXTURE_TAG_MATERIAL: Readonly<Record<string, MaterialId | undefined>> = {
  'texture|cave|sandstone': 'sandstone', // 247 (+ 259 qualifier carriers)
  'texture|cave|sandstone-aggregate': 'sandstone', //   5
  'texture|cave|aggregate': 'cave', // 117 — conglomerate; stays cave
  'texture|cavern|volcanic': 'cave', //  39

  'texture|towne|stone': 'cut_stone', // 154
  'texture|towne|stucco': 'stucco', // 154
  'texture|towne|wood': 'wood', //  75
  'texture|towne|long_planks': 'wood', //  35
  'texture|towne|broken_stucco': 'stucco', //   4
  'texture|towne|broken_stucco-a': 'stucco', //  43
  'texture|towne|broken_stucco-b': 'stucco', //  43
  'texture|towne|broken_stucco-c': 'stucco', //   1
  'texture|towne|broken_stucco-d': 'stucco', //   1
  'texture|towne|ruined_stucco': 'stucco', //  21
  'texture|towne|ruined_stucco-a': 'stucco', //   1
  'texture|towne|ruined_stucco-b': 'stucco', //   1

  // Hyphenated pairs encode a genuinely TWO-material wall (stone base course,
  // stucco above, or the reverse) in a single mesh. First-named wins: it is a
  // deterministic coin-flip on 144 models, and it is honestly wrong on ~half.
  // The four-segment forms `texture|towne|stone|stucco` (7) and
  // `texture|towne|stucco|stone` (7) need no entry — they inherit the same
  // first-named answer from their parent, and no tile carries both (verified).
  'texture|towne|stone-stucco': 'cut_stone', //  72
  'texture|towne|stucco-stone': 'stucco', //  72

  'texture|streets|cobble': 'rough_stone', //  62
  'texture|streets|fan_cobble': 'rough_stone', //  11
  'texture|streets|brick_sidewalk': 'brick', //  17
  'texture|streets|mud': 'rough_stone', //  13 — no earth family; brown-grey is closest

  'texture|sewer|sewer_brick': 'sewer', //  26 — brick by substance, sewer by context
}

/* ------------------------------------------------------------ multiple roots */

/**
 * When a blueprint carries more than one texture ROOT (80 live blueprints,
 * 0.92%), the **lower precedence number wins**. The rare inset material is
 * always the distinguishing feature — the reason the tile exists — so it takes
 * the tile.
 *
 * Covers every multi-root pair in the catalog, and there are only three:
 *   dungeon_stone + pool          (48) → water     — a pool set into a stone floor
 *   shingles + stucco             (24) → stucco    — dormer with stucco cheeks
 *   shingles + stone_brick         (8) → cut_stone
 *
 * Sorting by global tag frequency instead would get `shingles + stone_brick`
 * wrong (82 vs 84), which is why this is authored rather than derived. Ties
 * break alphabetically, so the answer never depends on tag order.
 */
export const ROOT_PRECEDENCE: Readonly<Record<string, number | undefined>> = {
  pool: 10,
  stucco: 20,
  stone_brick: 20,
  shingles: 60,
  dungeon_stone: 90,
}

export const DEFAULT_ROOT_PRECEDENCE = 50

/* ------------------------------------------------------------------- finishes */

/**
 * Finish overrides change the material RESPONSE for a tag without spending a
 * colour on it — the cheapest way to distinguish surfaces that are the same
 * substance at a different finish, in a palette whose colour budget is fully
 * committed.
 */
export interface FinishOverride {
  readonly roughness?: number
  readonly metalness?: number
  readonly surface?: SurfaceTreatment
  readonly grain?: GrainSpec | null
  readonly mortar?: MortarSpec | null
}

export const FINISH_OVERRIDES: Readonly<Record<string, FinishOverride | undefined>> = {
  // Precision dwarven ashlar: same stone, machined finish.
  'texture|dwarven_halls': { roughness: 0.55, grain: { scale: 3.6, amplitude: 0.035 } },
  // Hewn passage rock, coarser than a natural cave wall.
  'texture|mine': { roughness: 0.99, grain: { scale: 0.8, amplitude: 0.2 } },
  'texture|cavern|volcanic': { roughness: 0.99, grain: { scale: 0.7, amplitude: 0.22 } },
  // Roof shingles: wood, but courses rather than plank grain.
  'texture|shingles': { roughness: 0.9, grain: { scale: 1.0, amplitude: 0.14 } },
  'texture|ironbound_wood': { roughness: 0.72 },
  'texture|towne|long_planks': { grain: { scale: 0.4, amplitude: 0.13 } },
  // Ashlar-sized brick courses.
  'texture|stone_brick': {
    surface: 'noise+mortar',
    mortar: { scale: 1.8, width: 0.07, darken: 0.26 },
  },
  'texture|large_brick': { mortar: { scale: 1.4, width: 0.08, darken: 0.28 } },
  'texture|legacy_sewers': { roughness: 0.9 },
  // Carved relief motifs: polished against their surround.
  'texture|mosaic': { roughness: 0.7 },
  'texture|calendar': { roughness: 0.7 },
  'texture|trim': { roughness: 0.7 },
  'texture|tudor': { roughness: 0.86 },
}

/* ----------------------------------------------------------------- confidence */

/**
 * Per-tag confidence downgrades — the judgement calls that belong to the TAG
 * rather than to the family it lands in. Everything unlisted inherits its
 * family's confidence.
 *
 * These are the rows to argue about first, which is the point of publishing
 * them: `Resolution.confidence` lets a caller distinguish "this is dungeon
 * stone" from "this is our best guess at a half-timbered wall".
 */
export const TAG_CONFIDENCE: Readonly<Record<string, Confidence | undefined>> = {
  'texture|stone': 'low', //  57 — orphaned by `%`; ambiguous dressed vs rough
  'texture|stone_brick': 'medium', //  84 — filed as ashlar; arguably fired brick
  'texture|tudor': 'low', //  29 — half-timbered: two materials by definition
  'texture|shingles': 'medium', //  82 — wood assumed; could be clay or slate
  'texture|mine': 'medium', //  69 — hewn rock, but timber-shored
  'texture|goblin_fireplace': 'low', //   5 — a named prop, not a texture at all
  'texture|bamboo': 'low', //   1 — orphaned Aztlan sub-texture
  'texture|streets|mud': 'low', //  13 — no earth family exists; brown-grey is the nearest
  'texture|sewer|sewer_brick': 'low', //  26 — brick by substance, sewer by context
  'texture|towne|stone-stucco': 'low', //  72 — two materials in one mesh
  'texture|towne|stucco-stone': 'low', //  72
  'texture|towne|stone|stucco': 'low', //   7
  'texture|towne|stucco|stone': 'low', //   7
}

/* ----------------------------------------------------------------------- wear */

/**
 * Wear qualifiers, detected on any tag component below the root.
 *
 * They move roughness and grain, never colour — see `palette.ts` for the
 * measurement that forced that.
 *
 * The rule: `ruined` / `eroded` exact, `broken_stucco*` / `ruined_stucco*` by
 * prefix, matched on **any** component below the root of a `texture|` tag.
 * 18 distinct tags carry one.
 *
 * Two counts, and they are not the same count:
 *
 *   - **1,562 tiles (17.9%)** carry a wear tag on some texture tag.
 *   - **1,538 tiles (17.7%)** actually *resolve* worn — the figure
 *     architecture-plan.md §9 quotes.
 *
 * The 24-tile gap is the `pool` + `dungeon_stone|eroded` set: the pool root
 * wins on precedence, so the eroded stone surround's wear tag is out of scope
 * for the material that renders. Correct, and not a rounding artefact — wear on
 * a `water` surface would have nothing to act on anyway, since it carries no
 * grain and a roughness of 0.15. `corpus.test.ts` asserts both numbers, so
 * neither can quietly become the other.
 */
export const WEAR_EXACT: ReadonlySet<string> = new Set(['ruined', 'eroded'])
export const WEAR_PREFIXES: readonly string[] = ['broken_stucco', 'ruined_stucco']

/* ------------------------------------------------------- no texture tag at all */

/**
 * The 89 live blueprints (1.0%) with no texture tag are not a random remainder
 * — they are the insert/accessory population: grates, torch hardware, mine
 * beams, statues, log piles, window inserts. A neutral default would render an
 * iron portcullis identically to a stone wall, so they get a part-tag chain
 * before the terminal `unknown`.
 *
 * Ordered: first match wins.
 */
export const PART_FALLBACK: readonly (readonly [string, MaterialId])[] = [
  ['part|grate', 'metal'],
  ['part|torch', 'wood'],
  ['scatter|statue', 'cut_stone'],
  ['scatter|mine|beam', 'wood'],
  ['scatter|log', 'wood'],
  ['part|support_block', 'wood'],
  ['part|window_insert', 'wood'],
]

/**
 * Filename hints, consulted **before** the part chain because they disambiguate
 * *inside* a single part tag: `part|torch` covers both the wooden torch and its
 * iron `torch_plate`, and `part|grate` covers the iron `grate.flange`.
 *
 * Ordered: first substring match wins, so `torch_plate` must precede `plate`.
 */
export const FILENAME_HINTS: readonly (readonly [string, MaterialId])[] = [
  ['torch_plate', 'metal'],
  ['plate', 'metal'],
  ['flange', 'metal'],
]
