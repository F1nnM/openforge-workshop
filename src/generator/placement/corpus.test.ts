/// <reference types="node" />
/**
 * A generated base against the real archive.
 *
 * Skipped when `public/catalog/catalog.json` has not been built, the way S4's
 * `corpus.test.ts` and `src/search/corpus.test.ts` are, and CI builds it before
 * the suite runs.
 *
 * **What these prove.** Three things that a handcrafted fixture cannot: that the
 * `kinds` this row restates are the buckets the archive's own plain bases carry,
 * that a generated base and an archived plain base resolve to one material
 * through one registry, and how much of row D5's missing-base gap the generator
 * can actually close. The last is a *measurement*, pinned, so a corpus that grew
 * or shrank fails with a number to read rather than passing quietly.
 *
 * **What they cannot prove.** Nothing renders. The gap figures are about
 * footprints and the schema's own dropdowns — a claim that the geometry produces
 * a printable base at `8x8` is not made here and would need an engine.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { baseGap, buildAssemblyIndex, matchBase } from '@/assembly'
import type { CatalogFile as CatalogFileType, CatalogRecord, Footprint } from '@/catalog'
import { resolveTags } from '@/catalog'
import { resolveMaterial } from '@/materials'

import { isDimensionSize, splitBaseFilename } from '../panel/resolve'
import { PANEL_ENTRIES, panelSchema } from '../panel/schemas'

import { generatedStyle } from './geometry'
import type { GeneratedPlacement } from './scene'
import { GENERATED_SHAPES } from './scene'

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)
const describeCorpus = present ? describe : describe.skip
const title = present
  ? 'a generated base against the real archive'
  : `the archive — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/**
 * The morphology token set each panel entry point's archived bases carry.
 *
 * Read off the filenames rather than guessed. Two things the archive's spelling
 * forces: the sweep renamed one shape between runs, so `base+s2w+square+wall`
 * and `base+square+s2w+wall` are one shape under two names and these are token
 * *sets*; and a riser's morphology carries its height name
 * (`riser+low+square`), so that one is a containment rather than an equality.
 */
const MORPHOLOGY_TOKENS: Readonly<Record<(typeof PANEL_ENTRIES)[number], readonly string[]>> = {
  'bases-square.scad': ['base', 'square'],
  'bases-square-wall.scad': ['base', 's2w', 'square', 'wall'],
  'bases-square-corner.scad': ['base', 's2w', 'square', 'corner'],
  'bases-square-internal_corner.scad': ['base', 's2w', 'square', 'internal_corner'],
  'risers_square.scad': ['riser', 'square'],
}

/** How many archived bases each shape has, so a shrinking corpus is visible. */
const MORPHOLOGY_COUNTS: Readonly<Record<(typeof PANEL_ENTRIES)[number], number>> = {
  'bases-square.scad': 202,
  'bases-square-wall.scad': 36,
  'bases-square-corner.scad': 29,
  'bases-square-internal_corner.scad': 8,
  'risers_square.scad': 128,
}

function tokensOf(file: string): ReadonlySet<string> {
  return new Set(splitBaseFilename(file).morphology.split(/[+,]/).filter((token) => token !== ''))
}

describeCorpus(title, () => {
  const file = JSON.parse(readFileSync(CATALOG, 'utf8')) as CatalogFileType
  const index = buildAssemblyIndex(file)
  const plainBases = file.records.filter((record) => record.layer === 'base' && record.file.startsWith('plain#'))

  it('restates the kinds the archive’s own plain bases carry', () => {
    for (const entry of PANEL_ENTRIES) {
      const want = MORPHOLOGY_TOKENS[entry]
      const riser = entry === 'risers_square.scad'
      const matching = plainBases.filter((record) => {
        // Dimensioned sizes only. A letter-code base like
        // `plain#base+square.E.…` shares the morphology and is a different
        // thing entirely — it is filed under `separate_wall/primary_floors` and
        // carries `["base","floor"]` — and no generator parameter names a letter
        // code, so it is not what this table is about.
        if (!isDimensionSize(splitBaseFilename(record.file).size)) return false
        const tokens = tokensOf(record.file)
        return want.every((token) => tokens.has(token)) && (riser || tokens.size === want.length)
      })
      expect(matching, `${entry} archived bases`).toHaveLength(MORPHOLOGY_COUNTS[entry])
      // Every archived base of this shape agrees on its kind buckets, and that
      // agreement is what makes a single restated table honest rather than a
      // majority vote.
      const distinct = new Set(matching.map((record) => [...record.kinds].sort().join(',')))
      expect([...distinct], `${entry} kinds`).toEqual([[...GENERATED_SHAPES[entry].kinds].sort().join(',')])
    }
  })

  it('resolves to the same material an archived plain base does', () => {
    // Both sides go through `src/materials`, which is the point: this row picks
    // no material of its own.
    const archived = plainBases[0] as CatalogRecord
    const fromArchive = resolveMaterial(resolveTags(file, archived), archived.file).family
    const placement = {
      base: 'gen:v1 bases-square.scad x=2',
      recipe: { v: 1, entry: 'bases-square.scad', parameters: { x: 2, y: 2 } },
      x: 0,
      z: 0,
      rotation: 0,
    } as unknown as GeneratedPlacement
    const generated = generatedStyle(placement)
    expect(generated.material).toBe(fromArchive.id)
    expect(generated.material).toBe('plain')
    expect(generated.tint).toBe(fromArchive.tint)
    expect(generated.label).toBe(fromArchive.label)
  })

  it('closes 4 of the archive’s 377 base gaps, and not one more', () => {
    // Row D5's gap, asked of `matchBase` directly — the probe row A6 exported
    // for exactly this, since rule 0 means `resolvePlacement` no longer observes
    // the base match at all.
    //
    // What the generator can make is a `rect` whose two extents are both values
    // the schema's own `x` dropdown offers. That is a claim about the parameter
    // UI, which is checkable data, and not about what the geometry would accept:
    // S4's `schemas.ts` is explicit that a shape whose footprint the builder
    // cannot place must not be offered.
    const sizes = new Set(
      (panelSchema('bases-square.scad').parameters.find((parameter) => parameter.name === 'x')?.options ?? [])
        .map((option) => option.value)
        .filter((value): value is number => typeof value === 'number'),
    )
    expect([...sizes].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8])

    const generatable = (foot: Footprint): boolean => foot.shape === 'rect' && sizes.has(foot.w) && sizes.has(foot.d)

    let gaps = 0
    const byCode = new Map<string, number>()
    const closed = new Map<string, number>()
    for (const record of file.records) {
      if (record.layer !== 'topper') continue
      if (matchBase(record, index, 'openlock') !== undefined) continue
      gaps += 1
      // `baseGap` since row A3 — the same classification, returned as the code
      // rather than wrapped in a `Note`, because no bill can emit one now that
      // nothing inserts a base. It asks `matchBase` with **no** preference where
      // the filter above asks with openlock, and the assertion below is what
      // pins the two populations together: `'no-gap'` would appear the moment
      // they came apart, rather than being skipped in silence.
      const gap = baseGap(record, index) ?? 'no-gap'
      byCode.set(gap, (byCode.get(gap) ?? 0) + 1)
      if (!generatable(record.foot)) continue
      const key = JSON.stringify(record.foot)
      closed.set(key, (closed.get(key) ?? 0) + 1)
    }

    // The three gaps D5 separated, reproduced here rather than restated: a base
    // the corpus should have, a shape nothing supports, and a topper with no key
    // at all.
    expect(gaps).toBe(377)
    expect(Object.fromEntries([...byCode].sort())).toEqual({
      'base-unmatchable': 260,
      'no-congruent-base': 31,
      'no-matching-base': 86,
    })

    // **Four toppers, and they are exactly the four D5 named.** Its 21
    // "unsupportable thin strips" are `0.5x2` ×14, `0.5x1` ×3 and `2x6` ×4; the
    // `2x6` is a plain rectangle the generator makes at `x=6, y=2`, and the
    // 0.5-unit strips are not on the `x` dropdown at all. So the generator
    // closes 4 of 377 and the panel must not imply more: 260 of the rest have no
    // footprint to match on, and the remainder are diagonals, columns, triangles
    // and curves that this panel does not offer.
    expect(Object.fromEntries(closed)).toEqual({ '{"shape":"rect","w":6,"d":2}': 4 })
  })
})
