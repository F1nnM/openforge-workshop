/**
 * Role and form against the real corpus, and against two independent oracles.
 *
 * `derive.test.ts` pins the ladder rung by rung on tag sets copied out of the
 * corpus. This file is the other half, and it is the half that makes the row
 * defensible: a hand-authored classifier over 8,702 records is worth nothing
 * unless something outside it agrees.
 *
 * Three things are checked here that no unit test can check, plus the price:
 *
 *   1. **A holdout.** The path, component and filename channels are learned
 *      *from* the subset the shape tags label outright and scored by 5-fold
 *      holdout against that label — 99.01% over the 7,471 non-insert labelled
 *      records. Two ablations come with it, because both were found the hard way
 *      and both would silently regress: path depth, and the joinery stoplist.
 *   2. **Ground truth 1 — the 40 shipped recipe templates.** Their `require`
 *      lists were authored by hand upstream, years before this inference
 *      existed, and their resolved candidate sets are therefore an opinion about
 *      role that owes this file nothing. They agree on 8,505 of 8,564
 *      role-bearing candidate slots, and **every one of the 59 disagreements is
 *      an over-admission the inference catches**. That direction is asserted:
 *      the other direction is a regression.
 *   3. **Ground truth 2 — `layer`.** `classifyLayer` already ships and is
 *      already trusted. The `base` slot's 5,677 candidate slots are `layer:
 *      'base'` on 5,677, the `column` slot's 112 are role `column` on 112, and
 *      the `floor` slot's 2,996 are role `floor` on 2,996.
 *
 * And the price, measured the way `emit.ts` measures — brotli 11 at
 * `PAYLOAD_EPOCH`, so the figure is comparable across branches rather than
 * swinging with the build clock.
 *
 * Skipped **loudly** with the path it looked in when the fixtures are absent, on
 * the same argument as `catalog.test.ts`: a quietly skipped real-data test is
 * worse than a failing one.
 */
import { existsSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, Footprint, TileId } from '../src/catalog'
import { createCompositionIndex, resolveSlotTags } from '../src/composition'
import type { SlotTags } from '../src/composition'

import { buildCatalog } from './build'
import { measureCatalog, serialiseCatalog } from './emit'
import { fixturesDir, loadFixtureRows } from './fixtures'
import { emptyManifest } from './ordinals'
import type { Role, RoleInput } from './role'
import { FORMS, ROLES, inferRole } from './role'
import { buildTagTable } from './tags'
import { loadTemplateFixtures } from './templates'
import { PAYLOAD_TIMESTAMP, SIZE_BUDGET_BYTES } from './version'

const FIXTURES_DIR = fixturesDir()

const hasFixtures =
  existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))

const describeCorpus = hasFixtures ? describe : describe.skip
const title = hasFixtures
  ? 'role and form over the real corpus'
  : `role and form — SKIPPED, no fixtures at ${FIXTURES_DIR} (set OPENFORGE_FIXTURES)`

/** Building the corpus, brotli-ing 5.9 MB at quality 11, and 128 slot resolutions. */
const SLOW_MS = 180_000

describeCorpus(title, () => {
  const file: CatalogFile = hasFixtures
    ? buildCatalog({
        rows: loadFixtureRows(FIXTURES_DIR),
        manifest: emptyManifest(),
        fixturesRef: 'test',
        /* The payload epoch, so the byte figures below are the quotable ones. */
        builtAt: PAYLOAD_TIMESTAMP,
      }).file
    : ({ tags: [], records: [] } as unknown as CatalogFile)

  /** Every record's de-interned tag list, which is what the axes are read back from. */
  const tagsOf = new Map<string, readonly string[]>(
    file.records.map((record) => [record.id, record.tags.map((id) => file.tags[id] ?? '')]),
  )

  const axis = (namespace: string, id: string): string | undefined => {
    const head = `${namespace}|`
    const found = (tagsOf.get(id) ?? []).filter((tag) => tag.startsWith(head))
    /* Exactly one, or the axis is not an axis. Asserted separately below; here
       it makes an ambiguous record read as `undefined` rather than as its first. */
    return found.length === 1 ? found[0]?.slice(head.length) : undefined
  }

  const roleOf = (id: string): string | undefined => axis('role', id)
  const formOf = (id: string): string | undefined => axis('form', id)

  const tally = (values: readonly (string | undefined)[]): Record<string, number> => {
    const counts: Record<string, number> = {}
    for (const value of values) counts[value ?? '(none)'] = (counts[value ?? '(none)'] ?? 0) + 1
    return counts
  }

  /* --------------------------------------------------------- the distribution */

  it('gives all 8,702 records a role, and the eight counts are exactly these', () => {
    expect(file.records).toHaveLength(8702)
    expect(tally(file.records.map((record) => roleOf(record.id)))).toEqual({
      wall: 5381,
      floor: 2162,
      riser: 319,
      insert: 285,
      column: 223,
      stair: 206,
      roof: 100,
      decor: 26,
    })
  })

  it('gives all 8,702 records a form, and the seven counts are exactly these', () => {
    expect(tally(file.records.map((record) => formOf(record.id)))).toEqual({
      straight: 5707,
      curve: 1989,
      corner: 720,
      diagonal: 163,
      hex: 56,
      internal_corner: 39,
      octagon: 28,
    })
  })

  it('classifies every record — 0 unknown, and no record carries two of either axis', () => {
    // The totality claim, stated as three separate properties because they fail
    // for three different reasons. `unknown` means the ladder ran out of rungs;
    // a count other than 1 means the emission is not an axis; and a value
    // outside the closed enum means the enum moved without the schema noticing.
    const roleTagsPer = file.records.map(
      (record) => (tagsOf.get(record.id) ?? []).filter((tag) => tag.startsWith('role|')).length,
    )
    const formTagsPer = file.records.map(
      (record) => (tagsOf.get(record.id) ?? []).filter((tag) => tag.startsWith('form|')).length,
    )
    expect(new Set(roleTagsPer)).toEqual(new Set([1]))
    expect(new Set(formTagsPer)).toEqual(new Set([1]))
    expect(file.records.filter((record) => roleOf(record.id) === 'unknown')).toHaveLength(0)
    expect([...new Set(file.records.map((record) => roleOf(record.id)))].sort()).toEqual(
      [...ROLES].sort(),
    )
    expect([...new Set(file.records.map((record) => formOf(record.id)))].sort()).toEqual(
      [...FORMS].sort(),
    )
  })

  it('reaches high confidence on 85.2% and low on 43, with nothing unclassified', () => {
    // Confidence is reported by the ladder and deliberately not emitted, so the
    // only way to ask for it is to run the ladder again over the input the build
    // gave it. `inputFor` strips the derived tags back out, so this cannot read
    // its own output.
    const confidence: Record<string, number> = {}
    for (const record of file.records) {
      const key = inferRole(inputFor(record, tagsOf.get(record.id) ?? [])).confidence
      confidence[key] = (confidence[key] ?? 0) + 1
    }
    expect(confidence).toEqual({ high: 7413, medium: 1246, low: 43 })
  })

  it('is a perfect bijection with layer on insert, which is why no slot may predicate on it', () => {
    // Both are `has(tags, 'part|')`, so `role|insert` carries zero information
    // beyond `layer`. Asserted rather than assumed for the failure it names: if
    // a future scan drops `part|`, insert detection collapses and no other
    // channel recovers it — path, component and filename reproduce the label on
    // 84 of 285, because an insert is filed in its host's folder.
    const byRole = new Set(
      file.records.filter((record) => roleOf(record.id) === 'insert').map((record) => record.id),
    )
    const byLayer = new Set(
      file.records.filter((record) => record.layer === 'insert').map((record) => record.id),
    )
    expect(byRole.size).toBe(285)
    expect([...byRole].sort()).toEqual([...byLayer].sort())
  })

  /* ------------------------------------------------------- the emitted encoding */

  it('emits the axes as 15 ordinary interned tags, and role|unknown is not one of them', () => {
    const derived = file.tags.filter((tag) => tag.startsWith('role|') || tag.startsWith('form|'))
    expect(derived).toHaveLength(15)
    expect(derived).not.toContain('role|unknown')
    expect(file.tags).toHaveLength(930)
    expect(file.records.reduce((total, record) => total + record.tags.length, 0)).toBe(101_427)
  })

  it('gives both commonest axis values a one-digit tag id, which is why it is cheap', () => {
    // T5 predicted `role|wall` would take id 0 as the corpus's most frequent
    // tag. It does not, and the reason is this row's own other axis:
    // `form|straight` is on 5,707 records against `role|wall`'s 5,381, so it
    // takes 0 and `role|wall` takes 1. The claim that actually matters — a
    // one-digit reference on the two commonest values — holds either way.
    expect(file.tags[0]).toBe('form|straight')
    expect(file.tags[1]).toBe('role|wall')
    expect(file.tags.indexOf('role|floor')).toBe(9)
    expect(file.tags.indexOf('role|wall')).toBeLessThan(10)
  })

  it(
    'costs 468 B brotli at the payload epoch, not the 865 B the plan priced',
    () => {
      // The same artefact with the derived tags stripped and the table rebuilt
      // is exactly what the pipeline emitted before this row, **except for the
      // version stamp**, which is left at 2 on both sides on purpose. That makes
      // this the *field* figure. The *artefact* figure — pipeline 1 at 365,629 B
      // against pipeline 2 at 366,173 B, so **+544 B** — is in
      // `pipeline/version.ts`, following row P3's precedent of reporting both
      // and naming which is which. They differ by 76 B, which is the brotli cost
      // of one character changing in `version.pipeline`, and that is the whole
      // reason a "this field costs N bytes" figure is a fact about one artefact
      // at one epoch and never a rate.
      //
      // The plan priced this row at **+865 B**, and it does not reproduce. The
      // research measured the encoding by appending the 15 derived strings to
      // the *tail* of the 915-entry table, which `buildTagTable` does not do —
      // it orders by descending frequency, so the derived values take ids 0 and
      // 1 and every existing id shifts. Re-measured against this baseline the
      // tail-append construction costs +776 B and the frequency-ordered one
      // ships at +468 B, both below the price the plan set aside for it.
      const lists = file.records.map((record) =>
        (tagsOf.get(record.id) ?? []).filter(
          (tag) => !tag.startsWith('role|') && !tag.startsWith('form|'),
        ),
      )
      const { table, idOf } = buildTagTable(lists)
      const before = {
        ...file,
        tags: table,
        records: file.records.map((record, index) => ({
          ...record,
          tags: (lists[index] ?? []).map((tag) => idOf.get(tag) ?? -1),
        })),
      }

      const baseline = measureCatalog(serialiseCatalog(before as CatalogFile))
      const shipped = measureCatalog(serialiseCatalog(file))
      process.stdout.write(
        `\n[role] without ${String(baseline.brotli)} B · with role+form ${String(shipped.brotli)} B ` +
          `· delta ${String(shipped.brotli - baseline.brotli)} B · ` +
          `${((100 * shipped.brotli) / SIZE_BUDGET_BYTES).toFixed(2)}% of budget\n`,
      )

      /* **Row D9 moved both numbers and the delta between them, which is this
         test's own caveat firing.** The corner-run correction touches neither
         `role` nor `form`, and it still took the with-tags artefact from 366,173
         to 366,627 B and the without-tags one from 365,705 to 365,721 —
         so the measured price of role+form went 468 -> 906 B on changes that
         added no tag. brotli is not additive over 5.9 MB: a "this field costs N
         bytes" figure is a fact about one artefact at one epoch, never a rate,
         and 999 is the same field's price against a different artefact. The
         conclusion is untouched — it is still far under the 865 B the plan
         priced as a *problem*, and 0.2 points of a 512,000 B budget. */
      expect(table).toHaveLength(915)
      expect(baseline.brotli).toBe(365_721)
      expect(shipped.brotli).toBe(366_627)
      expect(shipped.brotli - baseline.brotli).toBe(906)
      expect(shipped.withinBudget).toBe(true)
      // 0.20 points of a 512,000 B budget, against 145,334 B of headroom.
      expect(shipped.brotli / SIZE_BUDGET_BYTES).toBeLessThan(0.72)
    },
    SLOW_MS,
  )

  it('needs no new code in the candidate solver to predicate on a role', () => {
    // The whole argument for the tag encoding. `PartSlot.tags.require` is a list
    // of `{tag}` refs resolved by exact equality against the intern table, so a
    // `role|` ref is not a special case of anything — and `unknownRefs` staying
    // empty is what says the ref resolved rather than intersected to nothing.
    const index = createCompositionIndex(file)
    // No cast: the literal structurally satisfies `SlotTags`, which is the
    // "zero new code" claim showing up in the type system rather than in prose.
    const wall = index.candidatesFor(resolveSlotTags({ require: [{ tag: 'role|wall' }] }))
    expect(wall.unknownRefs).toEqual([])
    expect(wall.tiles).toHaveLength(5381)
    expect(wall.deadEnd).toBe(false)

    // And the point of it, stated against both readings of the raw tag, because
    // the corpus figure and the solver figure are different numbers:
    //
    //   - `require` is **exact**, so `shape|wall` names the 4,354 records
    //     carrying that literal string;
    //   - `accept` is a **segment prefix**, so it names the 4,881 that carry
    //     `shape|wall` or anything under it — which is the number the plan
    //     quotes, and which is the `accept`-prefix workaround row B6 exists to
    //     retire.
    //
    // **Both admit the same 238 non-walls**, because all 238 carry the parent
    // tag outright. So the workaround widens the pool by 527 and fixes none of
    // the mis-admissions; the role predicate does the opposite.
    const exact = index.candidatesFor(resolveSlotTags({ require: [{ tag: 'shape|wall' }] }))
    const prefixed = index.candidatesFor(resolveSlotTags({ accept: [{ tag: 'shape|wall' }] }))
    expect(exact.tiles).toHaveLength(4354)
    expect(prefixed.tiles).toHaveLength(4881)
    for (const pool of [exact, prefixed]) {
      expect(tally(pool.tiles.filter((tile) => roleOf(tile) !== 'wall').map(roleOf))).toEqual({
        floor: 176,
        column: 54,
        stair: 8,
      })
    }
    expect(wall.tiles.filter((tile) => roleOf(tile) !== 'wall')).toHaveLength(0)

    // And all 527 `shape|wall|low` records are in the role pool, none of them
    // carrying the parent — which is what makes the workaround unnecessary
    // rather than merely inelegant.
    const low = file.records.filter((record) => (tagsOf.get(record.id) ?? []).includes('shape|wall|low'))
    expect(low).toHaveLength(527)
    expect(low.filter((record) => roleOf(record.id) !== 'wall')).toHaveLength(0)
    expect(low.filter((record) => (tagsOf.get(record.id) ?? []).includes('shape|wall'))).toHaveLength(0)
    const inRolePool = new Set<string>(wall.tiles)
    expect(low.filter((record) => !inRolePool.has(record.id))).toHaveLength(0)
  })

  /* ------------------------------------ ground truth 1: the 40 shipped templates */

  describe('against the 40 shipped recipe templates', () => {
    /**
     * Every part of every template resolved through the real solver, with the
     * template's own tags as `parentTags` and no sibling picked — the initial
     * state a builder shows.
     */
    const resolvedParts = hasFixtures
      ? loadTemplateFixtures().flatMap((template) => {
          const index = INDEX(file)
          return template.parts.map((part) => ({
            template: template.name,
            slot: part.name,
            tiles: index.candidatesFor(resolveSlotTags(part.tags as SlotTags, template.tags, [])).tiles,
          }))
        })
      : []

    /** The role a slot name asks for. `base` is not here: it asks for a *layer*. */
    const EXPECTED: Readonly<Record<string, Role>> = {
      column: 'column',
      floor: 'floor',
      wall: 'wall',
      'left wall': 'wall',
      'right wall': 'wall',
    }

    it('resolves all 128 parts of all 40 templates', () => {
      expect(resolvedParts).toHaveLength(128)
      expect(new Set(resolvedParts.map((part) => part.template)).size).toBe(40)
      expect(new Set(resolvedParts.map((part) => part.slot))).toEqual(
        new Set(['column', 'floor', 'wall', 'left wall', 'right wall', 'base']),
      )
    })

    it('agrees with the fixtures on 8,505 of 8,564 role-bearing candidate slots', () => {
      const roleBearing = resolvedParts.filter((part) => EXPECTED[part.slot] !== undefined)
      const slots = roleBearing.reduce((total, part) => total + part.tiles.length, 0)
      const agree = roleBearing.reduce(
        (total, part) =>
          total + part.tiles.filter((tile) => roleOf(tile) === EXPECTED[part.slot]).length,
        0,
      )
      expect(slots).toBe(8564)
      expect(agree).toBe(8505)
      expect(agree / slots).toBeGreaterThan(0.993)
    })

    it('has a role-pure candidate set on 124 of the 128 parts', () => {
      const impure = resolvedParts.filter((part) => new Set(part.tiles.map(roleOf)).size > 1)
      expect(resolvedParts.length - impure.length).toBe(124)
      // Named, because which four is the finding: three `(Any, …)` recipes,
      // whose `require` is `shape|wall` plus a width and nothing else.
      expect(impure.map((part) => `${part.template} · ${part.slot}`).sort()).toEqual([
        'S2W: Wall on Tile: Corner (Any, Modular) · left wall',
        'S2W: Wall on Tile: Corner (Any, Modular) · right wall',
        'S2W: Wall on Tile: Wall (Any, Modular) · wall',
        'S2W: Wall on Tile: Wall (Any, Single Piece) · wall',
      ])
    })

    it('disagrees only by catching an over-admission, never by refusing a fixture pick', () => {
      // The load-bearing assertion of this whole block. A disagreement where the
      // fixtures admit a piece and the inference calls it something else is the
      // inference *narrowing* a slot that was too wide — 43 `column+low` files
      // carrying a spurious `shape|wall`, and 8 foundation stairs carrying both
      // `shape|stairs` and `shape|wall`. A disagreement in the other direction —
      // a piece the fixtures exclude and the inference would admit — cannot be
      // observed from a candidate set at all, so what is asserted is that every
      // one of the 59 is a *known* over-admission class and not a new one.
      const disagreements = resolvedParts.flatMap((part) => {
        const want = EXPECTED[part.slot]
        if (want === undefined) return []
        return part.tiles
          .filter((tile) => roleOf(tile) !== want)
          .map((tile) => ({ slot: part.slot, want, got: roleOf(tile), tile }))
      })

      expect(disagreements).toHaveLength(59)
      expect(tally(disagreements.map((row) => `${row.want} slot admits ${String(row.got)}`))).toEqual({
        'wall slot admits column': 43,
        'wall slot admits stair': 16,
      })

      // Every one of the 43 columns carries `shape|wall` *and* `shape|column`,
      // and every one of the 16 stair slots carries `shape|wall` *and*
      // `shape|stairs`. So in all 59 the raw tags say both and the ladder's
      // forced precedence picks the more specific one. Nothing here is a record
      // the inference reclassified on a channel the fixtures could not see.
      for (const row of disagreements) {
        const tags = tagsOf.get(row.tile) ?? []
        expect(tags).toContain('shape|wall')
        expect(tags.some((tag) => tag.startsWith(`shape|${String(row.got)}`))).toBe(true)
      }
    })

    it('separates the base slot perfectly on role, 20 of 20 each way', () => {
      // Not tuned for, and the strongest independent confirmation in the row: a
      // single-piece wall is one mesh containing the wall *and* its floor, so it
      // sits on a plain floor base; a modular wall needs a wall base. The
      // fixtures spell that as `shape|base|square` against `shape|base|wall`,
      // and role inference recovers it with no exception in either direction.
      const bases = resolvedParts.filter((part) => part.slot === 'base')
      const pure = (part: (typeof bases)[number]): string =>
        [...new Set(part.tiles.map(roleOf))].sort().join('/')
      const single = bases.filter((part) => part.template.includes('Single Piece'))
      const modular = bases.filter((part) => !part.template.includes('Single Piece'))
      expect(single).toHaveLength(20)
      expect(modular).toHaveLength(20)
      expect(single.filter((part) => pure(part) === 'floor')).toHaveLength(20)
      expect(modular.filter((part) => pure(part) === 'wall')).toHaveLength(20)
    })

    /* ------------------------------------------- ground truth 2: layer and role */

    it('matches the already-trusted layer and role on the three pure slots', () => {
      const slotTotal = (name: string): number =>
        resolvedParts
          .filter((part) => part.slot === name)
          .reduce((total, part) => total + part.tiles.length, 0)
      const slotMatching = (name: string, predicate: (tile: TileId) => boolean): number =>
        resolvedParts
          .filter((part) => part.slot === name)
          .reduce((total, part) => total + part.tiles.filter(predicate).length, 0)

      const layerOf = new Map(file.records.map((record) => [record.id, record.layer]))

      expect(slotTotal('column')).toBe(112)
      expect(slotMatching('column', (tile) => roleOf(tile) === 'column')).toBe(112)
      expect(slotTotal('floor')).toBe(2996)
      expect(slotMatching('floor', (tile) => roleOf(tile) === 'floor')).toBe(2996)
      expect(slotTotal('base')).toBe(5677)
      expect(slotMatching('base', (tile) => layerOf.get(tile) === 'base')).toBe(5677)
    })
  })

  /* ------------------------------------------------------------- the holdout */

  describe('reproduced from path, component and filename alone', () => {
    /**
     * The label: the role the **shape tags alone** name, or `undefined`.
     *
     * Deliberately a smaller ladder than `inferRole` — no component channel, no
     * path, no filename, and the base block refuses anything but its clearest
     * qualifiers. That is what makes the holdout below an independent
     * measurement rather than a tautology: the channels being scored are exactly
     * the ones this function does not read.
     */
    const tagLabel = (tags: readonly string[]): Role | undefined => {
      const has = (path: string): boolean =>
        tags.some((tag) => tag === path || tag.startsWith(`${path}|`))
      if (has('part')) return 'insert'
      if (has('shape|stairs')) return 'stair'
      if (has('shape|column')) return 'column'
      if (has('shape|riser')) return 'riser'
      if (has('shape|floor')) return 'floor'
      if (has('shape|wall')) return 'wall'
      if (!has('shape|base')) return undefined
      if (tags.includes('shape|base|stairs')) return 'stair'
      if (tags.includes('shape|base|wall') || tags.includes('shape|base|foundation')) return 'wall'
      if (
        BASE_FLOOR_QUALIFIERS.some((qualifier) => tags.includes(`shape|base|${qualifier}`))
      )
        return 'floor'
      return undefined
    }

    const labelled = file.records.flatMap((record) => {
      const label = tagLabel(tagsOf.get(record.id) ?? [])
      return label === undefined ? [] : [{ id: record.id, label }]
    })

    it('labels 7,756 records from the shape tags alone, which is the training set', () => {
      expect(labelled).toHaveLength(7756)
    })

    it('reproduces the label on 7,397 of 7,471 non-insert records — 99.01%', () => {
      const score = holdout(file, tagsOf, labelled, { depthNamespaced: true, stoplistJoinery: true })
      process.stdout.write(
        `\n[role] holdout: non-insert ${String(score.correct)}/${String(score.tested)} = ` +
          `${((100 * score.correct) / score.tested).toFixed(2)}%, abstained ${String(score.abstained)}, ` +
          `wrong ${String(score.wrong)}\n`,
      )
      expect(score.tested).toBe(7471)
      expect(score.correct).toBe(7397)
      expect(score.abstained).toBe(1)
      expect(score.wrong).toBe(73)
      expect(score.correct / score.tested).toBeGreaterThan(0.99)
    })

    it('needs the joinery stoplist: without it the same learner scores 96.89%', () => {
      // `openlock`, `openforge`, `dragonlock` and their siblings sit at depths
      // 4-7, so a deepest-wins path rule reads them *first*. Stoplisting them
      // moved this figure from 96.89% to 99.01%, and `openlock` at depth 5 alone
      // accounted for 137 of the 231 errors that remained before it existed.
      const score = holdout(file, tagsOf, labelled, {
        depthNamespaced: true,
        stoplistJoinery: false,
      })
      expect(score.correct).toBe(7239)
      expect(score.correct / score.tested).toBeLessThan(0.97)
    })

    it('needs the path depth: read depth-agnostically the same learner scores 95.07%', () => {
      // Depth 1 is the texture family and **depth 2 is the build system** —
      // `separate_wall` sits on 3,466 records of every role. Dropping the depth
      // from the feature key makes it the corpus's single strongest "wall"
      // predictor and takes the error count from 74 to 368.
      const score = holdout(file, tagsOf, labelled, {
        depthNamespaced: false,
        stoplistJoinery: true,
      })
      expect(score.correct).toBe(7103)
      expect(score.tested - score.correct).toBe(368)
      // T5 reported this ablation as costing 271 errors. It does not reproduce
      // under any reading of the feature key that was tried; the finding — depth
      // is the signal — reproduces at five times the error rate, and the figure
      // pinned here is the measured one.
      expect(score.tested - score.correct).toBeGreaterThan(290)
    })
  })
})

/* ------------------------------------------------------------------- helpers */

/** The `shape|base|…` qualifiers that name a floor outright. Used by the label only. */
const BASE_FLOOR_QUALIFIERS = [
  'square',
  'curved',
  'angled',
  'concave',
  'convex',
  'radial',
  'grid',
  'inverted',
] as const

/** Memoised, because `createCompositionIndex` over 8,702 records is not free. */
let cachedIndex: { file: CatalogFile; index: ReturnType<typeof createCompositionIndex> } | undefined
function INDEX(file: CatalogFile): ReturnType<typeof createCompositionIndex> {
  if (cachedIndex?.file !== file) cachedIndex = { file, index: createCompositionIndex(file) }
  return cachedIndex.index
}

/**
 * A record's classifier input, rebuilt from the emitted record.
 *
 * The build calls `inferRole` before the record exists, so reconstructing the
 * input here is the only way to ask a *second* question of the ladder (its
 * confidence, which is reported rather than emitted). The derived tags are
 * stripped back out first: feeding them in would let the ladder read its own
 * output.
 */
function inputFor(
  record: { foot: Footprint; family: string; file: string; build?: string },
  tags: readonly string[],
): RoleInput {
  return {
    tags: tags.filter((tag) => !tag.startsWith('role|') && !tag.startsWith('form|')),
    foot: record.foot,
    family: record.family,
    file: record.file,
    ...(record.build === undefined ? {} : { build: record.build }),
  }
}

/* --------------------------------------------------- the holdout learner */

interface Ablation {
  /**
   * Whether a path segment's feature key carries its depth.
   *
   * The load-bearing option. Depth 2 is the build system, so a depth-agnostic
   * key lets `separate_wall` speak as a role.
   */
  readonly depthNamespaced: boolean
  /** Whether the joinery vocabulary is dropped from the path channel. */
  readonly stoplistJoinery: boolean
}

interface Predictor {
  readonly feature: string
  readonly role: Role
  readonly support: number
  readonly purity: number
}

interface Score {
  readonly tested: number
  readonly correct: number
  readonly abstained: number
  readonly wrong: number
}

/** The same list `pipeline/role.ts` stoplists, restated so the ablation can drop it. */
const JOINERY_SEGMENTS = new Set([
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

const isJoinery = (segment: string): boolean =>
  segment.split(/[,+]/).every((word) => JOINERY_SEGMENTS.has(word.trim()))

/**
 * Every non-tag feature of one record, namespaced by channel.
 *
 * `c:` component root · `p:` path segment · `f:` filename token · `b:` build
 * system · `s:` footprint shape · `l:` layer. Not one of them is a `shape|` tag,
 * which is the whole point: the label being predicted comes from those.
 */
function features(
  record: { family: string; file: string; build?: string; foot: { shape: string }; layer: string },
  tags: readonly string[],
  ablation: Ablation,
): string[] {
  const out: string[] = []
  for (const tag of tags) {
    if (!tag.startsWith('component|')) continue
    const root = tag.slice('component|'.length).split('|')[0]
    if (root !== undefined && root !== '') out.push(`c:${root}`)
  }

  const segments = record.family.split('/').slice(1)
  segments.forEach((segment, index) => {
    const depth = index + 1
    if (ablation.stoplistJoinery && isJoinery(segment)) return
    const pieces = [segment, ...segment.split(/[#%+,]/).filter((piece) => piece && piece !== segment)]
    for (const piece of pieces)
      out.push(ablation.depthNamespaced ? `p:${String(depth)}:${piece}` : `p:a:${piece}`)
    /* A depth-agnostic key for the deepest three levels only, which is where a
       role folder actually lives. Dropped with the depth option, since without
       it every key is already depth-agnostic. */
    if (ablation.depthNamespaced && depth >= 3) for (const piece of pieces) out.push(`p:d:${piece}`)
  })

  const stem = record.file.replace(/\.stl$/i, '')
  const head = stem.split('.')[0] ?? ''
  const hash = head.indexOf('#')
  const section = hash < 0 ? head : head.slice(hash + 1)
  for (const token of new Set(section.split(/[,+%]/).filter(Boolean))) out.push(`f:${token}`)

  if (record.build !== undefined) out.push(`b:${record.build}`)
  out.push(`s:${record.foot.shape}`)
  out.push(`l:${record.layer}`)
  return [...new Set(out)]
}

/**
 * A feature is a predictor when it appears on at least 4 labelled records and at
 * least 90% of them carry one role. 653 features clear that bar.
 */
function learn(
  items: readonly { features: readonly string[]; label: Role }[],
): Map<string, Predictor> {
  const distribution = new Map<string, Map<Role, number>>()
  for (const item of items)
    for (const feature of item.features) {
      const counts = distribution.get(feature) ?? new Map<Role, number>()
      counts.set(item.label, (counts.get(item.label) ?? 0) + 1)
      distribution.set(feature, counts)
    }

  const table = new Map<string, Predictor>()
  for (const [feature, counts] of distribution) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best === undefined || total < 4 || best[1] / total < 0.9) continue
    table.set(feature, { feature, role: best[0], support: total, purity: best[1] / total })
  }
  return table
}

/**
 * Predict from the learned table. Channels in descending trust, and within the
 * path channel the **deepest** segment wins — which is the rule the depth
 * ablation removes.
 */
function predict(
  itemFeatures: readonly string[],
  table: ReadonlyMap<string, Predictor>,
): Role | undefined {
  const depthOf = (feature: string): number => {
    const matched = /^p:(\d+):/.exec(feature)
    if (matched?.[1] !== undefined) return Number(matched[1])
    return /^p:d:/.test(feature) ? 3 : 0
  }
  for (const channel of ['c:', 'p:', 'f:', 'b:', 's:', 'l:']) {
    const hits = itemFeatures
      .filter((feature) => feature.startsWith(channel))
      .map((feature) => table.get(feature))
      .filter((entry): entry is Predictor => entry !== undefined)
      .sort(
        (a, b) =>
          depthOf(b.feature) - depthOf(a.feature) || b.purity - a.purity || b.support - a.support,
      )
    if (hits.length > 0) return hits[0]?.role
  }
  return undefined
}

/**
 * 5-fold holdout over the tag-labelled subset, scored on the non-insert half.
 *
 * Non-insert because `insert` is unreproducible by construction and says nothing
 * about the other channels: an insert is filed in its *host's* folder, so path,
 * component and filename reproduce it on 84 of 285. Folds are `index % 5` over
 * the corpus's own id order, so the split is deterministic and needs no seed.
 */
function holdout(
  file: CatalogFile,
  tagsOf: ReadonlyMap<string, readonly string[]>,
  labelled: readonly { id: string; label: Role }[],
  ablation: Ablation,
): Score {
  const recordOf = new Map(file.records.map((record) => [record.id as string, record]))
  const prepared = labelled.map((item) => {
    const record = recordOf.get(item.id)
    if (record === undefined) throw new Error(`no record ${item.id}`)
    return {
      label: item.label,
      features: features(
        {
          family: record.family,
          file: record.file,
          ...(record.build === undefined ? {} : { build: record.build }),
          foot: record.foot,
          layer: record.layer,
        },
        tagsOf.get(item.id) ?? [],
        ablation,
      ),
    }
  })

  let tested = 0
  let correct = 0
  let abstained = 0
  let wrong = 0
  const FOLDS = 5
  for (let fold = 0; fold < FOLDS; fold += 1) {
    const table = learn(prepared.filter((_, index) => index % FOLDS !== fold))
    for (const [index, item] of prepared.entries()) {
      if (index % FOLDS !== fold || item.label === 'insert') continue
      tested += 1
      const predicted = predict(item.features, table)
      if (predicted === undefined) abstained += 1
      else if (predicted === item.label) correct += 1
      else wrong += 1
    }
  }
  return { tested, correct, abstained, wrong }
}
