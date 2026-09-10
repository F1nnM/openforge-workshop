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

import { render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { fixtureFills, fixtureInstance } from '@/builder/canvas/fixture'
import type { CatalogFile, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, resolveTags } from '@/catalog'
import type { HoldName, PlacementId, SlotName, TemplateInstance } from '@/store'
import { clearPlacements, restorePlacements, useWorkshopStore } from '@/store'

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

/** A required `door` slot with a tudor and a wood option, both live. */
const ARCHED_CORNER =
  'tiles/cut-stone/s2w/corner/door#corner+arched,s2w/cut-stone#corner+left,door+arched+narrow.2x.openforge,side+filament.stl' as TileId

/** A floor declaring **only** a `base` slot — nothing accessory to solve or re-ask. */
const BASE_ONLY_FLOOR = 'tiles/aztlan/floors/floor/openforge/aztlan#floor.1x1.openforge.stl' as TileId

const WOOD_DOOR = 'tiles/cut-stone/s2w/corner/door#corner+arched,s2w/wood#corner,door+narrow.stl'
const TUDOR_DOOR = 'tiles/cut-stone/s2w/corner/door#corner+arched,s2w/tudor#corner,door+narrow.stl'

const FLOOR = 'floor' as SlotName
const TORCH = 'torch' as HoldName
const DOOR = 'door' as HoldName
const P0 = 'p0' as PlacementId

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

    it('fills every unsolved fill once, and writes nothing on the next render', () => {
      restorePlacements({ [P0]: placement(P0, TORCH_WALL) })
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

    it('does nothing at all without a catalog', () => {
      restorePlacements({ [P0]: placement(P0, TORCH_WALL) })

      render(createElement(Probe, { catalog: undefined }))

      expect(heldBy(P0)).toBeUndefined()
    })
  })
})
