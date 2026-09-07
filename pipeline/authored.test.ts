/**
 * The two authored assemblies, against the fixture slots they are declared as
 * differences from.
 *
 * Row **E3**. `templates.test.ts` proves the emitted module is its sources'
 * content byte for byte; this file proves the third source is *exactly the
 * documented difference from the first* and nothing else — which is the whole
 * reason a declared derivation was chosen over an override of the fixtures or a
 * free-hand copy of a shipped recipe. Two claims, and they are different:
 *
 *   1. **The difference is the declaration.** For every authored slot, the
 *      `require` and `deny` lists are recomputed here from the fixture part plus
 *      {@link AUTHORED_RECIPES}' own drops and adds, and compared to what
 *      {@link deriveAuthored} produced. A widening that crept in beyond the
 *      declaration fails here.
 *   2. **The declaration cannot silently stop describing the fixtures.** Every
 *      branch of the checker that could no-op is *run*, on a mutated copy of the
 *      real fixture, and asserted to throw. A fixture refresh that already lifted
 *      the `build|s2w` this row lifts is a build failure naming the ref, not a
 *      stale comment.
 *
 * Skips **loudly** without the fixtures, exactly as `templates.test.ts` does.
 */
import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { PartSlot } from '../src/catalog'

import type { AuthoredRecipe, SlotDerivation } from './authored'
import { AUTHORED_RECIPES, AUTHORED_SOURCE_PREFIX, deriveAuthored, isAuthoredSource } from './authored'
import { fixturesDir } from './fixtures'
import type { TemplateFixture } from './templates'
import { loadTemplateFixtures, templateConvention, templateSlug } from './templates'

const FIXTURES = fixturesDir()
const hasFixtures = existsSync(FIXTURES)
const describeFixtures = hasFixtures ? describe : describe.skip
const title = hasFixtures
  ? 'the two authored assemblies, derived from the fixtures'
  : `the two authored assemblies — SKIPPED, no ${FIXTURES} (set OPENFORGE_FIXTURES)`

const tags = (refs: readonly { tag: string }[] | undefined): readonly string[] =>
  (refs ?? []).map((ref) => ref.tag)

describeFixtures(title, () => {
  const entries = hasFixtures ? loadTemplateFixtures(FIXTURES) : []
  const authored = hasFixtures ? deriveAuthored(entries) : []
  const byName = new Map(entries.map((entry) => [entry.name, entry]))

  const sourceSlot = (recipe: AuthoredRecipe, slot: SlotDerivation): PartSlot => {
    const part = byName.get(recipe.basedOn)?.parts.find((one) => one.name === slot.from)
    if (part === undefined) throw new Error(`no fixture part ${recipe.basedOn} / ${slot.from}`)
    return part
  }

  /* ------------------------------------------------------------- the two rows */

  it('derives exactly two, both from the shipped `(Any, Modular)` wall recipe', () => {
    expect(AUTHORED_RECIPES).toHaveLength(2)
    expect(authored).toHaveLength(2)
    expect(authored.map((entry) => entry.name)).toEqual([
      'Wall on Tile: Wall (Any, Modular, Any Floor)',
      'Wall on Tile: Corridor (Any, Modular)',
    ])
    /* Both derive from the same fixture template, which is D10 §4.1's finding
       read as authorship: the `(Any, Modular)` row carries the whole of the
       measured gain — 4,441 / 1,893 at 41 palette rows and the same at 168. */
    expect(new Set(AUTHORED_RECIPES.map((recipe) => recipe.basedOn))).toEqual(
      new Set(['S2W: Wall on Tile: Wall (Any, Modular)']),
    )
  })

  it('names a `source` that says it was authored here and from which fixture', () => {
    for (const entry of authored) {
      expect(isAuthoredSource(entry.source), entry.name).toBe(true)
      const fixture = entry.source.slice(AUTHORED_SOURCE_PREFIX.length)
      expect(new Set(entries.map((one) => one.source)), entry.name).toContain(fixture)
    }
    /* And the partition it exists for: no fixture entry answers `true`, so a
       consumer that wants the 40 alone gets exactly 40 back. */
    expect(entries.filter((entry) => isAuthoredSource(entry.source))).toEqual([])
  })

  it('slugs to ids distinct from all 40, and hyphenated as `TemplateId` expects', () => {
    const fixtureIds = new Set(entries.map((entry) => templateSlug(entry.name)))
    for (const entry of authored) {
      const id = templateSlug(entry.name)
      expect(fixtureIds.has(id), id).toBe(false)
      expect(/^[a-z0-9-]+$/.test(id), id).toBe(true)
      expect(id.includes('-'), id).toBe(true)
    }
  })

  it('gives the palette two rows a user can tell apart, which is why the name drops `S2W:`', () => {
    /* The owner's original complaint was two palette rows that looked the same
       and behaved differently, and D4 measured what the shipped prefix means:
       every one of the 40 requires `s2w` on its **floor** slot, so the `S2W:`
       that opens all 40 names is the floor's build system. This row lifts exactly
       that requirement, so it cannot keep the prefix — and `families.ts` strips
       `S2W: Wall on Tile: ` from a row that has it, which means the two rows
       differ in the palette by a whole clause rather than by a suffix. */
    const shipped = byName.get('S2W: Wall on Tile: Wall (Any, Modular)')
    const widened = authored[0]
    expect(shipped?.name.startsWith('S2W: Wall on Tile: ')).toBe(true)
    expect(widened?.name.startsWith('S2W: Wall on Tile: ')).toBe(false)
    expect(widened?.name).toContain('Any Floor')

    // The floor slot is what varies, and it is the only require list that moved.
    const shippedFloor = shipped?.parts.find((part) => part.name === 'floor')
    const widenedFloor = widened?.parts.find((part) => part.name === 'floor')
    expect(tags(shippedFloor?.tags.require)).toEqual(['shape|floor', 'shape|floor|wall', 'build|s2w'])
    expect(tags(widenedFloor?.tags.require)).toEqual(['shape|floor'])
  })

  /* --------------------------------------------- claim 1: exactly the declaration */

  it('is the fixture slot plus and minus exactly the declared refs, on all 7 slots', () => {
    let slots = 0
    for (const recipe of AUTHORED_RECIPES) {
      const derived = authored.find((entry) => entry.name === recipe.name)
      expect(derived, recipe.name).toBeDefined()
      for (const slot of recipe.slots) {
        slots += 1
        const source = sourceSlot(recipe, slot)
        const part = derived?.parts.find((one) => one.name === slot.part)
        expect(part, `${recipe.name} / ${slot.part}`).toBeDefined()

        /* Recomputed here rather than read back from the module, so this is a
           second arithmetic over the same declaration and not a restatement of
           the first. Order matters: drops keep the fixture's order and adds are
           appended, which is what makes the emitted bytes deterministic. */
        const wantRequire = [
          ...tags(source.tags.require).filter((tag) => !(slot.dropRequire ?? []).includes(tag)),
          ...(slot.addRequire ?? []),
        ]
        const wantDeny = [
          ...tags(source.tags.deny).filter((tag) => !(slot.dropDeny ?? []).includes(tag)),
          ...(slot.addDeny ?? []),
        ]
        expect(tags(part?.tags.require), `${recipe.name} / ${slot.part} require`).toEqual(wantRequire)
        expect(tags(part?.tags.deny), `${recipe.name} / ${slot.part} deny`).toEqual(wantDeny)
        expect(part?.tags.constrain ?? [], `${recipe.name} / ${slot.part} constrain`).toEqual(
          slot.constrain ?? source.tags.constrain ?? [],
        )
        /* `fulfills` is deliberately dropped: it is scoped to a part's own
           *nested* slots and `assembly.ts` measured it a no-op against
           `SlotFills`, so carrying it would move `templates.test.ts`'s 20-of-128
           census for no behaviour at all. */
        expect(part?.fulfills, `${recipe.name} / ${slot.part} fulfills`).toBeUndefined()
      }
      // Nothing appears in the derived template that the declaration did not name.
      expect(derived?.parts.map((part) => part.name)).toEqual(recipe.slots.map((slot) => slot.part))
    }
    expect(slots).toBe(7)
  })

  it('changes fifteen refs in total, and every one of them is documented', () => {
    /* The whole authored payload as one number, so a row that quietly grows is
       visible in the diff of this file. Each `because` is the sentence the PR body
       carries; an undocumented change cannot be added without failing this. */
    const changes = AUTHORED_RECIPES.flatMap((recipe) =>
      recipe.slots.flatMap((slot) => [
        ...(slot.dropRequire ?? []),
        ...(slot.addRequire ?? []),
        ...(slot.dropDeny ?? []),
        ...(slot.addDeny ?? []),
      ]),
    )
    /* Four for the widened wall — two `require` refs off its floor, plus D1's
       `deny shape|base` on the floor and on the wall — and eleven for the
       corridor: a `deny shape|base` on each of its two walls, the same two
       `require` refs off its floor with four denies added, and the base swapping
       `shape|base|wall + build|s2w` for `shape|base|hallway`. Everything else in
       all seven slots comes across from the fixture unchanged, which is D10's
       finding read as authorship. */
    expect(changes).toHaveLength(15)
    for (const recipe of AUTHORED_RECIPES) {
      for (const slot of recipe.slots) {
        expect(slot.because.length, `${recipe.name} / ${slot.part}`).toBeGreaterThan(20)
      }
    }
  })

  it('inherits the shipped template’s own tags for the widened wall and names its own for the corridor', () => {
    const shipped = byName.get('S2W: Wall on Tile: Wall (Any, Modular)')
    expect(AUTHORED_RECIPES[0]?.tags).toBe('inherit')
    expect(authored[0]?.tags).toEqual(shipped?.tags)

    /* The corridor is a different shape, so it names its own — and it names
       `shape|hallway` rather than `shape|corridor` because the archive's own word
       for this shape is `hallway`: the 12 bases its base slot selects carry
       `shape|base|hallway`, the way the 32 wall recipes' `shape|wall` sits beside
       `shape|base|wall`. It stays in `build|s2w|modular` so `AssembliesScreen`'s
       two groups still partition every row. */
    expect(authored[1]?.tags).toEqual([
      'object|tile',
      'object|tile|wall_on_tile',
      'build|s2w',
      'build|s2w|modular',
      'shape|hallway',
    ])
    const hallwayRefs = authored[1]?.parts.flatMap((part) => tags(part.tags.require)) ?? []
    expect(hallwayRefs).toContain('shape|base|hallway')
  })

  it('has a layout convention for both, which is what `templateConvention` gates on', () => {
    /* `printTemplateModule` runs this gate over the authored entries as well as
       the 40, so the corridor's convention has to be in `SLOT_CONVENTIONS` before
       its template exists — a template with no convention fails
       `npm run import:catalog` naming it rather than reaching a browser with no
       geometry. */
    expect(authored.map((entry) => templateConvention(entry).id)).toEqual(['wall-on-tile', 'corridor'])
  })

  /* -------------------------- claim 2: the declaration cannot go quietly stale */

  describe('the checker, shown failing on a fixture that moved', () => {
    const base = (): TemplateFixture => {
      const found = byName.get('S2W: Wall on Tile: Wall (Any, Modular)')
      if (found === undefined) throw new Error('no base fixture')
      return found
    }

    /** The 20 parsed fixtures with one part of the base template rewritten. */
    const withPart = (name: string, part: PartSlot): readonly TemplateFixture[] =>
      entries.map((entry) =>
        entry.name === base().name
          ? { ...entry, parts: entry.parts.map((one) => (one.name === name ? part : one)) }
          : entry,
      )

    it('refuses a `dropRequire` the fixture no longer carries — upstream fixing it first', () => {
      /* The case that matters most in practice: upstream lifts `build|s2w` off
         the floor slot itself, this row's declared removal becomes a no-op, and
         a transcription would go on shipping a copy nobody can tell is redundant.
         Here it is a build failure naming the ref. */
      const floor = base().parts.find((part) => part.name === 'floor')
      if (floor === undefined) throw new Error('no floor part')
      const widened: PartSlot = {
        ...floor,
        tags: { ...floor.tags, require: [{ tag: 'shape|floor' }] },
      }
      expect(() => deriveAuthored(withPart('floor', widened))).toThrow(
        /dropRequire `shape\|floor\|wall` is not in the fixture's require/,
      )
    })

    it('refuses an `addDeny` the fixture has since added itself', () => {
      const wall = base().parts.find((part) => part.name === 'wall')
      if (wall === undefined) throw new Error('no wall part')
      const repaired: PartSlot = {
        ...wall,
        tags: { ...wall.tags, deny: [...(wall.tags.deny ?? []), { tag: 'shape|base' }] },
      }
      expect(() => deriveAuthored(withPart('wall', repaired))).toThrow(
        /addDeny `shape\|base` is already in the fixture's deny/,
      )
    })

    it('refuses a `constrain` replacement identical to the fixture’s', () => {
      /* A replacement that says nothing is a declaration nobody can read, so it
         is refused rather than accepted as a harmless copy. Demonstrated by
         moving the *fixture* to match the declaration, which is the direction an
         upstream refresh moves in. */
      const wall = base().parts.find((part) => part.name === 'wall')
      if (wall === undefined) throw new Error('no wall part')
      const matched: PartSlot = {
        ...wall,
        tags: {
          ...wall.tags,
          constrain: [{ tag: 'size|width' }, { tag: 'connection|side', siblings: ['left wall'] }],
        },
      }
      expect(() => deriveAuthored(withPart('wall', matched))).toThrow(/identical to the fixture’s/)
    })

    it('refuses a `basedOn` that names no fixture template', () => {
      expect(() => deriveAuthored(entries.filter((entry) => entry.name !== base().name))).toThrow(
        /basedOn names no fixture template/,
      )
    })

    it('refuses a `from` that names no part of the base template', () => {
      const renamed = entries.map((entry) =>
        entry.name === base().name
          ? {
              ...entry,
              parts: entry.parts.map((part) => (part.name === 'floor' ? { ...part, name: 'deck' } : part)),
            }
          : entry,
      )
      expect(() => deriveAuthored(renamed)).toThrow(/has no part named `floor`/)
    })

    it('refuses a name a fixture already carries', () => {
      const collided = entries.map((entry) =>
        entry.name === base().name ? { ...entry, name: 'Wall on Tile: Corridor (Any, Modular)' } : entry,
      )
      expect(() => deriveAuthored(collided)).toThrow(/basedOn names no fixture template/)
    })
  })
})
