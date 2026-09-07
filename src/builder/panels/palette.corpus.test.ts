/// <reference types="node" />
/**
 * The palette's claims about the corpus, measured.
 *
 * **Row C1 turned a palette row from a catalog item into a template family**, and
 * this file grew a second half rather than being replaced, because the two halves
 * are about different objects:
 *
 *   - **Blocks 1 to 3 are properties of the *archive*** that the builder still
 *     rests on and that nothing else in the suite measures. They were written
 *     here because the palette asked them; it no longer does, so each one now
 *     names the consumer it is held for. Deleting them with the rows they were
 *     about would have dropped three measured zeros that four other files' own
 *     arguments cite:
 *       1. **placeability is a property of the item** —
 *          `builder/canvas/geometry.ts#placementRefusal` and the plan view's
 *          visible refusal of the 370 footprint-less items;
 *       2. **a base is always its own design** —
 *          `screens/catalog/format.ts#KIND_PRECEDENCE`, whose "a base beats
 *          everything" ranking is sound only because of it;
 *       3. **the preview is not the print** — the catalog card renders the
 *          former and the bill's fills print the latter, and the disagreement is
 *          measured on all 931 two-sided items under all three locks.
 *   - **Blocks 4 to 9 are row C1's own**: the 87 rows, their grouping, the size
 *     control's domain, the map from an item back to a family, and the one
 *     contract this row cannot satisfy from inside its own files.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`). **CI does have it** — the stamp step regenerates it
 * from the pinned fixtures before the suite runs. Absent, every block skips
 * **loudly**, naming the path and the command, the precedent
 * `src/search/corpus.test.ts` sets.
 *
 * ## What this file cannot prove
 *
 * Nothing here renders anything. It is arithmetic over the emitted index and the
 * generated template module, so it says the palette's *premises* hold; whether
 * the panel then reads the right field is `panels.test.tsx`'s job, and whether 87
 * rows are legible at 272px is a browser's. It also cannot prove any of this
 * *forward*: a future import is free to emit a design whose files disagree about
 * a footprint, or a family whose refs match nothing, and the point of measuring
 * the zeros is that such an import fails here instead of quietly greying half a
 * tile or offering a row that arms an empty slot.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AssemblyTemplate, TemplateLookup } from '@/assembly'
import { buildAssemblyIndex, buildBillOfTiles, selectVariantForLock } from '@/assembly'
import { isPlaceable } from '@/builder/canvas'
import type { CatalogFile, CatalogRecord, TileAggregate } from '@/catalog'
import { CatalogFile as CatalogFileSchema, buildAggregateIndex, resolveTags } from '@/catalog'
import { createCompositionIndex, resolveSlotTags } from '@/composition'
import { RECIPE_TEMPLATES } from '@/screens/assemblies'
import type { PlacementId, TemplateId, TemplateInstance } from '@/store'
import { LockSystem } from '@/store'

import {
  GROUP_ORDER,
  INSERT_DESIGNS,
  PLACEABLE_TEMPLATES,
  TEMPLATE_FAMILIES,
  familyById,
  positionOf,
} from './families'
import { armForTags, armNameForTags, armRefusalFor, familyName, familySlug } from './familyKey'
import { candidateCount } from './palette'


const CATALOG_PATH =
  process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

function loadCatalog(): CatalogFile | undefined {
  if (!existsSync(CATALOG_PATH)) return undefined
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
}

const loaded = loadCatalog()

if (loaded === undefined) {
  process.stderr.write(
    [
      '',
      '='.repeat(72),
      '  builder/panels/palette.corpus.test: SKIPPED — no emitted catalog index.',
      `  Looked for: ${CATALOG_PATH}`,
      '  Build one with:  npm run import:catalog',
      '  Or point at one: OPENFORGE_CATALOG=/path/to/catalog.json',
      '='.repeat(72),
      '',
    ].join('\n'),
  )
}

const describeCorpus = loaded === undefined ? describe.skip : describe

// Safe: every block below is skipped when the index is absent.
const aggregates = loaded === undefined ? undefined : buildAggregateIndex(loaded)
const items: readonly TileAggregate[] = aggregates?.aggregates ?? []
const records: readonly CatalogRecord[] = loaded?.records ?? []
const byId = new Map(records.map((record) => [record.id as string, record]))

/** The records behind one item, which is what the file-level question was asked of. */
const filesOf = (item: TileAggregate): CatalogRecord[] =>
  item.variants.flatMap((variant) => {
    const record = byId.get(variant.id)
    return record === undefined ? [] : [record]
  })

/** The three locks, from the store's own enum rather than a fourth copy of the list. */
const LOCKS: readonly LockSystem[] = LockSystem.options

/* ------------------------------------------------ 1. placeability, at item level */

describeCorpus('a refusal is a property of the item', () => {
  it('is the same answer for every variant of every item', () => {
    const disagreeing = items.filter(
      (item) => new Set(filesOf(item).map((record) => isPlaceable(record))).size > 1,
    )

    // The claim `PalettePanel`'s handoff guard rests on: **no design in the
    // corpus mixes placeable and unplaceable files**, so a refused row cannot be
    // rescued by swapping to a sibling and the palette must not try.
    expect(disagreeing.map((item) => item.name)).toEqual([])

    // And every variant is accounted for — a `flatMap` that silently dropped an
    // id would make the line above vacuously true.
    expect(items.reduce((total, item) => total + filesOf(item).length, 0)).toBe(records.length)
  })

  it('refuses 370 items holding exactly the 726 refused files', () => {
    const refusedFiles = records.filter((record) => record.foot.shape === 'none')
    const refusedItems = items.filter((item) => !isPlaceable(item))

    expect(refusedFiles).toHaveLength(726)
    expect(refusedItems).toHaveLength(370)
    // The partition, which is the same zero as above said as a count: the refused
    // items hold all of the refused files and nothing else.
    expect(refusedItems.reduce((total, item) => total + item.variants.length, 0)).toBe(726)

    // 9.7% of items against 8.3% of files. `palette.ts` states both, because a
    // reader who knows only the file figure will under-count the greyed rows.
    expect(((refusedItems.length / items.length) * 100).toFixed(1)).toBe('9.7')
    expect(((refusedFiles.length / records.length) * 100).toFixed(1)).toBe('8.3')
  })
})

/* --------------------------------------------- 2. a base is always its own design */

describeCorpus('a base never shares an item with anything else', () => {
  it('holds no item mixing a base variant with a non-base one', () => {
    const mixed = items.filter(
      (item) =>
        item.variants.some((variant) => variant.layer === 'base') &&
        item.variants.some((variant) => variant.layer !== 'base'),
    )

    // `shape|base` is part of the design key, so a base is always its own
    // design. `starterSet` was the caller this zero was first measured for — it
    // skipped `variantClass === 'base-only'` where it used to skip
    // `record.layer === 'base'` — and row A0 deleted it with the library; the
    // zero is kept because `format.ts#KIND_PRECEDENCE` rests on it too, and
    // because an import that broke it would grey half a tile silently.
    expect(mixed.map((item) => item.name)).toEqual([])

    const baseOnly = items.filter((item) => item.variantClass === 'base-only')
    const baseFiles = records.filter((record) => record.layer === 'base')
    expect(baseOnly.reduce((total, item) => total + item.variants.length, 0)).toBe(baseFiles.length)
  })
})

/* ------------------------------------------------- 3. the preview is not the print */

/**
 * **Row V4 renamed the subject of this block and kept every number.**
 *
 * The palette no longer arms a file, so `armFile` is gone and these three tests
 * ask the same question of the function that took its place:
 * `selectVariantForLock`, which is rule 0's own preference and is what the bill,
 * the canvas and the slots panel all resolve through. The disagreement measured
 * here is therefore no longer "what the row shows against what the row arms" but
 * **"what the row shows against what the build prints"** — a stronger claim about
 * the same two functions, and the one the owner's defect was really about.
 */
describeCorpus('the row shows one file and the build prints another', () => {
  it('disagrees on every one of the 931 two-sided items under openlock', () => {
    const both = items.filter((item) => item.variantClass === 'both')
    expect(both).toHaveLength(931)

    // The owner's defect, counted. The palette used to render the file the
    // library held, which for these items was the `integral` — a tile with its
    // base welded on — while the catalog card showed the topper. The numbers are
    // unchanged by row V4, which is the point: the two functions are the same
    // two functions, and only the *caller* of the second one moved.
    const differing = both.filter((item) => selectVariantForLock(item, 'openlock').variant.id !== item.preview)
    expect(differing).toHaveLength(931)

    // The other two locks disagree less, because `selectVariant` only prefers the
    // integral when the integral offers the lock the build asked for.
    expect(both.filter((item) => selectVariantForLock(item, 'dragonlock').variant.id !== item.preview)).toHaveLength(269)
    expect(both.filter((item) => selectVariantForLock(item, 'magnetic').variant.id !== item.preview)).toHaveLength(396)
  })

  it('disagrees on 1,611 / 609 / 1,055 items over the whole corpus', () => {
    // Beyond the 931 the difference is `variantsByPreference`' `bytes`-ascending
    // tie-break, which a preview must not inherit: the smallest file in a group
    // is routinely the `topless` print, and a palette that showed the topless
    // variant of every tile would be answering a print-option question nobody
    // asked it.
    const counts = LOCKS.map(
      (lock) => items.filter((item) => selectVariantForLock(item, lock).variant.id !== item.preview).length,
    )
    expect(Object.fromEntries(LOCKS.map((lock, at) => [lock, counts[at]]))).toEqual({
      openlock: 1611,
      dragonlock: 609,
      magnetic: 1055,
    })
  })

  it('always arms a variant of the item it was asked about', () => {
    // `selectVariantForLock` is total — `variants` is a non-empty tuple — and it
    // must never reach outside the item, because every consumer of it (the bill's
    // rule 0, `PlanCatalog.record`, `planSlots`) looks the answer up in an index
    // and then reports the item it came from. A file from another item would put
    // somebody else's mesh under this tile's name.
    for (const lock of LOCKS) {
      const escaped = items.filter(
        (item) => !item.variants.some((variant) => variant.id === selectVariantForLock(item, lock).variant.id),
      )
      expect(escaped.map((item) => item.name), lock).toEqual([])
    }
  })
})

/* ------------------------------------------- 4. the 87 rows, and their ids */

describeCorpus('the palette lists 87 templates and can arm every one of them', () => {
  it('is B4’s 47 families plus the 40 shipped recipes, with distinct ids', () => {
    expect(TEMPLATE_FAMILIES).toHaveLength(87)
    expect(TEMPLATE_FAMILIES.filter((family) => family.kind === 'family')).toHaveLength(47)
    expect(TEMPLATE_FAMILIES.filter((family) => family.kind === 'recipe')).toHaveLength(40)
    expect(new Set(TEMPLATE_FAMILIES.map((family) => family.id)).size).toBe(87)
    // `PLACEABLE_TEMPLATES` is the same set as the resolver's own type, in the
    // same order, so a screen can build one lookup from it.
    expect(PLACEABLE_TEMPLATES).toHaveLength(87)
  })

  it('parses every id as a TemplateId, which is what row A8’s refusal rested on', () => {
    // A8 declined to arm anything because the list held `DesignId`s and a
    // `DesignId` is a brand over `z.string().min(1)`: **all 87 template ids
    // satisfy it**, so the compiler could not have caught the cast and every
    // placement would have been reported `unknown-template`. The discrimination
    // runs the other way and is what makes this list armable — a `TemplateId` is
    // a lowercase hyphenated slug, and the generator emits 87 of them.
    expect(TEMPLATE_FAMILIES.filter((family) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(family.id))).toEqual([])
    // And no design in the corpus collides with one, which is the other half of
    // "not lexically disjoint but disjoint in fact".
    const ids = new Set<string>(TEMPLATE_FAMILIES.map((family) => family.id))
    expect(items.filter((item) => ids.has(item.design)).map((item) => item.name)).toEqual([])
  })

  it('groups the 47 by role in the order the corpus puts them', () => {
    const records51 = new Map<string, number>()
    for (const record of records) {
      const role = resolveTags(loaded!, record).find((tag) => tag.startsWith('role|'))?.slice(5)
      if (role === undefined) continue
      records51.set(role, (records51.get(role) ?? 0) + 1)
    }
    // §3.1's grouping, and `families.ts#GROUP_ORDER`'s own table.
    expect(Object.fromEntries(records51)).toEqual({
      wall: 5381,
      floor: 2162,
      riser: 319,
      insert: 285,
      column: 223,
      stair: 206,
      roof: 100,
      decor: 26,
    })
    // The group order follows those records; the *family* counts do not follow
    // them, which is why the two lists are different and only one is the order.
    // `wall` and `floor` were 19 and 17 until row D1 dropped the four families
    // whose whole population was bases — two walls and two floors.
    const counts = GROUP_ORDER.map(
      (key) => TEMPLATE_FAMILIES.filter((family) => family.group === key).length,
    )
    expect(counts).toEqual([17, 15, 2, 6, 3, 2, 1, 1, 40])
    // No `insert` group, although 285 records carry the role: `SKIPPED_ROLES`.
    expect(GROUP_ORDER).not.toContain('insert')
  })
})

/* ------------------------------------------------- 5. the size control's domain */

describeCorpus('the size control is a control, and 7 families have none', () => {
  it('holds 304 positions over the 47, median 4 and maximum 32', () => {
    const families = TEMPLATE_FAMILIES.filter((family) => family.kind === 'family')
    // `TemplateFamily.sizes` is *what there is to choose*, so the 7 one-position
    // tables arrive as empty; the emitted table is what holds 304.
    const offered = families.map((family) => family.sizes.length)
    const emitted = offered.map((length) => (length === 0 ? 1 : length))
    expect(emitted.reduce((total, length) => total + length, 0)).toBe(304)

    const sorted = [...emitted].sort((a, b) => a - b)
    expect(sorted[Math.floor(sorted.length / 2)]).toBe(4)
    expect(sorted[sorted.length - 1]).toBe(32)
  })

  it('names the 7 rather than counting them — 5 empty domains and 2 inexpressible', () => {
    // **The brief for this row said 5.** B3's five are the families whose records
    // resolve no grid cell at all; the other two resolve cells that no `size|`
    // tag can express (B4's 16 refused cells: 12 annular sectors, 3 columns at
    // 0.5 x 0.5, and one 3x0.5 curve wall). Both arrive as a one-position table
    // and both must render no control, so the panel sees 7.
    //
    // It was 8 until row D1: `floor|curve|separate wall` was the third
    // inexpressible one and that family is gone, because all 41 of its records
    // were bases. The same row took `wall|hex|thick wall` from 56 records to 8.
    const bare = TEMPLATE_FAMILIES.filter(
      (family) => family.kind === 'family' && family.sizes.length === 0,
    ).map((family) => family.template.source)
    expect(bare.sort()).toEqual(
      [
        // B3's five empty domains, 183 records.
        'wall|diagonal|separate wall',
        'wall|hex|thick wall',
        'decor|straight|-',
        'wall|octagon|separate wall',
        'floor|octagon|-',
        // Two whose whole domain is inexpressible.
        'stair|curve|-',
        'column|corner|s2w',
      ].sort(),
    )
  })

  it('offers no position that matches nothing, and no family that matches nothing', () => {
    // **The property that makes the row's number safe to show.** A palette that
    // offered a size admitting nothing would be a control with a trap in it, and
    // a family admitting nothing would arm a placement whose only slot can never
    // be filled. Measured through `@/composition`'s own resolution, which is the
    // one a fill will use.
    const composition = createCompositionIndex(loaded!, aggregates)
    const empty: string[] = []
    for (const family of TEMPLATE_FAMILIES) {
      if (family.kind !== 'family') continue
      if (candidateCount(composition, family) === 0) empty.push(`${family.name} (any size)`)
      for (const position of family.sizes) {
        if (candidateCount(composition, family, position.tags) === 0) {
          empty.push(`${family.name} — ${position.label}`)
        }
      }
    }
    expect(empty).toEqual([])
  })

  it('counts every record it can place exactly once, over all 47 families', () => {
    // **8,417 candidate records against 8,702 in the index, and the 285 between
    // them are the inserts no family is generated for.** So the 47 families
    // *partition* what the palette can place — which they did not before row
    // D1: the sum was 10,380, because `shape-base`'s 1,963 were also admitted
    // by a role family (a base keeps the role of the piece it sits under) and
    // 1,678 of the 10,380 were that double count less the inserts.
    //
    // `GROUP_ORDER` still puts `base` after the seven roles rather than among
    // them, and the reason is unchanged: the *records* carrying `role|wall`
    // include 1,117 bases, so a table of records per role and a table of
    // families per role are two different readings of the corpus.
    const composition = createCompositionIndex(loaded!, aggregates)
    const total = TEMPLATE_FAMILIES.filter((family) => family.kind === 'family').reduce(
      (sum, family) =>
        sum + composition.candidatesFor(resolveSlotTags(family.template.parts[0]!.tags, family.template.tags, [])).tiles.length,
      0,
    )
    expect(total).toBe(8417)
    expect(records.length - total).toBe(285)
    expect(
      records.filter((record) => resolveTags(loaded!, record).includes('role|insert')),
    ).toHaveLength(285)
  })
})

/* --------------------------------------- 6. the map from an item to a family */

describeCorpus('every item but the inserts resolves to a family', () => {
  const tagsOfPreview = (item: TileAggregate): readonly string[] => {
    const record = byId.get(item.preview)
    return record === undefined ? [] : resolveTags(loaded!, record)
  }

  /**
   * The family an item's own tags name, through the **constructed** key.
   *
   * `familyKey.ts` builds the id rather than looking it up, so this composition
   * — construct, then find the row — is the whole of what the drawer does, and
   * the assertions below are about both halves at once: a constructed id that
   * named no family would show up here as an unmapped design.
   */
  const familyOfItem = (item: TileAggregate) => {
    const arm = armForTags(tagsOfPreview(item))
    return arm === undefined ? undefined : familyById(arm.template)
  }

  it('names a family for 3,728 of 3,822 designs, and refuses 94 inserts by name', () => {
    // They *must* partition: every record carries exactly one role and one form,
    // so the families cover the corpus and the only designs left over are the
    // ones no family is generated for.
    const mapped = items.filter((item) => familyOfItem(item) !== undefined)
    expect(mapped).toHaveLength(3728)

    const refused = items.filter((item) => familyOfItem(item) === undefined)
    expect(refused).toHaveLength(INSERT_DESIGNS)
    expect(refused).toHaveLength(94)
    // All 94 are inserts, which is what lets the drawer say *where the tile goes
    // instead* rather than "this cannot be placed". `unclassified` is the other
    // answer and it is unreachable over this index — which is the assertion.
    expect(refused.filter((item) => armRefusalFor(tagsOfPreview(item)) !== 'insert')).toEqual([])
    // And they hold all 285 insert records.
    expect(
      records.filter((record) => resolveTags(loaded!, record).includes('role|insert')),
    ).toHaveLength(285)
  })

  it('hits an exact size position for 3,206 of the 3,728, and any-size for 522', () => {
    let exact = 0
    let any = 0
    for (const item of items) {
      const tags = tagsOfPreview(item)
      const family = familyOfItem(item)
      if (family === undefined) continue
      if (positionOf(family, tags).length > 0) exact += 1
      else any += 1
    }
    // 86.0%. So "Use in builder" usually arms *"Floor: Straight, 2 wide by 2
    // deep"* rather than the family at any size, which is as close as a template
    // model can come to "place this tile".
    expect(exact).toBe(3206)
    expect(any).toBe(522)
    expect(exact + any).toBe(3728)
  })

  it('is the same answer for every variant of every item, which is why a record may be asked', () => {
    // The drawer reads the **shown record's** tags rather than the item's, the
    // same shape as `foot`'s hoisting argument. This is the zero that makes that
    // safe: no item in the corpus has variants that disagree about either the
    // family or the size position.
    const disagreeing = items.filter((item) => {
      const arms = new Set(
        item.variants.map((variant) => {
          const record = byId.get(variant.id)
          const arm = record === undefined ? undefined : armForTags(resolveTags(loaded!, record))
          return arm === undefined ? 'none' : [arm.template, ...arm.size].join(' ')
        }),
      )
      return arms.size > 1
    })
    expect(disagreeing.map((item) => item.name)).toEqual([])
  })

  it('sends a base to the base family and not to the role it keeps', () => {
    // The order of the two questions is load bearing. A base carries the role of
    // the piece it sits under — 1,117 wall, 661 floor, 176 riser, 9 stair — so
    // asking the role first would file every one of them under a family whose
    // slot denies `shape|base`'s records outright.
    const bases = items.filter((item) => tagsOfPreview(item).includes('shape|base'))
    expect(bases.length).toBeGreaterThan(0)
    expect(
      bases.filter((item) => familyOfItem(item)?.id !== 'shape-base'),
    ).toEqual([])
    // And they are not a fringe: 340 of the 3,822 designs and 1,963 records.
    expect(bases).toHaveLength(340)
    expect(records.filter((record) => resolveTags(loaded!, record).includes('shape|base'))).toHaveLength(1963)
  })
})

/* ------------------- 6b. the constructed key against the generated one */

/**
 * **The one duplication this row introduced, held in place.**
 *
 * `familyKey.ts` builds a family's id and name from `(role, form, build)` rather
 * than looking them up, because a value import of the generated table from the
 * catalog drawer puts that table in the entry chunk — an A/B build measured
 * +5.95 kB gzip for every visitor to every page, and that module's docblock
 * carries the three-row table. The price is a second derivation of something the
 * generator owns, and the only acceptable answer to that is this comparison.
 */
describeCorpus('the drawer constructs the key the generator emitted', () => {
  /** The 46 keyed families. `shape-base` is not one of them by construction. */
  const keyed = TEMPLATE_FAMILIES.filter(
    (family) => family.kind === 'family' && family.template.source !== 'shape|base',
  )

  it('reproduces all 46 ids and all 46 names, with no exceptions', () => {
    expect(keyed).toHaveLength(46)
    const wrong = keyed.flatMap((family) => {
      const [role = '', form = '', build = '-'] = family.template.source.split('|')
      const system = build === '-' ? undefined : build
      const problems: string[] = []
      if (familySlug(role, form, system) !== family.id) {
        problems.push(`${family.template.source}: id ${familySlug(role, form, system)} != ${family.id}`)
      }
      if (familyName(role, form, system) !== family.name) {
        problems.push(`${family.template.source}: name ${familyName(role, form, system)} != ${family.name}`)
      }
      return problems
    })
    expect(wrong).toEqual([])
  })

  it('names every family it constructs, over all 3,822 designs', () => {
    // B4's generation rule seen from the other end: a family exists for every
    // `(role, form, build)` key the corpus carries, so a *constructed* key cannot
    // miss unless the generator stops doing that — at which point this fails
    // instead of the drawer arming an id nothing ships.
    const orphaned = items.flatMap((item) => {
      const record = byId.get(item.preview)
      const tags = record === undefined ? [] : resolveTags(loaded!, record)
      const arm = armForTags(tags)
      if (arm === undefined) return []
      return TEMPLATE_FAMILIES.some((family) => family.id === arm.template) ? [] : [item.name]
    })
    expect(orphaned).toEqual([])
  })

  it('names the family the drawer is about to arm, for the drawer to print', () => {
    // The disclosure the press needs: the drawer says which family it will arm,
    // and the name it prints is the family's own — not a paraphrase of it.
    for (const family of keyed.slice(0, 8)) {
      const record = records.find((candidate) =>
        family.template.parts[0] !== undefined &&
        resolveTags(loaded!, candidate).includes(`role|${family.role ?? ''}`) &&
        resolveTags(loaded!, candidate).includes(`form|${family.form ?? ''}`),
      )
      if (record === undefined) continue
      const tags = resolveTags(loaded!, record)
      const name = armNameForTags(tags)
      expect(name).toBe(TEMPLATE_FAMILIES.find((row) => row.id === armForTags(tags)?.template)?.name)
    }
  })
})

/* ----------------------------- 7. the one contract this row cannot satisfy alone */

describeCorpus('a placement resolves only against the whole template table', () => {
  const lookupOver = (templates: readonly { readonly id: string }[]): TemplateLookup => {
    const table = new Map(templates.map((template) => [template.id, template as AssemblyTemplate]))
    return (id) => table.get(id)
  }

  const anInstanceOf = (id: string): TemplateInstance =>
    ({
      id: '00000000-0000-4000-8000-000000000000' as PlacementId,
      template: id as TemplateId,
      x: 0,
      z: 0,
      rotation: 0,
      fills: {},
    }) satisfies TemplateInstance

  it('reports a family placement unknown-template against the 40 recipes alone', () => {
    // **The seam row C1 cannot close from inside its own files, measured.**
    // `screens/builder/BuilderScreen.tsx` builds its recipe table as
    // `new Map(RECIPE_TEMPLATES.map(…))` — the 40 — which was right for every id
    // that existed before this row and is wrong for all 47 families. Against that
    // table every placement the new palette arms resolves to no parts and one
    // `warn` note, which `billView.ts` renders as *"1 placed piece names a recipe
    // this build does not ship"*. That file belongs to row C3;
    // `PLACEABLE_TEMPLATES` is the one line it needs.
    const assembly = buildAssemblyIndex(loaded!)
    const composition = createCompositionIndex(loaded!, aggregates)
    const family = TEMPLATE_FAMILIES.find((row) => row.kind === 'family')!
    const instance = anInstanceOf(family.id)

    const stale = buildBillOfTiles([instance], assembly, {
      templates: lookupOver(RECIPE_TEMPLATES),
      composition,
    })
    expect(stale.notes.map((note) => note.code)).toEqual(['unknown-template'])
    expect(stale.parts).toBe(0)

    const whole = buildBillOfTiles([instance], assembly, {
      templates: lookupOver(PLACEABLE_TEMPLATES),
      composition,
    })
    // With the whole table the instance resolves: one slot, unfilled, which is
    // contract **C-g**'s legitimate state and row C2's to fill.
    expect(whole.notes.map((note) => note.code)).toEqual(['slot-unfilled'])
    expect(whole.unfilled.map((slot) => slot.slot)).toEqual([family.template.parts[0]!.name])
  })

  it('resolves all 87 against the whole table, and none of them against the 40', () => {
    const assembly = buildAssemblyIndex(loaded!)
    const composition = createCompositionIndex(loaded!, aggregates)
    const whole = lookupOver(PLACEABLE_TEMPLATES)
    const forty = lookupOver(RECIPE_TEMPLATES)

    const unknownAgainstWhole = TEMPLATE_FAMILIES.filter(
      (family) =>
        buildBillOfTiles([anInstanceOf(family.id)], assembly, { templates: whole, composition }).notes.some(
          (note) => note.code === 'unknown-template',
        ),
    )
    expect(unknownAgainstWhole).toEqual([])

    const unknownAgainstForty = TEMPLATE_FAMILIES.filter(
      (family) =>
        buildBillOfTiles([anInstanceOf(family.id)], assembly, { templates: forty, composition }).notes.some(
          (note) => note.code === 'unknown-template',
        ),
    )
    // Exactly the 47 families: the 40 recipes are in both tables.
    expect(unknownAgainstForty).toHaveLength(47)
  })
})
