/**
 * The 40 upstream recipes, folded to 10 templates and three control axes.
 *
 * **Pure, and no I/O.** It takes the fixtures exactly as
 * `pipeline/templates.ts#loadTemplateFixtures` parses them and returns data. The
 * 20-file byte round-trip that proves the reader lost nothing is untouched, and
 * `RECIPE_TEMPLATES` still ships the faithful 40 beside what this emits.
 *
 * ## What is duplicated, measured on the fixtures
 *
 * Diffed part by part — slot names, `require`, `deny`, `constrain`, `fulfills` —
 * **32 of the 40 are one template**. `Arched Door` and `Rectangular Door` differ
 * by `component|door|arched` against `component|door|rectangular` on one slot and
 * in no other byte. Ignore `component|*` and 14 of the single-piece entries
 * collapse to one signature and 13 of the modular ones to another; every one of
 * the 13 component variants is a **file-exact subset** of the corresponding
 * `Wall (Any)` recipe, 0 files outside, measured on all 26 against the live
 * archive.
 *
 * So a component is not a template. It is a filter over one template, shipped 14
 * times.
 *
 * ## Why the answer is 10 and not 6
 *
 * A control axis can only ever **add requires**. The only channel a position has
 * is `parentTags`, which `constrain` collects into `require`, and
 * `composition/config.ts#processConfigValues` has no path at all from a parent tag
 * to a `deny`. So an axis is expressible **iff** its values are positively
 * taggable, and that is a property of the corpus rather than of this module:
 *
 * | root | bare | `\|low` | both | axis? |
 * | --- | ---: | ---: | ---: | --- |
 * | `shape\|wall` | 4354 | 527 | **0** | **yes** — disjoint, so the bare tag *is* full height |
 * | `shape\|column` | 135 | 25 | **25** | no — every low column also carries the bare tag |
 * | `shape\|corner` | 671 | 25 | **25** | no |
 *
 * The wall recipes therefore fold completely, and the corners keep the low/full
 * pair they ship as, because "full" is only sayable there as a `deny`:
 *
 * | after | replaces |
 * | --- | ---: |
 * | `Wall (Single Piece)`, `Wall (Modular)` — component x height x size | 32 |
 * | `Corner: Low` / `Corner: Full`, each per build | 4 |
 * | `Internal Corner: Low` / `Internal Corner: Full`, each per build | 4 |
 *
 * The corner half is a **rename and nothing else** — `(Any, …)` becomes
 * `Full, …`, because that recipe denies `shape|column|low` and "any" is what it
 * is not. The wall half is the fold.
 *
 * ## The merged wall slot, and why it is keyed on `role|wall`
 *
 * Tag matching is exact, never prefix: **527 records carry `shape|wall|low` and 0
 * of them carry `shape|wall`**. So `Wall (Any)`, whose only shape require is
 * `shape|wall`, cannot reach a low wall at all — 81 of 81 outside in single
 * piece, 144 of 144 in modular. Its name is wrong and so is its coverage.
 *
 * `role|wall` covers **all 527** low walls and every candidate of all 30
 * specific variants, so the merged slot keys on it and takes the height as a
 * position. It also narrows the two `(Any)` slots by the 2 and 41 column and
 * foundation records leaking into them today, which is a correction and is
 * asserted as one in `src/assembly/corpus.test.ts`.
 *
 * ## Four operations, and the provenance test holds it to them
 *
 * {@link FOLD_OPERATIONS} is the list, and `fold.test.ts` walks all 40 against
 * the 10 to check nothing else happened. Three are widenings that the control
 * positions restore exactly; the fourth is a narrowing, and each instance of it
 * carries a census **inside the fixtures** so that upstream fixing the data
 * fails the import as loudly as upstream breaking a third file would — row B6's
 * rule, applied to a repair rather than to a note.
 */
import type { ConstrainRef, PartSlot, TagRef } from '../src/catalog'

import type { TemplateFixture } from './templates'

/** One position of one control axis. `tags` is empty on the `any` position. */
export interface ControlPosition {
  /** *"arched door"*, *"low"*, *"2 wide by 2 deep"*, *"any component"*. */
  readonly label: string
  /** Exact-match tags joined onto the instance's `parentTags`. */
  readonly tags: readonly string[]
}

/**
 * The three axes of one assembly's controls.
 *
 * `height` is empty on the eight corners: their low/full split is two templates
 * because it is not positively taggable, so there is no position to offer. An
 * empty axis means *no control*, exactly as an empty size domain does for the 7
 * families that have one — a radio group of one is a control that cannot be
 * operated.
 *
 * `size` is filled by {@link deriveAssemblySizes}, which needs the corpus; this
 * module leaves it empty so that `fold.test.ts` runs on fixtures alone.
 */
export interface AssemblyControls {
  readonly component: readonly ControlPosition[]
  readonly height: readonly ControlPosition[]
  readonly size: readonly ControlPosition[]
}

/** One folded assembly: a template, its controls, and what it replaces. */
export interface FoldedAssembly {
  readonly id: string
  readonly name: string
  /** The fixture files behind it, comma-joined. Provenance, and shown on screen. */
  readonly source: string
  readonly tags: readonly string[]
  readonly parts: readonly PartSlot[]
  readonly controls: AssemblyControls
  /** The fixture names this replaces. What the losslessness test walks. */
  readonly replaces: readonly string[]
}

/**
 * The only four things the fold does to a fixture.
 *
 * Asserted verbatim by `fold.test.ts`, so adding a fifth means saying so here
 * and in the test rather than doing it quietly.
 */
export const FOLD_OPERATIONS: readonly string[] = [
  'drop a component| require and record it as a component position',
  'drop a shape|wall-rooted require and record it as a height position',
  'swap shape|wall for role|wall, strip the axis roots from the template tags, and add the collecting constrain entries',
  'add a deny or require justified by a sibling census',
]

/* ------------------------------------------------------------------ the tags */

const refs = (tags: readonly string[]): TagRef[] => tags.map((tag) => ({ tag }))
const tagsOf = (list: readonly TagRef[] | undefined): readonly string[] => (list ?? []).map((ref) => ref.tag)

/** Tags on every member, in the first member's order. Drops every axis tag by construction. */
function shared(members: readonly (readonly string[])[]): readonly string[] {
  const [first, ...rest] = members
  if (first === undefined) return []
  return first.filter((tag) => rest.every((other) => other.includes(tag)))
}

const isComponentTag = (tag: string): boolean => tag === 'component' || tag.startsWith('component|')
const isInterfaceTag = (tag: string): boolean => tag === 'interface' || tag.startsWith('interface|')
const isWallShapeTag = (tag: string): boolean => tag === 'shape|wall' || tag.startsWith('shape|wall|')

/* ------------------------------------------------------------- the wall fold */

/**
 * The `constrain` entries the merged wall slot needs so a position reaches it.
 *
 * **`siblings: []` on all three, and that is not cosmetic.** A `constrain` entry
 * with no `siblings` field inherits from *every* sibling selection as well as
 * from the parent (`config.ts#inheritedTags`), so a bare `{ tag: 'component' }`
 * would narrow the wall by whatever `component|` tag the *floor* happened to
 * carry — and floors do carry them, `component|grate` among others. An empty
 * array *"adds nothing, deliberately"*, which leaves the parent as the only
 * source. A control axis has no business reading a sibling.
 *
 * The fixtures' own `{ tag: 'size|width' }` keeps its sibling inheritance: that
 * is the shipped behaviour, it is how a floor picks up its wall's width, and this
 * row is not the place to change it.
 */
const AXIS_CONSTRAIN: readonly ConstrainRef[] = [
  { tag: 'component', siblings: [] },
  { tag: 'interface', siblings: [] },
  { tag: 'shape|wall', siblings: [] },
]

/**
 * Row D1's deny, on every slot that is not the `base`.
 *
 * A base keeps the **role of the piece it sits under**, so a wall's base carries
 * `role|wall` and a `shape|wall` slot admits it. Row D1 measured what that costs
 * a palette row — *"17 rows offering bases, 1,963 wrong candidates"* — and made
 * all 47 generated families deny `shape|base`. The 40 recipes never got it.
 *
 * Measured on the fixtures against the live archive, **3 slots** admit one: the
 * wall of `Wall (Any, Modular)` at 278 of 1,608, and both wall slots of
 * `Corner (Any, Modular)` at 144 of 490. The assembly then fills its own `base`
 * slot as well, so the wall stands on a second base and floats — which is what
 * the project owner reported.
 *
 * Applied to **every** non-base slot rather than to the three that need it, and
 * that is the point: the three are where the corpus happens to have such a
 * record today, and the class is *any* slot that does not deny it. Measured cost
 * on the slots that do not need it: zero candidates, on all of them.
 */
function denyIntegratedBase(part: PartSlot): PartSlot {
  if (part.name === 'base') return part
  const deny = tagsOf(part.tags.deny)
  if (deny.includes('shape|base')) return part
  return { ...part, tags: { ...part.tags, deny: refs([...deny, 'shape|base']) } }
}

/** A component axis label from a fixture name: `"…: Wall: Arched Door (Modular)"` → `"arched door"`. */
function componentLabel(fixtureName: string): string {
  const match = /: Wall: (.+?) \((?:Single Piece|Modular)\)$/.exec(fixtureName)
  if (match?.[1] === undefined) throw new Error(`cannot read a component label from ${fixtureName}`)
  return match[1].toLowerCase()
}

interface WallAxes {
  readonly component: ControlPosition
  readonly height: ControlPosition
}

/**
 * One member's axis values: whatever its wall slot requires beyond the shared set.
 *
 * The split is by tag root and nothing else, so a require the fold does not
 * understand cannot be silently swallowed — it throws instead, naming the
 * fixture. That is what makes {@link FOLD_OPERATIONS} a closed list.
 */
function wallAxesOf(fixture: TemplateFixture, sharedRequire: readonly string[]): WallAxes {
  const slot = fixture.parts.find((part) => part.name === 'wall')
  if (slot === undefined) throw new Error(`${fixture.name} has no wall slot`)
  const extra = tagsOf(slot.tags.require).filter((tag) => !sharedRequire.includes(tag))

  const component = extra.filter((tag) => isComponentTag(tag) || isInterfaceTag(tag))
  const height = extra.filter((tag) => isWallShapeTag(tag))
  const unknown = extra.filter((tag) => !component.includes(tag) && !height.includes(tag))
  if (unknown.length > 0) {
    throw new Error(`${fixture.name} requires ${unknown.join(', ')} on its wall, which the fold cannot express`)
  }

  return {
    component:
      component.length === 0 ? ANY_COMPONENT : { label: componentLabel(fixture.name), tags: component },
    /* `shape|wall` and `shape|wall|low` are disjoint in the corpus, so the bare
       tag really does mean full height rather than "unqualified". */
    height:
      height.length === 0
        ? ANY_HEIGHT
        : { label: height.includes('shape|wall|low') ? 'low' : 'full', tags: height },
  }
}

const ANY_COMPONENT: ControlPosition = { label: 'any component', tags: [] }
const ANY_HEIGHT: ControlPosition = { label: 'any height', tags: [] }

/** Positions in first-seen order with the `any` position first, deduplicated on the tag list. */
function axisDomain(any: ControlPosition, seen: readonly ControlPosition[]): readonly ControlPosition[] {
  const byTags = new Map<string, ControlPosition>()
  for (const position of seen) {
    if (position.tags.length === 0) continue
    const key = position.tags.join(' ')
    if (!byTags.has(key)) byTags.set(key, position)
  }
  return [any, ...[...byTags.values()].sort((a, b) => a.label.localeCompare(b.label))]
}

/**
 * The wall group of one build, merged.
 *
 * The shared `require` is the intersection, which drops every axis tag by
 * construction — `build|separate wall` is on all 16 and `shape|wall` on 15, so
 * the first survives and the second becomes the height axis without this
 * function needing a list of what to remove.
 *
 * The `deny` is the **intersection** too, and that is the load-bearing choice:
 * the union would carry the low wall's own `component|secret_door` deny onto
 * every position and refuse a secret door that any other height admits. A deny
 * that only one member carries describes that member's combination, and an
 * empty combination is what greying is for.
 */
function foldWallGroup(members: readonly TemplateFixture[], build: string): FoldedAssembly {
  const wallSlots = members.map((fixture) => {
    const slot = fixture.parts.find((part) => part.name === 'wall')
    if (slot === undefined) throw new Error(`${fixture.name} has no wall slot`)
    return slot
  })

  const sharedRequire = shared(wallSlots.map((slot) => tagsOf(slot.tags.require)))
  const sharedDeny = shared(wallSlots.map((slot) => tagsOf(slot.tags.deny)))
  const axes = members.map((fixture) => wallAxesOf(fixture, sharedRequire))

  /* `role|wall` in place of the `shape|wall` that became the height axis. It
     covers all 527 low walls and every candidate of all 30 specific variants,
     and it is what keeps the slot from admitting a floor once no shape tag is
     required of it. */
  const require = [...sharedRequire, 'role|wall']
  const first = wallSlots[0]
  if (first === undefined) throw new Error(`no wall slot in the ${build} group`)

  const parts: PartSlot[] = [
    denyIntegratedBase({
      name: 'wall',
      tags: {
        require: refs(require),
        deny: refs(sharedDeny),
        constrain: [...(first.tags.constrain ?? []), ...AXIS_CONSTRAIN],
      },
      ...(first.fulfills === undefined ? {} : { fulfills: first.fulfills }),
    }),
    denyIntegratedBase(identicalSlot(members, 'floor')),
    identicalSlot(members, 'base'),
  ]

  const label = build === 'single_piece' ? 'Single Piece' : 'Modular'
  return {
    id: `s2w-wall-on-tile-wall-${build === 'single_piece' ? 'single-piece' : 'modular'}`,
    name: `S2W: Wall on Tile: Wall (${label})`,
    source: [...new Set(members.map((fixture) => fixture.source))].sort().join(','),
    /* No `shape|` and no `component|` tag of its own, and the strip is **not**
       redundant with the intersection.

       `filterSpecificTags` keeps the **most general** match, so a `shape|wall`
       template tag would beat a `shape|wall|low` position and the low height
       would silently resolve as full. And all 16 members really do carry
       `shape|wall` at template level: `pipeline/templates.ts` records that both
       `blueprints.s2w.wall.wall+low.yaml` entries *"carry plain `shape|wall`
       while requiring `shape|wall|low` on their wall part"* — a dropped
       qualifier it calls a defensible family root and declines to normalise. It
       is defensible as a root and fatal as a parent tag, so the axis roots come
       off here and the position is the only source of either. */
    tags: shared(members.map((fixture) => fixture.tags)).filter(
      (tag) => !isWallShapeTag(tag) && !isComponentTag(tag) && !isInterfaceTag(tag),
    ),
    parts,
    controls: {
      component: axisDomain(ANY_COMPONENT, axes.map((axis) => axis.component)),
      height: axisDomain(ANY_HEIGHT, axes.map((axis) => axis.height)),
      size: [],
    },
    replaces: members.map((fixture) => fixture.name),
  }
}

/**
 * A slot every member of the group declares identically — after one declared
 * repair.
 *
 * ## The repair, and the census that justifies it
 *
 * `blueprints.s2w.wall.drain.yaml`'s **modular** base slot omits the `build|s2w`
 * that all 15 of its siblings require. The consequence is not cosmetic: it
 * admits 305 candidates over 10 footprints where they admit 48 over 4, so the
 * drain recipe can resolve a base that is not an s2w base at all.
 *
 * It is repaired rather than recorded, because the fold has to pick *one* base
 * slot for the group and picking the odd one out would spread the defect to 16
 * recipes. What keeps that honest is the census: the divergence must be exactly
 * this one tag, on exactly one member, or this throws and names the file. So
 * upstream fixing the fixture fails the import as loudly as upstream breaking a
 * second one — row B6's rule.
 */
function identicalSlot(members: readonly TemplateFixture[], name: string): PartSlot {
  const slots = members.map((fixture) => {
    const slot = fixture.parts.find((part) => part.name === name)
    if (slot === undefined) throw new Error(`${fixture.name} has no ${name} slot`)
    return { fixture, slot }
  })

  const sharedRequire = shared(slots.map((one) => tagsOf(one.slot.tags.require)))
  const divergent = slots.filter(
    (one) => tagsOf(one.slot.tags.require).length !== sharedRequire.length,
  )

  if (divergent.length > 0) {
    const missing = [
      ...new Set(
        slots.flatMap((one) => tagsOf(one.slot.tags.require)).filter((tag) => !sharedRequire.includes(tag)),
      ),
    ]
    if (name !== 'base' || missing.join(',') !== 'build|s2w' || divergent.length !== slots.length - 1) {
      throw new Error(
        `the ${name} slot diverges across the group on ${missing.join(', ')} — ` +
          `${String(divergent.length)} of ${String(slots.length)} fixtures. The fold repairs exactly one ` +
          `known divergence (the drain's modular base, missing build|s2w) and this is not it.`,
      )
    }
  }

  /* The repaired slot is the majority's, verbatim — so what ships is a fixture's
     own bytes and not a synthesis. */
  const majority = slots.find((one) => tagsOf(one.slot.tags.require).length > sharedRequire.length) ?? slots[0]
  if (majority === undefined) throw new Error(`no ${name} slot to take`)
  return majority.slot
}

/* ----------------------------------------------------------- the corner half */

/**
 * A corner or internal corner: **renamed, with row D1's deny, and otherwise byte
 * for byte the fixture's own.**
 *
 * The two shapes name their full-height variant inconsistently and neither
 * name is true. `Corner (Any, Single Piece)` *denies* `shape|column|low`, and
 * `Internal Corner (Single Piece)` denies it too while saying nothing at all. So
 * both become `: Full`, beside the `: Low` they ship with.
 *
 * Nothing else about their **structure** changes. The low/full split stays two
 * templates because `shape|column` and `shape|corner` each overlap their `|low`
 * qualifier on all 25 low columns, so "full" is only ever expressible as the deny
 * it already is — and a deny cannot travel through `parentTags`, which is a
 * control axis's only channel.
 *
 * What does change is {@link denyIntegratedBase}, and a corner needs it as much
 * as a wall does: both wall slots of `Corner (Any, Modular)` admit **144**
 * integrated-base records each, the largest instance of the defect in the
 * fixtures after the merged wall's own 278.
 */
function renameCorner(fixture: TemplateFixture): FoldedAssembly {
  const low = fixture.name.includes(': Low (')
  /* `"S2W: Wall on Tile: Corner (Any, Modular)"` → `"…: Corner: Full (Modular)"`,
     and `"…: Internal Corner (Modular)"` → `"…: Internal Corner: Full (Modular)"`. */
  const name = low
    ? fixture.name
    : fixture.name.replace(/ \((?:Any, )?(Single Piece|Modular)\)$/, ': Full ($1)')
  if (!low && name === fixture.name) throw new Error(`cannot rename the full-height variant of ${fixture.name}`)
  return {
    id: slug(name),
    name,
    source: fixture.source,
    tags: fixture.tags,
    parts: fixture.parts.map(denyIntegratedBase),
    controls: { component: [], height: [], size: [] },
    replaces: [fixture.name],
  }
}

/** `templateSlug`'s rule, duplicated here so this module needs no import from the reader. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/* ------------------------------------------------------------------ the fold */

/** Which build a fixture is, from its own `build|s2w|*` tag. */
function buildOf(fixture: TemplateFixture): string {
  const tag = fixture.tags.find((one) => one.startsWith('build|s2w|'))
  if (tag === undefined) throw new Error(`${fixture.name} carries no build|s2w| tag`)
  return tag.slice('build|s2w|'.length)
}

/**
 * The 40 to the 10.
 *
 * Grouped on the **part-name set** — `rules.ts#partNameKey`'s key, and the one
 * `templateConvention` already classifies all 40 by — crossed with the build.
 * The wall group of each build folds; every corner is carried through renamed.
 */
export function foldRecipes(fixtures: readonly TemplateFixture[]): readonly FoldedAssembly[] {
  const walls = new Map<string, TemplateFixture[]>()
  const corners: TemplateFixture[] = []

  for (const fixture of fixtures) {
    const names = fixture.parts.map((part) => part.name).sort()
    if (names.join(',') === 'base,floor,wall') {
      const build = buildOf(fixture)
      walls.set(build, [...(walls.get(build) ?? []), fixture])
      continue
    }
    corners.push(fixture)
  }

  const folded = [
    ...[...walls.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([build, members]) => foldWallGroup(members, build)),
    ...corners.map(renameCorner),
  ]

  const ids = new Set<string>()
  for (const one of folded) {
    if (ids.has(one.id)) throw new Error(`two folded assemblies slug to ${one.id}`)
    ids.add(one.id)
  }
  return folded
}
