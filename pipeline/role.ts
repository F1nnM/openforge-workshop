/**
 * Role and form — the two derived axes a template slot predicates on.
 *
 * ## Why a derived role exists at all
 *
 * Because the raw `shape|` tags are not a predicate. Measured over the live
 * 8,702-record corpus:
 *
 *   - **`shape|wall` is carried by 4,881 records and 238 of them are not walls**
 *     — 176 floors, 54 columns, 8 stairs. On a floor, a base or a column the tag
 *     means *"I belong to a wall run"* (a wall-thickness strip along the wall
 *     line), not *"I am a wall"*. `tiles/aztlan/floors/floor/openforge/aztlan#floor.AS.openforge.stl`
 *     carries `shape|floor shape|wall` with `foot: {shape:'wall', length:2}`.
 *   - **527 of 527 `shape|wall|low` records omit the parent `shape|wall`.** The
 *     child *is* the role tag there.
 *   - **459 records carry no `shape|` tag at all**, and the **100 roof records
 *     are named by no `shape|` root in the taxonomy** — `shape|roof` has zero
 *     occurrences corpus-wide.
 *   - **`component|` names a feature, not a role: 357 of 3,833 disagree** with
 *     the shape tags (`#wall,drain`, `#wall,slope`, `#wall,grate`), so it is a
 *     fallback-only channel and any rung that reads it while a shape tag exists
 *     is wrong on all 357.
 *
 * So a slot that requires `shape|wall` admits 41 `column+low` files and 8
 * foundation stairs — which the 40 shipped recipes demonstrably do today. A slot
 * that requires `role|wall` does not. That is the whole reason this file exists.
 *
 * ## Two axes, not one
 *
 * The corpus's shape vocabulary conflates *what a piece is* with *what shape it
 * is*, and the discriminator is co-occurrence: `shape|square` sits on 3,709
 * records and **never** appears without wall, base, floor or corner beside it,
 * and `shape|corner` carries a role root on 492 of 671. So corner, curve,
 * diagonal, hex and octagon are **modifiers of a role**, not roles, and they get
 * their own axis:
 *
 * | `role` | records | | `form` | records |
 * | --- | ---: | --- | --- | ---: |
 * | wall | 5,381 | | straight | 5,707 |
 * | floor | 2,162 | | curve | 1,989 |
 * | riser | 319 | | corner | 720 |
 * | insert | 285 | | diagonal | 163 |
 * | column | 223 | | hex | 56 |
 * | stair | 206 | | internal_corner | 39 |
 * | roof | 100 | | octagon | 28 |
 * | decor | 26 | | | |
 *
 * **8,702 of 8,702 classify and 0 come out `unknown`** — 7,413 high confidence
 * (85.2%), 1,246 medium, 43 low. `pipeline/catalog.test.ts` pins all of it.
 *
 * `layer` is the third axis and it already ships (`facets.ts#classifyLayer`).
 * All three are needed: drop `form` and `wall|corner|s2w` (380 records) merges
 * into `wall|s2w` (49) so the s2w corner recipe's left/right wall slots start
 * admitting straight walls; drop `layer` and the `base` slot becomes
 * inexpressible.
 *
 * ## `role` is orthogonal to `layer`, and a base's role is what it carries
 *
 * A base *for a wall* has `role: 'wall', layer: 'base'`. That is exactly what
 * the fixtures mean when a base slot requires `shape|base|wall`, and it is what
 * makes a base slot expressible as
 * `layer === 'base' && role === <the topper's role> && size congruent`.
 *
 * Adding a `base` *role* instead would make role redundant with layer on 22.6%
 * of the corpus and lose the useful fact. The split validates: over the 40
 * shipped recipes the base slot is role-pure `floor` on **20 of 20** Single
 * Piece recipes and role-pure `wall` on **20 of 20** Modular ones, with no
 * exception in either direction — a single-piece wall is one mesh containing the
 * wall *and* its floor, so it sits on a plain floor base.
 *
 * ## `role === 'insert'` carries no information — do not predicate on it
 *
 * It is a **perfect bijection with `layer === 'insert'`**: the same 285 records,
 * because both are `has(tags, 'part|')`. It is emitted for enum totality so that
 * every record carries exactly one `role|` tag and the axis is total rather than
 * partial — but **no slot should require `role|insert`. Read `layer` instead.**
 * `pipeline/catalog.test.ts` asserts the bijection, so if a future scan drops
 * `part|` the collapse is loud: no other channel recovers insert (path,
 * component and filename reproduce it on 84 of 285, because an insert is filed
 * in its *host's* folder).
 *
 * ## The ladder is hand-authored and every rung is measured
 *
 * `pipeline/catalog.test.ts`'s holdout block learns the path / component /
 * filename predictors from the subset the shape tags label outright (7,756
 * records) and scores them by 5-fold holdout against that label:
 * **7,397 of 7,471 non-insert records, 99.01%**. Two findings from getting there
 * are load-bearing and are pinned as ablations there:
 *
 *   - **Path depth is the signal, not the segment.** Depth 1 is the texture
 *     family, depth 2 is the *build system* (`separate_wall` on 3,466 records,
 *     `wall_on_tile`, `thick_wall`, `s_system`, `s2w`), and only depth 3 and
 *     below name a role folder. Reading segments depth-agnostically makes
 *     `separate_wall` the corpus's single strongest "wall" predictor and takes
 *     the non-insert holdout from 74 errors to 368.
 *   - **The deepest segments are joinery.** {@link JOINERY} sits at depths 4-7,
 *     and a deepest-wins rule reads it first. Stoplisting it moved the holdout
 *     from 96.89% to 99.01%.
 *
 * Where this file departs from what a learner would produce it is because the
 * residual contains roles the tag vocabulary never names — `roof` and `decor`
 * have no `shape|` root — so a learner trained on the tags cannot predict them
 * by construction. It predicts `insert` for 64 of the 100 roofs, because the
 * only *labelled* records under `tiles/building_facades/roof/` are the
 * `window_insert` and `support_block` parts. That is the strongest single
 * argument for a hand-authored ladder over a learned one.
 *
 * ## The residual is named rather than rounded away
 *
 * There is no unclassifiable residual, but there is a 43-record low-confidence
 * tail and a set of genuinely ambiguous classes. **None of these is fixed here;
 * they belong upstream in the fixtures:**
 *
 * | class | records | assigned | why it is not certain |
 * | --- | ---: | --- | --- |
 * | bare thick-wall bases (`plain#base,thick_wall.1x1`) | 40 | `wall` | inferred from `build\|thick wall`, whose corpus is walls; the base names no support |
 * | yawning-portal facade bases | 2 | `floor` | **believed outright wrong** — their own filename says `base,wall+portal`, but they carry no shape tag the ladder can read |
 * | combined s2w cells (`#corner+both+right+left,grate+widened.2x2`) | 30 | `wall` | **genuinely both**: a 2x2 rect carrying the corner wall *and* its floor, with neither `shape\|wall` nor `shape\|floor` present |
 * | foundation stair edges (`brick#foundation,stairs+edge,a.BA`) | 8 | `stair` | carries `shape\|stairs` **and** `shape\|wall`; the fixtures admit all 8 as walls |
 * | wall columns (`rough_stone#column+low.I`) | 54 | `column` | carries `shape\|column` **and** `shape\|wall`; the fixtures admit 41 as walls |
 * | mine beams (`mine#beam+a`) | 4 | `decor` | arguably an insert with no `part\|` tag |
 * | hex / 120-degree pieces | 56 | `wall` (form `hex`) | role is confident; they have **no derivable grid size at all** and no square-lattice position, so a wall slot must not admit them |
 *
 * The last two rows of the ambiguous set are where the inference *disagrees with
 * the shipped fixtures*, and the direction matters: all 59 disagreements over
 * the 40 recipes' 8,564 role-bearing candidate slots are **over-admissions the
 * inference catches**, never under-admissions. `pipeline/catalog.test.ts`
 * asserts that direction, because a disagreement the other way is a regression.
 */
import type { Footprint } from '../src/catalog'

import { hasTagSegment, namespaceRoots } from './tags'

/**
 * The slot kind. Eight values, closed.
 *
 * Ordered by corpus frequency, which is also the order the emitted tag ids fall
 * into: `role|wall` is the single most frequent tag in the corpus at 5,381
 * references, ahead of `connection|openforge`'s 4,363, so `buildTagTable`'s
 * descending-frequency ordering gives it **id 0** and a one-digit reference on
 * every record that carries it. That is most of why the encoding is cheap.
 */
export const ROLES = ['wall', 'floor', 'riser', 'insert', 'column', 'stair', 'roof', 'decor'] as const

/**
 * The slot geometry. Seven values, closed.
 *
 * Half of what a one-axis taxonomy would have called roles lives here: `low` is
 * a height modifier (527 records, all of them role `wall`), `left`/`right` is
 * chirality (448 records, 370 of them role `wall`), and curve, diagonal, corner
 * and hex are shapes a wall, a floor, a stair or a roof can all take.
 */
export const FORMS = [
  'straight',
  'curve',
  'corner',
  'diagonal',
  'hex',
  'internal_corner',
  'octagon',
] as const

/**
 * `unknown` is in the union so the ladder is a **total function** with no
 * throwing branch, not because the corpus needs it: 0 of 8,702 records reach it.
 * Keeping it means a corpus that stops classifying emits `role|unknown`, which
 * lands in the tag table and fails the emitted-vocabulary assertion loudly,
 * rather than throwing inside the importer or silently taking a neighbour's
 * role.
 */
export type Role = (typeof ROLES)[number] | 'unknown'

export type Form = (typeof FORMS)[number]

/** Which rung fired, ordered by descending trust. Reported, never emitted. */
export type Signal =
  | 'part-tag'
  | 'interface-tag'
  | 'shape-primary'
  | 'shape-base-support'
  | 'shape-corner'
  | 'component-tag'
  | 'build-tag'
  | 'scatter-tag'
  | 'path'
  | 'filename'
  | 'none'

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface Inferred {
  readonly role: Role
  readonly form: Form
  readonly signal: Signal
  readonly confidence: Confidence
}

/**
 * What the ladder reads. Deliberately **not** a `CatalogRecord`.
 *
 * The classifier runs inside {@link import('./build').buildCatalog} *before* the
 * intern table is built — it has to, because its output is two of the tags the
 * table interns — so it cannot take a record. It takes the four things it
 * actually reads, three of which the build has already derived at that point:
 * the normalised tag list, the resolved footprint, the build system, and the
 * catalog path split into its directory and its basename.
 */
export interface RoleInput {
  /** `normaliseTags(row.tags)`, canonical spellings only. */
  readonly tags: readonly string[]
  /** `resolveFootprint(tags)`. Read for `arc` and `diag`, which name a form. */
  readonly foot: Footprint
  /** `dirname(id)` — the catalog folder, depth-namespaced by {@link pathRole}. */
  readonly family: string
  /** `basename(id)` — the filename, tokenised by {@link fileTokens}. */
  readonly file: string
  /** `buildSystem(tags)`. Absent on 34.2% of the corpus. */
  readonly build?: string
}

/* --------------------------------------------------------------- vocabulary */

/**
 * Roof-family subjects. **No `shape|` root names any of them** — `shape|roof`
 * has zero occurrences — so `component|{roof,gable,eaves,dormer}` (plus
 * `set|roofs`, which is not read) is the only signal for all 100 roof records.
 */
const ROOF_COMPONENTS = new Set(['roof', 'gable', 'eaves', 'dormer'])

/** Subjects that are a free-standing pillar rather than a wall feature. */
const COLUMN_COMPONENTS = new Set(['full_pillar', 'pillar', 'plinth'])

/** Subjects that are loose scatter rather than architecture. */
const DECOR_COMPONENTS = new Set(['spirit'])

/**
 * Subjects that live **on a floor**.
 *
 * The complement is the point: everything else in `component|` is either a wall
 * feature or a wall itself. Measured over the 3,833 records carrying both a
 * component root and a role-bearing shape tag, `component|drain` (107),
 * `grate` (46), `trap` (12) and `slope` (10) sit on records the shape tags call
 * **walls** — a wall with a drain cut through it — so the intuitive "a drain is
 * a floor thing" mapping is wrong on all 175.
 */
const FLOOR_COMPONENTS = new Set([
  'manhole',
  'edge_manhole',
  'gutter',
  'edge_gutter',
  'pool',
  'bubbling_pool',
  'sluice',
  'tracks',
  'curb',
  'fountain',
  'variant_floor',
  'infinite_hallway',
  'phone_portal',
])

/**
 * Path segments that name a role folder, deepest-wins.
 *
 * Only depth 3 and below reach here in practice, because depth 1 is the texture
 * family and depth 2 is the build system — and the build system is a trap:
 * `separate_wall` sits on 3,466 records of every role, so reading it as "wall"
 * is the single largest error source any depth-agnostic reading has.
 */
const PATH_ROLE: readonly (readonly [RegExp, Role])[] = [
  [/^(stairs?)$/, 'stair'],
  [/^(risers?|platform)$/, 'riser'],
  [/^(columns?|full_pillar)$/, 'column'],
  [/^(roof|eaves|gable|dormer|shingles)$/, 'roof'],
  [/^(treasure_bits|scatter|statues?)$/, 'decor'],
  [/^(primary_floors?|floors?|floor)$/, 'floor'],
  [
    /^(primary_walls?|curved_walls?|angled_walls?|wooden_walls?|walls?|wall|corners?|foundations?|outcrops?|sentinels?|cave_entrance|loculus|alcove|archway|niche|portcullis|arrow_slit|drain|torch|doors?|windows?|grates?|boss_door|secret_door)$/,
    'wall',
  ],
]

/**
 * The joinery vocabulary, which is what the **deepest** path segments name.
 *
 * These sit at depths 4-7 (`…/primary_walls/column+low/openlock/`), so a
 * deepest-wins path rule reads them before it reads anything about the role.
 * `openlock` at depth 5 alone accounted for 137 of the 231 holdout errors that
 * existed before this stoplist; adding it moved the non-insert holdout from
 * 96.89% to 99.01%.
 */
const JOINERY = new Set([
  'openlock',
  'openforge',
  'dragonlock',
  'magnetic',
  'side',
  'pegs',
  'flex',
  'unsupported',
  'topless',
  'filament',
  'split',
  'dual',
  'bottom',
  'widened',
])

/** A segment every one of whose comma/plus-joined words is joinery. */
function isJoinery(segment: string): boolean {
  return segment.split(/[,+]/).every((word) => JOINERY.has(word.trim()))
}

/**
 * The deepest non-joinery path segment that names a role, or `undefined`.
 *
 * The leading `tiles/` segment is dropped before the walk — it is on every
 * record and names nothing.
 */
function pathRole(family: string): Role | undefined {
  const segments = family.split('/').slice(1)
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment === undefined || isJoinery(segment)) continue
    for (const piece of [segment, ...segment.split(/[#%+,]/)]) {
      for (const [pattern, role] of PATH_ROLE) if (pattern.test(piece)) return role
    }
  }
  return undefined
}

/**
 * The filename's *shape section*, tokenised.
 *
 * A corpus filename is `texture%accent#shape,modifier+qualifier.size.joinery.stl`
 * — so the tokens worth reading are the ones after the `#` and before the first
 * `.`. Taking the whole stem instead would read the joinery suffix, which is the
 * same trap {@link JOINERY} closes on the path channel.
 */
export function fileTokens(file: string): string[] {
  const stem = file.replace(/\.stl$/i, '')
  const head = stem.split('.')[0] ?? ''
  const hash = head.indexOf('#')
  const section = hash < 0 ? head : head.slice(hash + 1)
  return [...new Set(section.split(/[,+%]/).filter(Boolean))]
}

/** Filename tokens that name a role. Last resort, and low confidence by design. */
const FILE_ROLE: Readonly<Record<string, Role>> = {
  stairs: 'stair',
  riser: 'riser',
  platform: 'riser',
  column: 'column',
  full_pillar: 'column',
  roof: 'roof',
  gable: 'roof',
  eaves: 'roof',
  dormer: 'roof',
  statue: 'decor',
  treasure: 'decor',
  treasure_bits: 'decor',
  floor: 'floor',
  wall: 'wall',
}

/* --------------------------------------------------------------------- form */

/**
 * The geometry axis.
 *
 * Most specific first, and the order is forced: `internal_corner` before
 * `corner` (two of the four internal-corner *templates* are themselves
 * mis-tagged `shape|corner`, which is row B6's correction, and 39 records spell
 * it as a trailing segment), `hex` before `corner` (48 hex bases are tagged
 * `shape|base|hex` *and* carry a corner), and `corner` before `curve` (a
 * `shape|corner` piece with a radius is a corner, not an arc).
 *
 * `foot.shape` contributes exactly two cases — `arc` and `diag` — and both are
 * measurements rather than tags, which is the only place `foot` is independent
 * evidence about anything (it is otherwise derived *from* the tags, exactly on
 * all 3,449 `rect` records).
 */
export function inferForm(input: RoleInput): Form {
  const tags = input.tags
  if (tags.some((tag) => tag.endsWith('|internal_corner')) || tags.includes('shape|corner|internal'))
    return 'internal_corner'
  if (fileTokens(input.file).includes('internal_corner')) return 'internal_corner'
  if (hasTagSegment(tags, 'shape|hex') || tags.includes('shape|base|hex')) return 'hex'
  if (tags.includes('shape|angled|octagon')) return 'octagon'
  if (
    input.foot.shape === 'diag' ||
    tags.includes('shape|angled|right') ||
    tags.includes('component|diagonal')
  )
    return 'diagonal'
  if (hasTagSegment(tags, 'shape|corner') || tags.some((tag) => tag.endsWith('|corner'))) return 'corner'
  if (
    input.foot.shape === 'arc' ||
    hasTagSegment(tags, 'shape|curved') ||
    hasTagSegment(tags, 'shape|concave') ||
    hasTagSegment(tags, 'shape|convex') ||
    hasTagSegment(tags, 'shape|radial') ||
    tags.some((tag) => /\|(curved|concave|convex|radial)$/.test(tag))
  )
    return 'curve'
  return 'straight'
}

/* --------------------------------------------------------------- the ladder */

/**
 * One record's role and form.
 *
 * An ordered ladder, and **the precedence `stair > column > riser > floor >
 * wall` is forced by the data rather than chosen.** It is the only order that
 * survives the overlaps, all of which are real records:
 *
 * | overlap | records | role | why |
 * | --- | ---: | --- | --- |
 * | `shape\|floor` + `shape\|wall` | 177 | floor | `aztlan#floor+s2w+wall.2x2` is the *floor* of a wall assembly |
 * | `shape\|base` + `shape\|wall` | 906 | wall | `brick#base+foundation.A` is a wall base |
 * | `shape\|column` + `shape\|wall` | 54 | column | `aztlan#column+low.col+I` is a pillar in a wall run |
 * | `shape\|stairs` + `shape\|wall` | 8 | stair | `brick#foundation,stairs+edge,a.BA` |
 * | `shape\|base` + `shape\|riser` | 176 | riser | `plain#base+square+riser` |
 * | `shape\|column` + `shape\|floor` + `shape\|wall` | 1 | column | |
 *
 * Rung by rung, with what each contributes over the whole corpus:
 *
 * | rung | signal | records | confidence |
 * | ---: | --- | ---: | --- |
 * | 1 | `part\|` → insert | 285 | high |
 * | 2 | the shape roots that name a role outright | 6,905 | high |
 * | 3 | `shape\|base` + what it supports | 701 | high / medium / low |
 * | 4 | `component\|` root | 580 | high / medium |
 * | 5 | `shape\|corner` with no role root → wall | 164 | medium |
 * | 6 | `build\|` (s-system and thick-wall bases) | 40 | low |
 * | 7 | `scatter\|` → decor | 26 | high / medium |
 * | 8 | the catalog path | 1 | low |
 * | | **total** | **8,702** | high 7,413 · medium 1,246 · low 43 · none 0 |
 */
export function inferRole(input: RoleInput): Inferred {
  const tags = input.tags
  const form = inferForm(input)
  const out = (role: Role, signal: Signal, confidence: Confidence): Inferred => ({
    role,
    form,
    signal,
    confidence,
  })

  /* 1. `part|` is an insert, by the same rule `classifyLayer` uses. 285 of 285,
        and the bijection with `layer === 'insert'` is asserted, not assumed. */
  if (hasTagSegment(tags, 'part')) return out('insert', 'part-tag', 'high')

  /* 2. The shape roots that name a role outright, in the forced order above. */
  if (hasTagSegment(tags, 'shape|stairs')) return out('stair', 'shape-primary', 'high')
  if (hasTagSegment(tags, 'shape|column')) return out('column', 'shape-primary', 'high')
  if (hasTagSegment(tags, 'shape|riser')) return out('riser', 'shape-primary', 'high')
  if (hasTagSegment(tags, 'shape|floor')) return out('floor', 'shape-primary', 'high')
  if (hasTagSegment(tags, 'shape|wall')) return out('wall', 'shape-primary', 'high')

  /**
   * 3. A base with no primary co-root carries the role of **what sits on it**.
   *
   * The 1,963 bases split wall 1,117 / floor 661 / riser 176 / stair 9, and the
   * rungs below fire in order and sum to exactly that. §4.2's 20/20 + 20/20
   * base-slot result is the validation of this block specifically.
   */
  if (hasTagSegment(tags, 'shape|base')) {
    if (tags.includes('shape|base|stairs')) return out('stair', 'shape-base-support', 'high')
    if (tags.includes('shape|base|wall') || tags.includes('shape|base|foundation'))
      return out('wall', 'shape-base-support', 'high')
    /* `shape|base|s-system` and `shape|base|s2w` (87 between them) are bases for
       a wall *system*, so they carry a wall. Medium: the base itself says only
       which system, not which piece. */
    if (tags.includes('shape|base|s-system') || tags.includes('shape|base|s2w'))
      return out('wall', 'shape-base-support', 'medium')
    if (
      tags.includes('shape|base|corner') ||
      tags.includes('shape|base|internal_corner') ||
      tags.includes('shape|base|hex')
    )
      return out('wall', 'shape-base-support', 'medium')
    if (
      tags.includes('shape|base|square') ||
      tags.includes('shape|base|curved') ||
      tags.includes('shape|base|angled') ||
      tags.includes('shape|base|concave') ||
      tags.includes('shape|base|convex') ||
      tags.includes('shape|base|radial') ||
      tags.includes('shape|base|grid') ||
      tags.includes('shape|base|inverted') ||
      tags.includes('shape|base|hallway') ||
      tags.includes('shape|base|electronics') ||
      tags.includes('shape|base|phone_portal')
    )
      return out('floor', 'shape-base-support', 'medium')
    if (hasTagSegment(tags, 'shape|corner')) return out('wall', 'shape-corner', 'medium')
    /* The 40 bare `plain#base,thick_wall.1x1` bases name no support at all.
       Both build systems they sit under have an all-wall corpus, which is the
       whole of the evidence — hence `low`, and hence the entry in this file's
       residual table. */
    if (input.build === 's-system' || input.build === 'thick wall')
      return out('wall', 'build-tag', 'low')
    const fromPath = pathRole(input.family)
    if (fromPath !== undefined) return out(fromPath, 'path', 'low')
    /* The 2 yawning-portal bases, and this file believes they are wrong: their
       own filename reads `base,wall+portal`. Named rather than fixed — the fix
       is a shape tag upstream. */
    return out('floor', 'shape-base-support', 'low')
  }

  /* 4. Roles the shape vocabulary never names at all. */
  const components = namespaceRoots(tags, 'component')
  for (const component of components)
    if (ROOF_COMPONENTS.has(component)) return out('roof', 'component-tag', 'high')
  if (pathRole(input.family) === 'roof') return out('roof', 'path', 'medium')
  for (const component of components)
    if (COLUMN_COMPONENTS.has(component)) return out('column', 'component-tag', 'high')
  /* A structural wall carrying a statue is a wall, not scatter — one record
     (`dungeon_stone#wall,secret_door+tamoachan_statue.2x`) carries both
     `component|wall` and `scatter|statue` and no `shape|` tag at all — so the
     wall test has to come before the scatter one. */
  if (components.includes('wall') || fileTokens(input.file).includes('wall'))
    return out('wall', 'component-tag', 'medium')
  if (hasTagSegment(tags, 'scatter')) return out('decor', 'scatter-tag', 'high')
  for (const component of components)
    if (DECOR_COMPONENTS.has(component)) return out('decor', 'component-tag', 'medium')
  /* `decoration|` is **not** a decor signal on its own: 164 records carry one and
     only 12 reach here — the other 152 are symbols, knotwork, bells and reliefs
     carved *into* a floor (80), a wall (34) or an insert (38). */
  if (hasTagSegment(tags, 'decoration') && components.length === 0 && !hasTagSegment(tags, 'shape'))
    return out('decor', 'scatter-tag', 'medium')

  /* 5. An `interface|` tag with no shape, no grid footprint and no component of
        its own is a thing that fits into another thing — an insert the fixtures
        forgot to give a `part|` tag. */
  if (
    hasTagSegment(tags, 'interface') &&
    !hasTagSegment(tags, 'shape') &&
    input.foot.shape === 'none' &&
    components.length === 0
  )
    return out('insert', 'interface-tag', 'medium')

  /* 6. `shape|corner` alone is a wall corner: an s2w corner *floor* is tagged
        `shape|floor|corner`, so a bare corner is the wall half. */
  if (hasTagSegment(tags, 'shape|corner')) return out('wall', 'shape-corner', 'medium')

  /* 7. The component subject, then the build system, then the path, then the
        filename — the fallback-only channels, in descending trust. */
  for (const component of components)
    if (FLOOR_COMPONENTS.has(component)) return out('floor', 'component-tag', 'medium')
  if (components.length > 0 && (input.build !== undefined || hasTagSegment(tags, 'shape')))
    return out('wall', 'component-tag', 'medium')
  const fromPath = pathRole(input.family)
  if (fromPath !== undefined) return out(fromPath, 'path', 'low')
  for (const token of fileTokens(input.file)) {
    const role = FILE_ROLE[token]
    if (role !== undefined) return out(role, 'filename', 'low')
  }
  if (components.length > 0) return out('wall', 'component-tag', 'low')
  return out('unknown', 'none', 'none')
}

/**
 * The two tags a record carries for its axes, in emission order.
 *
 * **This is the whole persistence decision.** Six encodings were considered — as
 * interned tags, as a side table of base-36 codes, as integer-code fields, as
 * plain string fields, as posting lists, and derived in the browser. The tag
 * encoding wins, and the reason is structural rather than a matter of size:
 *
 *   1. **A slot predicates with the grammar that already exists.**
 *      `src/composition/candidates.ts` builds a CSR inverted index over the tag
 *      table and `PartSlot.tags.require` is a list of `{tag}` refs, resolved by
 *      exact equality. `require: [{ tag: 'role|wall' }]` therefore needs **zero
 *      new code** — no predicate type, no parallel lookup, no schema field, no
 *      change to `resolveSlotTags`. Every other encoding needs a second
 *      resolution path beside the postings walk.
 *   2. **The two commonest values get the two cheapest ids.** `role|wall`'s
 *      5,381 references make it the corpus's most frequent tag, so it takes id
 *      0; `role|floor` lands 9th. That is why 17,404 new references cost 865 B.
 *   3. **It is build-time checkable**, which the browser-derived alternative is
 *      not. The role distribution is an assertion in `pipeline/catalog.test.ts`,
 *      so a corpus rescan that moves 5,381 walls fails the build instead of
 *      silently changing what every template admits.
 *
 * The price of (1), stated: tag references go 84,023 → 101,427, so
 * `candidates.ts`'s `docs` `Int32Array` grows from 336,092 B to 405,708 B of
 * **memory** — not payload — and `offsets` by 64 B.
 *
 * Order is `role` then `form`, and it is fixed so that two runs over identical
 * input produce identical tag lists.
 */
export function roleTags(inferred: Inferred): [role: string, form: string] {
  return [`role|${inferred.role}`, `form|${inferred.form}`]
}
