/**
 * The fold, against the fixtures alone.
 *
 * No `catalog.json` here on purpose. What is checkable from the 20 YAML files is
 * *structural* — which template replaced which, what each control axis offers,
 * and that nothing happened beyond {@link FOLD_OPERATIONS} — and it is checkable
 * with no corpus, so it is checked where it cannot skip.
 *
 * The other half is in `src/assembly/corpus.test.ts`: that the derivation is
 * **lossless**, as candidate-set equality against the live archive. A structural
 * diff cannot see that and a census cannot see this.
 */
import { describe, expect, it } from 'vitest'

import { FOLD_OPERATIONS, foldRecipes } from './fold'
import { loadTemplateFixtures, templateFixturesDir } from './templates'

const fixtures = loadTemplateFixtures(templateFixturesDir())
const folded = foldRecipes(fixtures)

const byId = (id: string) => {
  const one = folded.find((assembly) => assembly.id === id)
  if (one === undefined) throw new Error(`no folded assembly ${id}; have ${folded.map((a) => a.id).join(', ')}`)
  return one
}

const requireOf = (id: string, slot: string): readonly string[] =>
  (byId(id).parts.find((part) => part.name === slot)?.tags.require ?? []).map((ref) => ref.tag)
const denyOf = (id: string, slot: string): readonly string[] =>
  (byId(id).parts.find((part) => part.name === slot)?.tags.deny ?? []).map((ref) => ref.tag)

describe('foldRecipes', () => {
  it('reads the 40 and returns 10', () => {
    expect(fixtures).toHaveLength(40)
    expect(folded).toHaveLength(10)
  })

  it('replaces every one of the 40 exactly once', () => {
    const replaced = folded.flatMap((assembly) => assembly.replaces)
    expect(replaced).toHaveLength(40)
    expect(new Set(replaced).size).toBe(40)
    expect(new Set(replaced)).toEqual(new Set(fixtures.map((fixture) => fixture.name)))
  })

  it('folds the 32 wall recipes into two, one per build', () => {
    const walls = folded.filter((assembly) => assembly.controls.component.length > 0)
    expect(walls.map((assembly) => assembly.replaces.length)).toEqual([16, 16])
    expect(walls.map((assembly) => assembly.name)).toEqual([
      'S2W: Wall on Tile: Wall (Modular)',
      'S2W: Wall on Tile: Wall (Single Piece)',
    ])
  })

  it('offers the arched and the rectangular door as two positions of one template', () => {
    /* The question this row started from. They differed by one tag on one slot
       and shipped as two of the 40. */
    const tags = byId('s2w-wall-on-tile-wall-single-piece').controls.component.flatMap((one) => one.tags)
    expect(tags).toContain('component|door|arched')
    expect(tags).toContain('component|door|rectangular')
  })

  it('offers 14 components plus an any position, and any carries no tag', () => {
    const component = byId('s2w-wall-on-tile-wall-single-piece').controls.component
    expect(component).toHaveLength(15)
    expect(component[0]).toEqual({ label: 'any component', tags: [] })
    expect(component.filter((one) => one.tags.length === 0)).toHaveLength(1)
  })

  it('carries the secret door’s second require with it, so a position can be two tags', () => {
    const secret = byId('s2w-wall-on-tile-wall-single-piece').controls.component.find(
      (one) => one.label === 'secret door',
    )
    expect(secret?.tags).toEqual(['component|secret_door', 'interface|secret_door|bottom'])
  })

  it('gives the wall a height axis, because shape|wall is disjoint from its low qualifier', () => {
    for (const build of ['single-piece', 'modular']) {
      expect(byId(`s2w-wall-on-tile-wall-${build}`).controls.height).toEqual([
        { label: 'any height', tags: [] },
        { label: 'full', tags: ['shape|wall'] },
        { label: 'low', tags: ['shape|wall|low'] },
      ])
    }
  })

  it('carries no shape| or component| tag of its own, or a position would be masked', () => {
    /* `filterSpecificTags` keeps the **most general** match, so a `shape|wall`
       template tag would beat a `shape|wall|low` position and the low height
       would silently resolve as full. */
    for (const build of ['single-piece', 'modular']) {
      const tags = byId(`s2w-wall-on-tile-wall-${build}`).tags
      expect(tags.filter((tag) => tag.startsWith('shape|'))).toEqual([])
      expect(tags.filter((tag) => tag.startsWith('component|'))).toEqual([])
      // What it must keep: the object and the build, which no axis replaces.
      expect(tags).toContain('object|tile|wall_on_tile')
      expect(tags).toContain(build === 'modular' ? 'build|s2w|modular' : 'build|s2w|single_piece')
    }
  })

  it('keys the merged wall slot on role|wall rather than shape|wall', () => {
    for (const build of ['single-piece', 'modular']) {
      const require = requireOf(`s2w-wall-on-tile-wall-${build}`, 'wall')
      expect(require).toContain('role|wall')
      expect(require).toContain('build|separate wall')
      // The shape moved to the height axis, so the slot must not still demand it.
      expect(require.filter((tag) => tag.startsWith('shape|wall'))).toEqual([])
    }
    // And single piece keeps the connection its 16 members all require.
    expect(requireOf('s2w-wall-on-tile-wall-single-piece', 'wall')).toContain('connection|openforge')
    expect(requireOf('s2w-wall-on-tile-wall-modular', 'wall')).not.toContain('connection|openforge')
  })

  it('collects each axis with a sibling-free constrain entry', () => {
    /* A bare `{ tag: 'component' }` would inherit from every sibling selection as
       well as from the parent, and floors carry `component|` tags — so the wall
       would be narrowed by the floor's component. `siblings: []` adds nothing. */
    const constrain = byId('s2w-wall-on-tile-wall-modular').parts.find((part) => part.name === 'wall')?.tags
      .constrain
    expect(constrain).toEqual([
      { tag: 'size|width' },
      { tag: 'component', siblings: [] },
      { tag: 'interface', siblings: [] },
      { tag: 'shape|wall', siblings: [] },
    ])
  })

  it('denies shape|base on both merged wall slots, which the 40 never did', () => {
    /* Row D1 made all 47 families deny it; the recipes were left out. 278 of the
       1,608 candidates of `Wall (Any, Modular)` are walls with an integrated
       base, and the assembly fills its own base slot too. */
    for (const build of ['single-piece', 'modular']) {
      expect(denyOf(`s2w-wall-on-tile-wall-${build}`, 'wall')).toContain('shape|base')
    }
  })

  it('does not carry the low wall’s secret-door deny onto every position', () => {
    /* The deny is an intersection and not a union, deliberately: one member's
       deny describes one member's combination. Unioned, a secret door would be
       refused at every height. */
    for (const build of ['single-piece', 'modular']) {
      expect(denyOf(`s2w-wall-on-tile-wall-${build}`, 'wall')).not.toContain('component|secret_door')
      // What every member does deny stays.
      expect(denyOf(`s2w-wall-on-tile-wall-${build}`, 'wall')).toContain('shape|curved')
    }
  })

  it('gives the drain’s modular base the build|s2w its 15 siblings require', () => {
    /* The census that justifies the repair, taken **inside the fixtures**, so
       upstream fixing the data fails here rather than passing over corrected
       input for ever — row B6's rule applied to a repair. */
    const modularWalls = fixtures.filter(
      (fixture) =>
        fixture.parts.map((part) => part.name).sort().join(',') === 'base,floor,wall' &&
        fixture.tags.includes('build|s2w|modular'),
    )
    const withS2w = modularWalls.filter((fixture) =>
      (fixture.parts.find((part) => part.name === 'base')?.tags.require ?? []).some(
        (ref) => ref.tag === 'build|s2w',
      ),
    )
    expect(modularWalls).toHaveLength(16)
    expect(withS2w).toHaveLength(15)
    expect(modularWalls.filter((fixture) => !withS2w.includes(fixture)).map((f) => f.source)).toEqual([
      'blueprints.s2w.wall.drain.yaml',
    ])

    expect(requireOf('s2w-wall-on-tile-wall-modular', 'base')).toContain('build|s2w')
  })

  it('renames both full-height corners, because neither name was true', () => {
    /* `Corner (Any, …)` denies `shape|column|low`, and `Internal Corner (…)`
       denies it while saying nothing. Both are the full-height variant. */
    const names = folded.map((assembly) => assembly.name).filter((name) => name.includes('Corner'))
    expect(names.sort()).toEqual([
      'S2W: Wall on Tile: Corner: Full (Modular)',
      'S2W: Wall on Tile: Corner: Full (Single Piece)',
      'S2W: Wall on Tile: Corner: Low (Modular)',
      'S2W: Wall on Tile: Corner: Low (Single Piece)',
      'S2W: Wall on Tile: Internal Corner: Full (Modular)',
      'S2W: Wall on Tile: Internal Corner: Full (Single Piece)',
      'S2W: Wall on Tile: Internal Corner: Low (Modular)',
      'S2W: Wall on Tile: Internal Corner: Low (Single Piece)',
    ])
    expect(folded.filter((assembly) => assembly.name.includes('(Any'))).toEqual([])
  })

  it('leaves every corner’s parts the fixture’s own but for row D1’s deny', () => {
    /* The corners are a rename: their low/full split is not expressible as a
       position, so there is nothing to widen and nothing to restore. The one
       change is `shape|base` on their non-base slots, and they need it as much as
       a wall does — both wall slots of `Corner (Any, Modular)` admit 144
       integrated-base records each. */
    for (const assembly of folded) {
      if (assembly.controls.component.length > 0) continue
      const source = fixtures.find((fixture) => fixture.name === assembly.replaces[0])
      expect(assembly.tags).toEqual(source?.tags)
      for (const part of assembly.parts) {
        const original = source?.parts.find((one) => one.name === part.name)
        expect(original, `${assembly.id}/${part.name}`).toBeDefined()
        expect(part.tags.require).toEqual(original?.tags.require)
        expect(part.tags.constrain).toEqual(original?.tags.constrain)
        expect(part.fulfills).toEqual(original?.fulfills)
        const added = (part.tags.deny ?? [])
          .map((ref) => ref.tag)
          .filter((tag) => !(original?.tags.deny ?? []).some((ref) => ref.tag === tag))
        expect(added, `${assembly.id}/${part.name}`).toEqual(part.name === 'base' ? [] : ['shape|base'])
      }
    }
  })

  it('denies shape|base on every non-base slot of all 10, and only there', () => {
    /* The class and not the three instances. A base keeps the role of the piece
       it sits under, so any slot that does not deny `shape|base` can admit one —
       the three that do so in today's corpus are where it shows, not where the
       hazard is. The `base` slot itself must of course keep requiring it. */
    for (const assembly of folded) {
      for (const part of assembly.parts) {
        const deny = (part.tags.deny ?? []).map((ref) => ref.tag)
        expect(deny.includes('shape|base'), `${assembly.id}/${part.name}`).toBe(part.name !== 'base')
      }
    }
  })

  it('restores every dropped require from exactly one component and one height position', () => {
    /* **The provenance check.** For each of the 32 wall fixtures, the merged
       slot's require plus its two axis positions must reconstruct the fixture's
       own require exactly — no tag invented, none lost. This is what makes the
       fold a re-expression rather than a rewrite. */
    const drift: string[] = []
    for (const assembly of folded) {
      if (assembly.controls.component.length === 0) continue
      const merged = new Set(requireOf(assembly.id, 'wall'))
      merged.delete('role|wall')

      for (const name of assembly.replaces) {
        const fixture = fixtures.find((one) => one.name === name)
        const want = new Set(
          (fixture?.parts.find((part) => part.name === 'wall')?.tags.require ?? []).map((ref) => ref.tag),
        )
        /* `shape|wall` is the height axis's own tag, so the fixture's copy of it
           is restored by a position rather than by the merged require. */
        const positions = [...assembly.controls.component, ...assembly.controls.height]
        const reachable = positions.filter((position) => position.tags.every((tag) => want.has(tag)))
        const restored = new Set([...merged, ...reachable.flatMap((position) => position.tags)])

        const lost = [...want].filter((tag) => !restored.has(tag))
        const invented = [...merged].filter((tag) => !want.has(tag))
        if (lost.length > 0 || invented.length > 0) {
          drift.push(`${name}: lost ${lost.join(',') || '-'} invented ${invented.join(',') || '-'}`)
        }
      }
    }
    expect(drift).toEqual([])
  })

  it('uses only the four declared operations', () => {
    expect(FOLD_OPERATIONS).toEqual([
      'drop a component| require and record it as a component position',
      'drop a shape|wall-rooted require and record it as a height position',
      'swap shape|wall for role|wall, strip the axis roots from the template tags, and add the collecting constrain entries',
      'add a deny or require justified by a sibling census',
    ])
  })

  it('leaves the size axis to the corpus, so this file needs none', () => {
    expect(folded.every((assembly) => assembly.controls.size.length === 0)).toBe(true)
  })
})
