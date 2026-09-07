/**
 * The two assemblies this repo authors, as **declared derivations of shipped
 * fixture slots** rather than as free-hand data or as a rewrite of the fixtures.
 *
 * Row **E3**. Two rows the project owner approved after reading row D10's
 * enumeration (`docs/assembly-candidates.md`): a wall recipe whose floor slot is
 * widened off one shipped recipe's, and a corridor — the first assembly in this
 * project with two walls on **opposite** faces.
 *
 * ## The problem, and why neither of the two obvious answers is taken
 *
 * D10 priced the first of the two as *"an edit, not an addition"*, at 87 palette
 * rows against 88 for *"the same as a new fixture instead of an edit"*. **The
 * edit is not available.** The 20 YAML fixtures live in another repository, are
 * pinned by `OPENFORGE_CATALOG_SHA` in `.github/fixtures.env`, and are read-only
 * here. So the choice is between two things this repo can do, and this module is
 * neither of them exactly:
 *
 *   - **An override applied after parsing** — 87 rows, the shipped row's floor
 *     predicate silently replaced. Declined, and `pipeline/templates.ts`'s own
 *     {@link TemplateTagDefect} docblock is why: it declines a *one-tag*
 *     normalisation of the fixtures for four numbered reasons, the first being
 *     that *"the shipped module carries a string that appears in no fixture, with
 *     the normaliser as the only witness that the difference is exactly the
 *     correction."* An override of a slot predicate is the same defect with a
 *     bigger blast radius, and it also **deletes a shipped row**: the narrow
 *     `shape|floor|wall + build|s2w` floor is an 88-record pick list, and D10 §4
 *     ranks it as a usability choice rather than a coverage one. Overwriting it
 *     removes a pick nobody asked to lose.
 *   - **A free-hand 41st template** — 88 rows, and nothing at all connecting its
 *     predicate to the shipped one it was copied from. Six months on, a fixture
 *     refresh that changes the `(Any, Modular)` wall slot leaves the copy silently
 *     stale, and no test can tell.
 *
 * **What this module does instead: it declares the derivation and checks it.**
 * Each authored slot names the fixture template and the fixture part it comes
 * from, plus the exact refs added and removed; {@link deriveAuthored} applies
 * that to the *parsed fixture* and throws unless every declared removal was
 * really there to remove and every declared addition was really absent. So:
 *
 *   1. **The fixtures still round-trip byte for byte.** `printFixture` re-emits
 *      what `loadTemplateFixtures` parsed, untouched by this module.
 *      `templates.test.ts` asserts it for all 20, as before.
 *   2. **The 40 are emitted byte-identically** with and without this table — row
 *      B4's guard for the 47 generated families, applied to the same merge point.
 *      `printTemplateModule` appends, marked, and changes nothing above the mark.
 *   3. **An authored slot cannot drift from its origin.** Upstream widening the
 *      `(Any, Modular)` wall slot, or removing the `build|s2w` this row lifts off
 *      a floor, fails `npm run import:catalog` naming the ref — the same
 *      bidirectional shape `checkTemplateTags` uses for the tag census, and for
 *      the same reason: a workaround that cannot notice its own obsolescence is
 *      worse than none.
 *
 * That is the answer to *"override or 41st template"*: **a 41st and a 42nd,
 * derived rather than transcribed.** 89 palette rows, the shipped 87 untouched.
 *
 * ## Why they must be `RECIPE_TEMPLATES` entries and not a third export
 *
 * Measured against row D2's palette rather than assumed. `families.ts` keys the
 * assemblies **section** on `familyOf(template, 'recipe')`, and the only thing
 * that decides `'recipe'` is which of the emitted module's two arrays the
 * template came from — `RECIPE_TEMPLATES` is `'recipe'`, `GENERATED_FAMILIES` is
 * `'family'` and lands in the single-tile section under a role heading. A third
 * export would reach the palette only by editing `src/builder/panels/families.ts`,
 * which row D2 owns. So an authored assembly is a `RECIPE_TEMPLATES` entry or it
 * is not on the palette, and {@link AUTHORED_SOURCE_PREFIX} is how a consumer
 * that needs the 40 alone gets them back.
 *
 * ## What is authored here, and what is derived by machine
 *
 * D10's central finding is that the derivable half of a slot's constraint is
 * already derived by `pipeline/families.ts`, and everything that makes an
 * assembly a real piece of terrain is authored. This module is that authored
 * half and it is deliberately small: **two templates, seven slots, fifteen ref
 * changes.** Everything else — the `deny shape|curved`, the
 * `require build|separate wall`, the `constrain size|width`, the whole shape of
 * the base's connection inheritance — comes across from the fixture unchanged,
 * because D10 measured that those are what make the thing close.
 */
import { PartSlot } from '../src/catalog'
import type { ConstrainRef, TagRef } from '../src/catalog'

import type { TemplateFixture } from './templates'

/**
 * The prefix an authored template's `source` carries, followed by the fixture it
 * derives from.
 *
 * A `source` and not a new field on `TemplateFixture`, because the emitted
 * `RecipeTemplate` type lives in `src/screens/assemblies/assembly.ts` — row C3's
 * file — and a new field there would be a change to a screen this row does not
 * own for information the existing field can carry. It reads as provenance on the
 * screen that shows it (*"authored here, from that fixture"*) and it is what
 * partitions the emitted array back into the 40 and the 2.
 */
export const AUTHORED_SOURCE_PREFIX = 'authored:'

/** True for a template this repo authored rather than read from a fixture. */
export function isAuthoredSource(source: string): boolean {
  return source.startsWith(AUTHORED_SOURCE_PREFIX)
}

/* ------------------------------------------------------------ the derivation */

/**
 * One authored slot, as the difference from a shipped fixture slot.
 *
 * `dropRequire` / `addRequire` / `dropDeny` / `addDeny` are exact tag strings and
 * every one of them is checked against the source part: a drop of a ref that is
 * not there, or an add of a ref that already is, is a **throw** rather than a
 * silent no-op. That is what makes the declaration an assertion about the
 * fixtures instead of a wish.
 *
 * `constrain` **replaces** the source part's whole block when present, because a
 * `constrain` entry is a `{ tag, siblings }` object rather than a string and a
 * per-entry diff of four-key objects would be a second grammar to get wrong. A
 * replacement identical to the source's is refused for the same reason a
 * redundant `addRequire` is.
 */
export interface SlotDerivation {
  /** The authored slot's name. May differ from {@link from} — the corridor renames. */
  readonly part: string
  /** The fixture part it derives from, by name, within {@link AuthoredRecipe.basedOn}. */
  readonly from: string
  /** Refs lifted off `require`. Each must be present on the source part. */
  readonly dropRequire?: readonly string[]
  /** Refs added to `require`, appended in this order. Each must be absent. */
  readonly addRequire?: readonly string[]
  /** Refs lifted off `deny`. Each must be present. */
  readonly dropDeny?: readonly string[]
  /** Refs added to `deny`, appended in this order. Each must be absent. */
  readonly addDeny?: readonly string[]
  /** The whole `constrain` block, replacing the source's. Must differ from it. */
  readonly constrain?: readonly ConstrainRef[]
  /** Why this slot differs — one sentence, for the reader of the diff. */
  readonly because: string
}

/** One authored template: a name, a fixture to derive from, and its slots. */
export interface AuthoredRecipe {
  /** `"Wall on Tile: Corridor (Any, Modular)"`. Unique across all 42. */
  readonly name: string
  /** The exact `name` of the fixture template every slot derives from. */
  readonly basedOn: string
  /**
   * The template's own tags — the `parentTags` a `constrain` entry reads.
   *
   * `'inherit'` takes the source template's list unchanged, which is the honest
   * answer for the widened wall: it is the same `S2W: Wall on Tile` modular wall
   * assembly and only its floor slot's admissions differ. The corridor names its
   * own, because it is a different shape.
   */
  readonly tags: readonly string[] | 'inherit'
  readonly slots: readonly SlotDerivation[]
}

/* --------------------------------------------------------------- the two rows */

/**
 * **Authored row 1 — the widened wall.**
 *
 * D10 §1's recommendation, and the whole of its measured gain: taking
 * `shape|floor|wall` and `build|s2w` off the floor slot moves the assemblies
 * section from **3,079 records (35.4%) / 905 designs (23.7%)** to **4,441 (51.0%)
 * / 1,893 (49.5%)** — re-derived on this tree by `src/template/corpus.test.ts`
 * rather than quoted. The floor slot's cold pool goes from **88 files / 88 items**
 * to **1,496 / 1,122**.
 *
 * ## The name says what varies, because D4 measured what the old one says
 *
 * D4's central correction is that the 40 are **cross-build**: every wall fixture
 * requires `separate wall` on its wall slot and `s2w` on its floor slot, so the
 * `S2W:` that opens all 40 names is the **floor's** build system. This row lifts
 * exactly that requirement, so it cannot keep the prefix — and the two rows
 * cannot share a name, which is the owner's original complaint about the palette
 * (*two rows that looked the same and behaved differently*) and must not be
 * recreated. So:
 *
 * | | palette row reads | floor slot admits |
 * | --- | --- | --- |
 * | shipped | `Wall (Any, Modular)` | `shape\|floor\|wall + build\|s2w` — 88 files |
 * | **this row** | `Wall on Tile: Wall (Any, Modular, Any Floor)` | `shape\|floor` — 1,496 files |
 *
 * The shipped row is stripped of `RECIPE_PREFIX` (`S2W: Wall on Tile: `) by
 * `families.ts` and this one is not, because this one does not carry it — so the
 * two rows differ in the palette by a whole clause rather than by a suffix, and
 * the clause names the floor.
 *
 * ## The three refs, and why there are only three
 *
 * D10 §7.2 measured the other nine Tier A candidates at **+0 records and +0
 * designs each**, for a structural reason: every other floor predicate is a
 * *refinement* of `shape|floor`, so once `shape|floor` is on the palette the rest
 * are shorter pick lists over the same records. The one candidate D10 flagged as
 * a possible exception — `shape|base|square` on the base slot — was re-measured
 * here and **is not one**: it widens the base pool from 48 files to 337 and adds
 * **+0 / +0** over this row, because those bases are already reached by the
 * single-piece wall recipe's own base slot. It also makes the solver pick a
 * **2 x 1** cell where the shipped base gives 2 x 2, which is a worse default for
 * a wall tile. So the base slot comes across unchanged.
 *
 * `deny shape|base` on the wall slot is row **D1**'s, and it is a repair rather
 * than a widening: the shipped `(Any, Modular)` wall slot has none, so it admits
 * 278 bases as walls, and D1 reports a slot without the deny as the defect the
 * owner reported. It costs the wall pool 1,608 → 1,330 files and the row's reach
 * nothing at all (all 278 are inside the 40's own 3,079).
 */
const WIDENED_WALL: AuthoredRecipe = {
  name: 'Wall on Tile: Wall (Any, Modular, Any Floor)',
  basedOn: 'S2W: Wall on Tile: Wall (Any, Modular)',
  tags: 'inherit',
  slots: [
    {
      part: 'wall',
      from: 'wall',
      addDeny: ['shape|base'],
      because:
        "row D1: a slot without it admits bases as walls — 278 of the shipped slot's 1,608 files",
    },
    {
      part: 'floor',
      from: 'floor',
      dropRequire: ['shape|floor|wall', 'build|s2w'],
      addDeny: ['shape|base'],
      because: 'the whole of the row: 88 floor files become 1,496, and the section reaches half the archive',
    },
    { part: 'base', from: 'base', because: 'unchanged — D10 §4 measured every base variant at +0 / +0' },
  ],
}

/**
 * **Authored row 2 — the corridor.**
 *
 * `(base, floor, left wall, right wall)`: two walls on **opposite** faces, no
 * column and therefore no mitre, which is the whole reason it is cheap.
 * `src/template/rules.ts#CORRIDOR` is its layout and carries the geometry;
 * this is its predicate.
 *
 * Its coverage gain is **not** its reason — D10 §7.4 says so and this row repeats
 * it: the assemblies section reaches 4,441 / 1,893 with or without it, because its
 * floor slot is the same widened pool as row 1's. What it adds that nothing else
 * does is **12 records over 2 designs**: the hallway bases, which no shipped
 * recipe's base slot can reach. It is worth a row for the shape it *is*.
 *
 * ## Three predicates, and two of them correct D10 §3.3
 *
 * **The base requires `shape|base|hallway`, which §3.3 got wrong.** Upstream
 * already ships a corridor piece and it is a base — `plain#base+hallway.2x2`,
 * **12 records over the connection variants, 2 designs**, `size|width|2 +
 * size|depth|2` with the inferred `role|floor` and `form|straight`, `rect 2x2` on
 * all 12. §3.3's predicate requires `shape|base|wall` and **0 of the 12 carry
 * it**, so it could not reach the one piece in the archive built for this shape.
 * Twelve is a narrow pool and the fill still completes on it: measured, `closes`
 * at 2 x 2 / 4.00 with no doubts.
 *
 * *There is no "fallback" to `shape|base|wall` and that is a property of the
 * grammar, not a judgement.* `require` is an **intersection** —
 * `candidates.ts` sorts the posting lists and intersects them — so
 * `hallway OR wall` is not expressible in a slot predicate at all. The nearest
 * expressible thing is dropping the qualifier to bare `shape|base`, which is not
 * a fallback but a different slot: 1,963 bases, none of them chosen for a
 * corridor. `corpus.test.ts` measures both and the qualifier wins.
 *
 * **The floor denies the sub-2 depths, and depth is the right axis.** The two
 * walls are pinned to the two `z` faces, so they consume one unit of the **depth**
 * axis specifically. A `1 x 2` floor is a one-unit corridor segment and perfectly
 * walkable; a `2 x 1` is solid stone. The min-dimension reading gives 943 records
 * / 736 designs and is wrong; the depth reading gives **954 / 747** and is right.
 *
 * The mechanism needs no new tag: **`deny size|depth|0.5, size|depth|1,
 * size|depth|1.5`** — 17, 1,396 and 29 records corpus-wide. Without it **270 rect
 * floors, over 187 designs, build a solid block of wall that the closure check
 * calls `closes`** — no overlapping pair, union exactly the cell, area exact. That
 * is not a defect in `placeTemplateSlots`; it proves parts do not overlap and that
 * they cover the cell, and it has never had to prove that anything is left to walk
 * on because the corridor is the first layout in which **two slots eat the same
 * axis**. `offsets.ts#SlotDoubtCode`'s `no-walk` now catches it at the convention
 * level too, and `corpus.test.ts` measures the deny and the check separately so
 * neither is load-bearing alone.
 *
 * The deny is a **tag** predicate, and `docs/tile-sizing.md`'s closing rule is
 * that *a size tag is a claim about a piece; only a mesh is a measurement of one*.
 * Measured: the depth tag agrees with the resolved footprint `d` on **1,224 of
 * 1,224** rect floors, with 0 disagreements and 0 floors carrying no depth tag —
 * and that agreement is **partly circular**, because `pipeline/footprint.ts`
 * derives a `rect`'s `d` from `size|depth` in the first place. So the deny is
 * exactly as good as the tag, which for floors is the whole of what the archive
 * says. D9's mesh-versus-tag exception was corner **walls**
 * (`footprint.ts#cornerWallRun`) and floors carry no such exception.
 *
 * The deny **cannot see the 272 non-`rect` floors** — 163 `none`, 56 `arc`, 44
 * `wall`, 9 `tri` — and it removes only the 8 of them tagged `size|depth|1`.
 * That is sound rather than lucky: `cellExtentOf` refuses anything but a `rect` as
 * a cell, so a corridor filled with one is `undecidable` on `floor: no-cell` or
 * `floor: no-footprint` and can never be a false `closes`.
 *
 * **The walls keep `build|separate wall`, and no axis carries that fact.** D10
 * measured the same corridor with the walls on bare `shape|wall`: it fills with a
 * `{shape:'wall', length:1.5}` s2w piece and comes out **`fails`, `want=2
 * got=1.5` on both walls**. Each wall also constrains `connection|side` on the
 * other, so the two sides of one corridor use the same connector system.
 *
 * *§3.3 attributes the walls' 1,330-file pool to that constrain and that is
 * wrong.* A `constrain` block collects tags from the parent and the **siblings**,
 * and cold — nothing chosen — it collects nothing; a template parent carries no
 * `connection|` tag at all (`assembly.ts` measured that over all 230 template
 * tags). The 1,608 → 1,330 narrowing is D1's `deny shape|base`, to the record.
 */
const CORRIDOR_RECIPE: AuthoredRecipe = {
  name: 'Wall on Tile: Corridor (Any, Modular)',
  basedOn: 'S2W: Wall on Tile: Wall (Any, Modular)',
  /* `shape|hallway` and not `shape|corridor`: the archive's own word for this
     shape is `hallway` — `shape|base|hallway` on the 12 bases the base slot
     selects — and a template's `shape|` tag should be a sibling of the tags its
     parts require, the way the 32 wall templates' `shape|wall` is a sibling of
     `shape|base|wall`. The row's *name* says Corridor because that is what the
     owner and D10 call it; the tag is inert either way (no `constrain` entry on
     any of the 42 is rooted at `shape|`, measured in `assemblies.test.ts`). */
  tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'shape|hallway'],
  slots: [
    {
      part: 'right wall',
      from: 'wall',
      addDeny: ['shape|base'],
      constrain: [{ tag: 'size|width' }, { tag: 'connection|side', siblings: ['left wall'] }],
      because: 'the shipped (Any, Modular) wall, chirally renamed, sharing a connector system with the other side',
    },
    {
      part: 'left wall',
      from: 'wall',
      addDeny: ['shape|base'],
      constrain: [{ tag: 'size|width' }, { tag: 'connection|side', siblings: ['right wall'] }],
      because: 'the same wall on the opposite face — sides 0 and 2, which is what makes this not a corner',
    },
    {
      part: 'floor',
      from: 'floor',
      dropRequire: ['shape|floor|wall', 'build|s2w'],
      addDeny: ['shape|base', 'size|depth|0.5', 'size|depth|1', 'size|depth|1.5'],
      because: 'two half-unit walls eat a full unit of depth, so a sub-2 floor is solid stone that closes',
    },
    {
      part: 'base',
      from: 'base',
      dropRequire: ['shape|base|wall', 'build|s2w'],
      addRequire: ['shape|base|hallway'],
      constrain: [
        { tag: 'size|width' },
        { tag: 'size|depth' },
        { tag: 'connection', siblings: ['right wall', 'left wall'] },
        { filter: 'connection|side' },
        { filter: 'connection|openforge' },
      ],
      because: "upstream's own corridor base, which §3.3's shape|base|wall predicate structurally excluded",
    },
  ],
}

/**
 * The two, in the order they are emitted.
 *
 * There is no third, and the reason is D10 §7.2: of its seventeen enumerated
 * candidates **sixteen add 0 records and 0 designs**, and the two multi-column
 * shapes it costed (the 3-wall dead end and the 4-wall closet) are blocked on
 * `offsets.ts#cornerReservation` returning 0 for a face flanked by two corners,
 * which inverts their closure verdict. Neither is authored here and the corridor
 * does not need the repair — it has no corner-anchored slot.
 */
export const AUTHORED_RECIPES: readonly AuthoredRecipe[] = [WIDENED_WALL, CORRIDOR_RECIPE]

/* ---------------------------------------------------------------- the checker */

function tagsOf(refs: readonly TagRef[] | undefined): string[] {
  return (refs ?? []).map((ref) => ref.tag)
}

function fail(recipe: AuthoredRecipe, slot: SlotDerivation | undefined, why: string): never {
  const where = slot === undefined ? recipe.name : `${recipe.name} / ${slot.part}`
  throw new Error(
    `${where}: ${why}. This is pipeline/authored.ts declaring a derivation the pinned ` +
      'fixtures no longer support — re-read the fixture slot and either update the declaration or ' +
      'delete it, and say which in the PR that moves OPENFORGE_CATALOG_SHA.',
  )
}

/**
 * Apply one slot's declared difference to the fixture part it derives from.
 *
 * Every branch that could silently do nothing throws instead. That is the whole
 * value of the module over a transcription: a declaration that has quietly
 * stopped describing the fixtures is a build failure, not a stale comment.
 */
function deriveSlot(recipe: AuthoredRecipe, slot: SlotDerivation, source: PartSlot): PartSlot {
  const require = tagsOf(source.tags.require)
  const deny = tagsOf(source.tags.deny)

  for (const tag of slot.dropRequire ?? []) {
    if (!require.includes(tag)) fail(recipe, slot, `dropRequire \`${tag}\` is not in the fixture's require`)
  }
  for (const tag of slot.dropDeny ?? []) {
    if (!deny.includes(tag)) fail(recipe, slot, `dropDeny \`${tag}\` is not in the fixture's deny`)
  }
  for (const tag of slot.addRequire ?? []) {
    if (require.includes(tag)) fail(recipe, slot, `addRequire \`${tag}\` is already in the fixture's require`)
  }
  for (const tag of slot.addDeny ?? []) {
    if (deny.includes(tag)) fail(recipe, slot, `addDeny \`${tag}\` is already in the fixture's deny`)
  }

  const nextRequire = [
    ...require.filter((tag) => !(slot.dropRequire ?? []).includes(tag)),
    ...(slot.addRequire ?? []),
  ]
  const nextDeny = [...deny.filter((tag) => !(slot.dropDeny ?? []).includes(tag)), ...(slot.addDeny ?? [])]
  if (nextRequire.length === 0) fail(recipe, slot, 'the derivation leaves the slot with no require at all')

  const sourceConstrain: readonly ConstrainRef[] = source.tags.constrain ?? []
  let constrain: readonly ConstrainRef[] = sourceConstrain
  if (slot.constrain !== undefined) {
    if (JSON.stringify(slot.constrain) === JSON.stringify(sourceConstrain)) {
      fail(recipe, slot, 'the declared `constrain` block is identical to the fixture’s, so it says nothing')
    }
    constrain = slot.constrain
  }

  /* Assembled untyped and validated by the schema, for `readPart`'s reason: the
     schema is the thing that decides what a part is, and a key it drops must not
     reach a caller through a typed literal built here. */
  const result = PartSlot.safeParse({
    name: slot.part,
    tags: {
      require: nextRequire.map((tag) => ({ tag })),
      ...(nextDeny.length > 0 ? { deny: nextDeny.map((tag) => ({ tag })) } : {}),
      ...(constrain.length > 0 ? { constrain: [...constrain] } : {}),
    },
    /* `fulfills` is deliberately **not** carried across. It is scoped to a part's
       own *nested* slots (`docs/config-spec.md`: "No sibling impact"), and
       `assembly.ts` measured it a no-op against `SlotFills` because C2's picker
       never offers a `base` slot as a choice. Carrying it would add two more
       `[{part: base}]` declarations that change nothing and would move
       `templates.test.ts`'s 20-of-128 census for no reason. */
  })
  if (!result.success) fail(recipe, slot, `the derived part does not match PartSlot: ${result.error.message}`)
  return result.data
}

/**
 * The authored templates, derived from the parsed fixtures.
 *
 * Takes the whole parsed set rather than reading the directory itself, so it sees
 * exactly what `printFixture` round-trips and there is no second read of the
 * fixtures to disagree with the first.
 */
export function deriveAuthored(entries: readonly TemplateFixture[]): readonly TemplateFixture[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const out: TemplateFixture[] = []

  for (const recipe of AUTHORED_RECIPES) {
    const base = byName.get(recipe.basedOn)
    if (base === undefined) {
      fail(
        recipe,
        undefined,
        `basedOn names no fixture template — \`${recipe.basedOn}\` is not among ` +
          `the ${String(entries.length)} parsed`,
      )
    }
    if (byName.has(recipe.name)) fail(recipe, undefined, 'a fixture template already carries this name')

    const parts = recipe.slots.map((slot) => {
      const source = base.parts.find((part) => part.name === slot.from)
      if (source === undefined) {
        fail(recipe, slot, `\`${recipe.basedOn}\` has no part named \`${slot.from}\``)
      }
      return deriveSlot(recipe, slot, source)
    })
    const names = new Set(parts.map((part) => part.name))
    if (names.size !== parts.length) fail(recipe, undefined, 'two slots derive to the same part name')

    out.push({
      source: `${AUTHORED_SOURCE_PREFIX}${base.source}`,
      name: recipe.name,
      type: base.type,
      tags: recipe.tags === 'inherit' ? base.tags : recipe.tags,
      parts,
    })
  }

  return out
}
