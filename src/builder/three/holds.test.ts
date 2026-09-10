// @vitest-environment jsdom
/// <reference types="node" />
/**
 * The default-hold pass, against the archive it has to answer for.
 *
 * There is no fixture half here and that is deliberate. Every decision this
 * module makes is a decision about *real* composition slots — which of them are
 * required, which of their candidate items lead nowhere, and what a room design
 * does to the order — and the eleven-record canvas fixture declares one
 * accessory slot with one candidate, so a fixture test of the ranking would be a
 * test of nothing. The four hosts below are the corpus's own shapes:
 *
 *   - a wall with **one required `torch` slot and an optional `base`**, which is
 *     the overwhelming case (1,047 of 1,244 declarations are required),
 *   - an aztlan corner whose only accessory slot is **optional**, which must come
 *     back `{}` — *solved, and nothing goes in it* — rather than unsolved,
 *   - the infinite hallway, one of the **3 files in the archive that declare a
 *     required `base`**, which is the one slot a hold must never be written for,
 *   - a cut-stone arched corner whose `door` slot has **two live options with
 *     different textures** (tudor at address 3215, wood at 3216), which is the
 *     only shape that can tell a design preference from address order.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`); absent, this file skips loudly, which is
 * `fills.test.ts`' precedent.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, render, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  FIXTURE_CATALOG,
  FIXTURE_IDS,
  FIXTURE_TEMPLATE,
  fixtureFills,
  fixtureInstance,
} from '@/builder/canvas/fixture'
import { useHistory } from '@/builder/canvas/useHistory'
import type { CatalogFile, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, resolveTags } from '@/catalog'
import { compositionIndexFor, slotStates } from '@/screens/detail/slots'
import type { HoldName, PlacementId, SlotName, TemplateInstance } from '@/store'
import { clearPlacements, placeTemplate, restorePlacements, useWorkshopStore } from '@/store'

import { missingHolds, solveHolds, useHoldSolver } from './holds'

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
      '  builder/three/holds.test: SKIPPED — no emitted catalog index.',
      `  Looked for: ${CATALOG_PATH}`,
      '  Build one with:  npm run import:catalog',
      '='.repeat(72),
      '',
    ].join('\n'),
  )
}

const describeCorpus = loaded === undefined ? describe.skip : describe

/** One required `torch` slot, plus an **optional** `base`. */
const TORCH_WALL =
  'tiles/dungeon_stone/separate_wall/primary_walls/torch/openforge/dungeon_stone#wall,torch+mid.IA.openforge.stl' as TileId

/** One accessory slot, `optional: true`. 126 files in the archive are like this. */
const TREASURE_CORNER =
  'tiles/aztlan/s2w/corner/treasure_hollow#corner+s2w/aztlan#corner,treasure_hollow+13mm.BA.openforge,side.stl' as TileId

/** `torch`, `arch`, and a **required** `base`. 3 files in the archive declare one. */
const INFINITE_HALLWAY =
  'tiles/dungeon_stone/misc/infinite_hallway/dungeon_stone#infinite_hallway+torch.2x2.openforge.stl' as TileId

/** Required `door` and `lintel` slots whose every option empties the base. */
const DEAD_END_DOOR =
  'tiles/cut-stone/separate_wall/primary_walls/door+rectangular/openforge/cut-stone#wall,door+rectangular.A.openforge.stl' as TileId

/** A required `door` slot with a tudor and a wood option, both live. */
const ARCHED_CORNER =
  'tiles/cut-stone/s2w/corner/door#corner+arched,s2w/cut-stone#corner+left,door+arched+narrow.2x.openforge,side+filament.stl' as TileId

/** A floor declaring **only** a `base` slot — nothing accessory to solve or re-ask. */
const BASE_ONLY_FLOOR = 'tiles/aztlan/floors/floor/openforge/aztlan#floor.1x1.openforge.stl' as TileId

const WOOD_DOOR = 'tiles/cut-stone/s2w/corner/door#corner+arched,s2w/wood#corner,door+narrow.stl'
const TUDOR_DOOR = 'tiles/cut-stone/s2w/corner/door#corner+arched,s2w/tudor#corner,door+narrow.stl'

/* ------------------------------------- the one shape the corpus cannot state */

/**
 * A two-required-slot host whose **second** slot inherits the first slot's
 * texture.
 *
 * Built rather than found, and the search is the reason: of the **167** live
 * files declaring two or more required accessory slots, **not one** has a slot
 * whose candidate set moves when a sibling is filled — `slotPicker.ts` measures
 * the same thing from the other end (*"Zero empty an accessory sibling"*). So
 * the corpus can prove the walk's **order** (the infinite hallway does, above)
 * and cannot prove that each pick is **fed back** into the selection, which is
 * the other half of the rule and the half that silently degrades: drop the
 * feedback and every corpus answer is unchanged.
 *
 * The grammar is the corpus's own — `constrain: [{ tag: 'texture', siblings }]`,
 * the form 30 live slots use — over the canvas fixture's records plus a second
 * torch. The host carries **no `texture|` tag of its own**, because `constrain`
 * inherits from the parent as well as the named sibling and a host texture would
 * require both at once, which nothing can satisfy.
 */
const WOOD_TORCH = 'tiles/wood/torch/torch.stl'
const TWO_SLOT_HOST = 'tiles/fixture/two_slot/host.stl' as TileId

const tagOf = (name: string): number => {
  const at = FIXTURE_CATALOG.tags.indexOf(name)
  if (at < 0) throw new Error(`fixture tag ${name} is not in the intern table`)
  return at
}

const TWO_SLOT_CATALOG: CatalogFile = CatalogFileSchema.parse({
  ...FIXTURE_CATALOG,
  records: [
    ...FIXTURE_CATALOG.records,
    {
      // The same torch one texture over, so the two slots have something to
      // disagree about. A later `ord`, so it is the *higher* address and would
      // lose the tie-break the ranking makes with nothing else to go on.
      id: WOOD_TORCH,
      ord: 30,
      blob: 'a'.repeat(32),
      file: 'torch.stl',
      bytes: 262_144,
      sprite: false,
      thumb: false,
      family: 'tiles/wood/torch',
      design: 'd-torch-wood',
      name: 'Wood torch',
      kinds: ['torch'],
      conn: [],
      layer: 'insert',
      texture: 'wood',
      tags: [tagOf('part|torch'), tagOf('texture|wood')],
      foot: { shape: 'none' },
      anchor: { kind: 'peg', at: [0, 0, 0], axis: [0, 0, 1], size: [7, 7, 12] },
    },
    {
      id: TWO_SLOT_HOST,
      ord: 31,
      blob: 'b'.repeat(32),
      file: 'host.stl',
      bytes: 1_048_576,
      sprite: false,
      thumb: false,
      family: 'tiles/fixture/two_slot',
      design: 'd-two-slot',
      name: 'Two slot host',
      kinds: ['wall'],
      conn: [],
      layer: 'topper',
      tags: [tagOf('shape|wall')],
      foot: { shape: 'wall', length: 1 },
      config: {
        parts: [
          // Narrowed to the wood torch by its own `require`, so the *first* pick
          // is the one that does not sort first.
          { name: 'torch', tags: { require: [{ tag: 'part|torch' }, { tag: 'texture|wood' }] } },
          // And the second slot takes its texture from whatever the first holds.
          {
            name: 'second',
            tags: {
              require: [{ tag: 'part|torch' }],
              constrain: [{ tag: 'texture', siblings: ['torch'] }],
            },
          },
        ],
      },
    },
  ],
})

const FLOOR = 'floor' as SlotName
const RIGHT_WALL = 'right wall' as SlotName
const TORCH = 'torch' as HoldName
const SECOND = 'second' as HoldName
const DOOR = 'door' as HoldName
const P0 = 'p0' as PlacementId

/** One placement holding the same unsolved file in **two** slots. */
function twoFills(id: string, tile: TileId): TemplateInstance {
  return fixtureInstance(id, fixtureFills([
    [FLOOR, tile],
    [RIGHT_WALL, tile],
  ]))
}

/** One placement holding one file in its `floor` slot, holds as given. */
function placement(id: string, tile: TileId, holds?: TemplateInstance['fills'][SlotName]['holds']): TemplateInstance {
  const fills = fixtureFills([[FLOOR, tile]])
  const fill = fills[FLOOR]
  if (fill === undefined) throw new Error('the fixture built no floor fill')
  return fixtureInstance(id, { [FLOOR]: holds === undefined ? fill : { ...fill, holds } })
}

describeCorpus('the default-hold pass over the live archive', () => {
  const file = loaded as CatalogFile

  afterEach(() => {
    clearPlacements()
  })

  /** The tags of the file a hold names, so an assertion is about the *part*. */
  function tagsOf(tile: TileId): readonly string[] {
    const record = file.records.find((one) => one.id === tile)
    if (record === undefined) throw new Error(`no record for ${tile}`)
    return resolveTags(file, record)
  }

  describe('solveHolds', () => {
    it('fits a torch into the one required slot a torch wall declares', () => {
      const holds = solveHolds(file, TORCH_WALL, undefined)

      expect(Object.keys(holds)).toEqual(['torch'])
      const torch = holds[TORCH]
      if (torch === undefined) throw new Error('no torch hold')
      expect(tagsOf(torch.tile)).toContain('part|torch')
      // The solver chose it, so a lock change or a re-solve may replace it.
      expect(torch.pinned).toBe(false)
    })

    it('leaves an optional slot out, and says so with an empty map', () => {
      expect(solveHolds(file, TREASURE_CORNER, undefined)).toEqual({})
    })

    it('never writes a hold for a required `base` slot', () => {
      const holds = solveHolds(file, INFINITE_HALLWAY, undefined)

      // Declared order, `base` excluded — a `base` hold would read `hold-off-slot`
      // in the bill and is the base *match*, not an accessory.
      expect(Object.keys(holds)).toEqual(['torch', 'arch'])
    })

    it('feeds each pick back, so a slot constrained by its sibling sees it', () => {
      const index = compositionIndexFor(TWO_SLOT_CATALOG)
      const cold = slotStates(index, TWO_SLOT_HOST).find((one) => one.name === 'second')
      /* With nothing picked the second slot is unconstrained and would take the
         cut-stone torch on address order. That is what makes the assertion below
         a test of the feedback rather than of the ranking. */
      expect(cold?.options.filter((one) => !one.deadEnd)[0]?.variant.id).toBe(FIXTURE_IDS.torch)

      const holds = solveHolds(TWO_SLOT_CATALOG, TWO_SLOT_HOST, undefined)

      expect(holds[TORCH]?.tile).toBe(WOOD_TORCH)
      expect(holds[SECOND]?.tile).toBe(WOOD_TORCH)
    })

    it('leaves out a required slot whose every option would empty the base', () => {
      /* A cut-stone rectangular door wall: `door` offers five items and `lintel`
         one, and **every one of them empties the base slot** — 416 of the
         corpus's 4,330 item picks do, all of them the base. Forcing one would
         trade a socket the bill reports for a piece with nothing printable
         underneath it, so the answer is the same `{}` a solved-and-empty fill
         gets, and row 8's bill is what says the sockets are open. */
      expect(solveHolds(file, DEAD_END_DOOR, undefined)).toEqual({})
    })

    it('prefers a candidate carrying the room design over the lowest address', () => {
      const none = solveHolds(file, ARCHED_CORNER, undefined)
      const wood = solveHolds(file, ARCHED_CORNER, 'wood')

      expect(none[DOOR]?.tile).toBe(TUDOR_DOOR)
      expect(wood[DOOR]?.tile).toBe(WOOD_DOOR)
    })
  })

  describe('missingHolds', () => {
    it('skips a fill that has already been solved', () => {
      const placements = {
        solved: placement('solved', TORCH_WALL, {}),
        unsolved: placement('unsolved', TORCH_WALL),
      }

      const missing = missingHolds(placements, file, undefined)

      expect(missing.map((one) => one.id)).toEqual(['unsolved'])
      expect(missing[0]?.slot).toBe(FLOOR)
      expect(Object.keys(missing[0]?.holds ?? {})).toEqual(['torch'])
    })

    it('asks about a host whose only slot is optional, so it is never asked about twice', () => {
      const missing = missingHolds({ p0: placement('p0', TREASURE_CORNER) }, file, undefined)

      expect(missing.map((one) => one.holds)).toEqual([{}])
    })

    it('skips a fill whose file declares nothing but a base slot', () => {
      expect(missingHolds({ p0: placement('p0', BASE_ONLY_FLOOR) }, file, undefined)).toEqual([])
    })
  })

  describe('useHoldSolver', () => {
    const Probe = ({ catalog }: { readonly catalog: CatalogFile | undefined }) => {
      useHoldSolver(catalog)
      return null
    }

    /** What the store holds for `p0`'s `floor` slot. */
    const heldBy = (id: PlacementId): TemplateInstance['fills'][SlotName]['holds'] =>
      useWorkshopStore.getState().placements[id]?.fills[FLOOR]?.holds

    /** Store writes go through `act`, so React has flushed before an assertion. */
    const seed = (placements: Record<string, TemplateInstance>): void => {
      act(() => {
        restorePlacements(placements)
      })
    }

    it('fills every unsolved fill once, and writes nothing on the next render', () => {
      seed({ [P0]: placement(P0, TORCH_WALL) })
      let writes = 0
      const stop = useWorkshopStore.subscribe(() => {
        writes += 1
      })

      const view = render(createElement(Probe, { catalog: file }))
      const after = heldBy(P0)
      view.rerender(createElement(Probe, { catalog: file }))
      stop()

      expect(Object.keys(after ?? {})).toEqual(['torch'])
      // One write for one decision: the second pass sees a solved fill and the
      // effect is therefore idempotent rather than a loop.
      expect(writes).toBe(1)
    })

    it('solves both fills of one instance, one write each', () => {
      seed({ [P0]: twoFills(P0, TORCH_WALL) })
      let writes = 0
      const stop = useWorkshopStore.subscribe(() => {
        writes += 1
      })

      render(createElement(Probe, { catalog: file }))
      stop()

      const instance = useWorkshopStore.getState().placements[P0]
      expect(Object.keys(instance?.fills[FLOOR]?.holds ?? {})).toEqual(['torch'])
      expect(Object.keys(instance?.fills[RIGHT_WALL]?.holds ?? {})).toEqual(['torch'])
      // A fill is the unit of the answer, so two fills are two writes — and both
      // of them land in the one pass, which is what stops the second being an
      // extra render's worth of work.
      expect(writes).toBe(2)
    })

    it('does nothing at all without a catalog', () => {
      seed({ [P0]: placement(P0, TORCH_WALL) })

      render(createElement(Probe, { catalog: undefined }))

      expect(heldBy(P0)).toBeUndefined()
    })
  })

  describe('undo, which the pass must not stand in front of', () => {
    /** The room as the app has it: a history recording, and the pass running. */
    const useRoom = (): ReturnType<typeof useHistory> => {
      const controls = useHistory()
      useHoldSolver(file)
      return controls
    }

    it('leaves one press to undo the placement, with the redo branch intact', () => {
      const { result } = renderHook(useRoom)

      act(() => {
        placeTemplate({
          template: FIXTURE_TEMPLATE,
          x: 0,
          z: 0,
          rotation: 0,
          fills: fixtureFills([[FLOOR, TORCH_WALL]]),
          filters: [],
        })
      })

      // The placement is one entry, and the torch the pass fitted into it is not
      // a second: `writeSilently` is what keeps the two apart.
      const placed = Object.keys(useWorkshopStore.getState().placements)
      expect(placed.length).toBe(1)
      const solved = useWorkshopStore.getState().placements[placed[0] as PlacementId]?.fills[FLOOR]?.holds
      expect(Object.keys(solved ?? {})).toEqual(['torch'])

      act(() => {
        result.current.undo()
      })

      /* One press, and the piece is gone. Recorded as an edit the solver's write
         would have buried it: the press would restore the unsolved fill, the
         pass would re-solve it, and `history.ts#record` would clear `future` —
         so the placement could never be reached and redo would be destroyed. */
      expect(useWorkshopStore.getState().placements).toEqual({})
      expect(result.current.canRedo).toBe(true)
      expect(result.current.canUndo).toBe(false)
    })

    it('records nothing at all for a room it solves on arrival', () => {
      // Seeded *before* the hook mounts, so the subscription's baseline is the
      // unsolved room and every entry it records afterwards is the pass's own.
      restorePlacements({ [P0]: twoFills(P0, TORCH_WALL) })

      const { result } = renderHook(useRoom)

      const instance = useWorkshopStore.getState().placements[P0]
      expect(Object.keys(instance?.fills[FLOOR]?.holds ?? {})).toEqual(['torch'])
      expect(Object.keys(instance?.fills[RIGHT_WALL]?.holds ?? {})).toEqual(['torch'])
      // Two silent writes, zero undo entries. Opening the 3D panel on a saved
      // room must not fill the history with presses that undo nothing the user
      // did.
      expect(result.current.canUndo).toBe(false)
    })
  })
})
