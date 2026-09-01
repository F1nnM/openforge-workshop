/// <reference types="node" />
/**
 * `pipeline/normalise.ts` — the alias table's mechanics, and its restraint.
 *
 * The interesting assertions here are the negative ones. A normalisation module
 * is dangerous in proportion to what it is willing to rewrite, so this pins the
 * things it must NOT touch — tag order, the compound spellings that encode real
 * variants, and every namespace outside the table — against the live corpus,
 * not against a fixture. The corpus block skips loudly when the fixtures are
 * absent, matching `pipeline/catalog.test.ts`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fixturesDir } from './fixtures'
import { NOT_COLLAPSED, TAG_ALIASES, normaliseTag, normaliseTags } from './normalise'

describe('normaliseTag', () => {
  it('rewrites the retired spelling', () => {
    expect(normaliseTag('texture|foundations')).toBe('texture|foundation')
  })

  it('carries a deeper tag under a retired spelling along with it', () => {
    // None exists today. The generality is what stops a future upstream scan
    // reintroducing the split one level down, where nothing would notice.
    expect(normaliseTag('texture|foundations|ruined')).toBe('texture|foundation|ruined')
  })

  it('matches on a segment boundary, never on a prefix of a word', () => {
    // The retired spelling is a prefix of nothing real, but `foundation` is a
    // prefix of `foundations`: rewriting on a bare string prefix would make the
    // table order-dependent and eventually cyclic.
    expect(normaliseTag('texture|foundation')).toBe('texture|foundation')
    expect(normaliseTag('texture|foundationsx')).toBe('texture|foundationsx')
  })

  it('leaves everything else exactly as it found it', () => {
    for (const tag of [
      'texture|dungeon_stone|eroded',
      'texture|towne|stucco-stone',
      'shape|corner|low-minimal-full',
      'component|collapsed|low-full',
      'connection|side|openlock',
      'size|openlock|A+S',
    ]) {
      expect(normaliseTag(tag)).toBe(tag)
    }
  })

  it('is idempotent, so a double pass cannot drift', () => {
    for (const [retired] of TAG_ALIASES) {
      expect(normaliseTag(normaliseTag(retired))).toBe(normaliseTag(retired))
    }
  })

  it('has no alias whose target is itself an alias key', () => {
    // A chain would make the result depend on table order.
    const retired = new Set(TAG_ALIASES.map(([from]) => from))
    for (const [, canonical] of TAG_ALIASES) expect(retired.has(canonical)).toBe(false)
  })
})

describe('normaliseTags', () => {
  it('preserves order, which is what protects first-position selection', () => {
    // `CatalogRecord.texture` is the root of the FIRST texture tag. A rewrite
    // that reordered tags would silently move which root wins on 8,702 records.
    const tags = ['shape|wall', 'texture|foundations', 'connection|openlock']
    expect(normaliseTags(tags)).toEqual(['shape|wall', 'texture|foundation', 'connection|openlock'])
  })

  it('de-duplicates when a collapse would otherwise repeat a tag', () => {
    // No live row can hit this today — no tile carries both spellings — but an
    // alias that can must not be able to smuggle a duplicate into the intern
    // table, where it would inflate the reference count.
    expect(normaliseTags(['texture|foundation', 'texture|foundations'])).toEqual([
      'texture|foundation',
    ])
    expect(normaliseTags(['texture|foundations', 'texture|foundation'])).toEqual([
      'texture|foundation',
    ])
  })

  it('returns an empty list unchanged', () => {
    expect(normaliseTags([])).toEqual([])
  })
})

describe('NOT_COLLAPSED', () => {
  it('records a reason and a count for every tag it names', () => {
    expect(NOT_COLLAPSED.length).toBeGreaterThan(0)
    for (const entry of NOT_COLLAPSED) {
      expect(entry.tags.length).toBe(entry.counts.length)
      expect(entry.reason.length).toBeGreaterThan(40)
    }
  })

  it('names nothing the alias table actually collapses', () => {
    // The two lists are the collapsed and the deliberately-kept. A tag in both
    // would mean the documentation contradicts the behaviour.
    const collapsed = new Set(TAG_ALIASES.map(([from]) => from))
    for (const entry of NOT_COLLAPSED) {
      for (const tag of entry.tags) expect(collapsed.has(tag)).toBe(false)
    }
  })
})

/* ----------------------------------------------------------- against the corpus */

const FIXTURES_DIR = fixturesDir()
const hasFixtures =
  existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))

if (!hasFixtures) {
  process.stderr.write(
    [
      '',
      '='.repeat(72),
      '  pipeline/normalise.test: corpus block SKIPPED — no fixtures.',
      `  Looked for: ${FIXTURES_DIR}`,
      '  Set OPENFORGE_FIXTURES to the blueprints directory to run it.',
      '='.repeat(72),
      '',
    ].join('\n'),
  )
}

const describeCorpus = hasFixtures ? describe : describe.skip

interface Row {
  readonly deprecated?: unknown
  readonly tags?: readonly string[]
}

const liveTagLists: readonly (readonly string[])[] = hasFixtures
  ? readdirSync(FIXTURES_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .flatMap((name) => JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as Row[])
      .filter((row) => !row.deprecated)
      .map((row) => row.tags ?? [])
  : []

describeCorpus('over the live corpus', () => {
  const before = new Set(liveTagLists.flat())
  const after = new Set(liveTagLists.flatMap((tags) => normaliseTags(tags)))

  it('reads the whole live corpus', () => {
    expect(liveTagLists).toHaveLength(8702)
    expect(before.size).toBe(916)
  })

  it('removes exactly one tag string from the vocabulary', () => {
    expect(after.size).toBe(915)
    expect([...before].filter((tag) => !after.has(tag))).toEqual(['texture|foundations'])
    expect([...after].filter((tag) => !before.has(tag))).toEqual([])
  })

  it('changes no tag reference count, because no tile carried both spellings', () => {
    const refsBefore = liveTagLists.reduce((total, tags) => total + tags.length, 0)
    const refsAfter = liveTagLists.reduce((total, tags) => total + normaliseTags(tags).length, 0)
    expect(refsBefore).toBe(84_023)
    expect(refsAfter).toBe(84_023)
  })

  it('moves 2 tiles onto the canonical root and loses none', () => {
    const carrying = (tag: string, lists: readonly (readonly string[])[]): number =>
      lists.filter((tags) => tags.includes(tag)).length
    const normalised = liveTagLists.map((tags) => normaliseTags(tags))
    expect(carrying('texture|foundation', liveTagLists)).toBe(51)
    expect(carrying('texture|foundations', liveTagLists)).toBe(2)
    expect(carrying('texture|foundation', normalised)).toBe(53)
    expect(carrying('texture|foundations', normalised)).toBe(0)
  })

  it('leaves the first texture tag of every tile in place', () => {
    // The trap D3 had to avoid: `record.texture` is the root of the FIRST
    // texture tag, so a reorder is a silent retag of the whole corpus. The only
    // permitted change is the renamed root itself.
    const firstTextureRoot = (tags: readonly string[]): string | undefined =>
      tags.find((tag) => tag.startsWith('texture|'))?.split('|')[1]
    let renamed = 0
    for (const tags of liveTagLists) {
      const wasRoot = firstTextureRoot(tags)
      const nowRoot = firstTextureRoot(normaliseTags(tags))
      if (wasRoot === nowRoot) continue
      renamed += 1
      expect([wasRoot, nowRoot]).toEqual(['foundations', 'foundation'])
    }
    expect(renamed).toBe(2)
  })

  it('touches nothing outside the `texture` namespace', () => {
    for (const tags of liveTagLists) {
      const normalised = normaliseTags(tags)
      expect(normalised.filter((tag) => !tag.startsWith('texture|'))).toEqual(
        tags.filter((tag) => !tag.startsWith('texture|')),
      )
    }
  })

  it('keeps every compound spelling `NOT_COLLAPSED` says it keeps', () => {
    // These are the 144 + 14 mirrored `towne` models and the sculpt-variant
    // letters. If a future alias swallows one, its distinct models stop being
    // distinguishable and this is the assertion that says so.
    const normalised = liveTagLists.map((tags) => normaliseTags(tags))
    for (const entry of NOT_COLLAPSED) {
      for (const [index, tag] of entry.tags.entries()) {
        const expected = entry.counts[index] ?? 0
        if (expected === 0 || !tag.startsWith('texture|')) continue
        expect(normalised.filter((tags) => tags.includes(tag)), tag).toHaveLength(expected)
      }
    }
  })
})
