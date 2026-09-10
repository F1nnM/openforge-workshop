/**
 * Row C2's figures against the real corpus.
 *
 * Every number in `slotPicker.ts`, `SlotFills.tsx` and
 * `../../../builder/panels/slots/planSlots.ts` is re-measured here, so a docblock
 * that goes stale fails the suite instead of sitting there being quoted. That
 * includes the three the plan row got wrong, which are asserted as *refutations*
 * rather than merely replaced:
 *
 *   - **"62% of slots have under 50 candidates."** Neither reading gives 62%.
 *     The ported one gives **76.9%** (2,843 of 3,695) and the wide one
 *     **33.7%** (1,247). Restricted to accessory slots, which is what this row
 *     builds a grid for, it is **100%** — all 1,244 of them.
 *   - **"385 of 1,608 wall picks lead to an unbuildable configuration."** **No
 *     slot in the corpus has "wall" in its name at all**, and 385 is D5's
 *     missing-base count from `docs/corpus-base-gap.md`. The composition-side
 *     dead-end figures are **526 of 3,695 slots (14.2%)** in their initial state
 *     and **416 of 4,330 item picks (9.6%)** for the greying itself.
 *   - **"3,036 tiles carry a config."** That one is right, and it is not the
 *     accessory surface: 2,031 of those files carry only a `base` slot, so
 *     **1,005 files and 445 items** are what a picker is for.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`), so it is absent in CI and the whole block skips
 * **loudly**, naming the path and the command — the precedent
 * `../../../composition/corpus.test.ts` and `../corpus.test.ts` both set.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile as CatalogFileType, PartSlot, TileAggregate, TileId } from '@/catalog'
import { CatalogFile, buildAggregateIndex, selectVariant } from '@/catalog'

import { slotRows } from '../variants'
import {
  BASE_SLOT,
  MAX_GRID_ITEMS,
  compositionIndexFor,
  pickerSlots,
  slotChoiceKey,
  slotStates,
} from './slotPicker'

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)
const describeCorpus = present ? describe : describe.skip
const title = present
  ? 'real corpus'
  : `real corpus — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/** The sweep over every candidate of every slot is seconds of real work. */
const SLOW_MS = 180_000

describeCorpus(title, () => {
  const file: CatalogFileType = present
    ? CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
    : ({ records: [], tags: [] } as unknown as CatalogFileType)

  const aggregates = present ? buildAggregateIndex(file) : undefined
  const index = present ? compositionIndexFor(file, aggregates) : undefined

  const items = (): readonly TileAggregate[] => aggregates?.aggregates ?? []
  const fileSlots = (): readonly { readonly parent: TileId; readonly slot: PartSlot }[] => {
    const out: { parent: TileId; slot: PartSlot }[] = []
    for (const record of file.records) {
      for (const slot of record.config?.parts ?? []) out.push({ parent: record.id, slot })
    }
    return out
  }

  /* ------------------------------------------------------- the surface */

  describe('the accessory surface', () => {
    it('is 552 slots over 445 items, and the base slot is 1,560 of the other 2,112', () => {
      let aggregateSlots = 0
      let named = 0
      let optionalAll = 0
      let accessorySlots = 0
      let accessoryItems = 0
      let optionalAccessory = 0
      let widest = 0
      const names = new Map<string, number>()

      for (const aggregate of items()) {
        aggregateSlots += aggregate.slots.length
        for (const slot of aggregate.slots) {
          if (slot.slot.name === BASE_SLOT) named += 1
          if (slot.slot.optional === true) optionalAll += 1
        }
        const rows = slotRows(aggregate)
        if (rows.length === 0) continue
        accessoryItems += 1
        accessorySlots += rows.length
        widest = Math.max(widest, rows.length)
        for (const row of rows) {
          names.set(row.name, (names.get(row.name) ?? 0) + 1)
          if (row.optional) optionalAccessory += 1
        }
      }

      expect({ aggregateSlots, named, optionalAll }).toEqual({
        aggregateSlots: 2112,
        named: 1560,
        optionalAll: 1616,
      })
      expect({ accessorySlots, accessoryItems }).toEqual({ accessorySlots: 552, accessoryItems: 445 })
      expect(names.size).toBe(28)
      expect([...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7)).toEqual([
        ['torch', 156],
        ['door', 89],
        ['lintel', 51],
        ['top', 37],
        ['grate', 34],
        ['archway', 29],
        ['portcullis', 28],
      ])

      // Of the 1,616 optional slots, all but 59 are the base slot — so an
      // accessory slot is usually *required*, and an unfilled one is a hole in
      // the print rather than a decoration declined.
      expect(optionalAccessory).toBe(59)
      // No item offers a fourth. `slots.css`'s three columns are sized for this.
      expect(widest).toBe(3)
    })

    it('is 1,005 files, not the 3,036 that carry a config', () => {
      let withAccessory = 0
      let baseOnly = 0
      let noConfig = 0
      const perFile = new Map<number, number>()

      for (const record of file.records) {
        const parts = record.config?.parts ?? []
        if (parts.length === 0) {
          noConfig += 1
          continue
        }
        const accessory = parts.filter((slot) => slot.name !== BASE_SLOT).length
        if (accessory === 0) baseOnly += 1
        else withAccessory += 1
        perFile.set(accessory, (perFile.get(accessory) ?? 0) + 1)
      }

      expect({ withAccessory, baseOnly, noConfig }).toEqual({
        withAccessory: 1005,
        baseOnly: 2031,
        noConfig: 5666,
      })
      expect(withAccessory + baseOnly).toBe(3036)
      expect([...perFile.entries()].sort((a, b) => a[0] - b[0])).toEqual([
        [0, 2031],
        [1, 767],
        [2, 237],
        [3, 1],
      ])
    })

    it('has no slot with “wall” in its name, so the plan row’s 1,608 wall picks are nothing', () => {
      const named = fileSlots().filter((entry) => entry.slot.name.includes('wall'))
      expect(named).toEqual([])

      const distinct = new Set(fileSlots().map((entry) => entry.slot.name))
      expect(distinct.size).toBe(29)
      expect([...distinct].filter((name) => name.includes('wall'))).toEqual([])
    })

    it('marks 1,047 of the 1,244 accessory declarations required', () => {
      const accessory = fileSlots().filter((entry) => entry.slot.name !== BASE_SLOT)
      expect(accessory).toHaveLength(1244)
      expect(accessory.filter((entry) => entry.slot.optional !== true)).toHaveLength(1047)
    })
  })

  /* -------------------------------------------------- the grid, and its cost */

  describe('the grid', () => {
    it('is at most 8 items and a median of 1, so 50 candidates is a regime that does not exist', () => {
      const fileSizes: number[] = []
      const itemSizes: number[] = []
      for (const { parent, slot } of fileSlots()) {
        if (slot.name === BASE_SLOT) continue
        const resolved = index!.resolve(slot, parent)
        fileSizes.push(resolved.tiles.length)
        itemSizes.push(resolved.items.length)
      }
      fileSizes.sort((a, b) => a - b)
      itemSizes.sort((a, b) => a - b)

      expect(fileSizes).toHaveLength(1244)
      expect(fileSizes[Math.floor(fileSizes.length / 2)]).toBe(12)
      expect(fileSizes[fileSizes.length - 1]).toBe(30)
      // 100%, not 62%: every accessory slot in the archive is under fifty.
      expect(fileSizes.filter((size) => size < 50)).toHaveLength(1244)

      expect(itemSizes[Math.floor(itemSizes.length / 2)]).toBe(1)
      expect(
        Math.round((itemSizes.reduce((sum, size) => sum + size, 0) / itemSizes.length) * 10) / 10,
      ).toBe(1.8)
      expect(itemSizes[itemSizes.length - 1]).toBe(MAX_GRID_ITEMS)
    })

    it('never contributes a file the slot cannot hold', () => {
      // 18,719 slot-item pairs, and A1's preferred variant is inside the
      // candidate set on every one — so the "grid on items, then selectVariant"
      // two-step never has to fall back.
      let pairs = 0
      let outside = 0
      for (const { parent, slot } of fileSlots()) {
        const resolved = index!.resolve(slot, parent)
        const byItem = new Map<number, Set<TileId>>()
        for (const tile of resolved.tiles) {
          const variant = aggregates!.byTile.get(tile)
          if (variant === undefined) continue
          const aggregate = aggregates!.byDesign.get(variant.design)
          if (aggregate === undefined) continue
          const at = aggregate.address as unknown as number
          const set = byItem.get(at) ?? new Set<TileId>()
          set.add(tile)
          byItem.set(at, set)
        }
        for (const [at, set] of byItem) {
          pairs += 1
          const aggregate = aggregates!.aggregates.find(
            (candidate) => (candidate.address as unknown as number) === at,
          )
          if (aggregate === undefined) continue
          if (!set.has(selectVariant(aggregate, {}).variant.id)) outside += 1
        }
      }
      expect({ pairs, outside }).toEqual({ pairs: 18719, outside: 0 })
    })

    it('never asks for a tag the index does not hold', () => {
      // All 91 `require` and 7 `deny` refs resolve, so `unknownRefs` is a state
      // the UI can reach only after a fixture import renames something.
      const dangling = fileSlots().filter(
        (entry) => index!.resolve(entry.slot, entry.parent).unknownRefs.length > 0,
      )
      expect(dangling).toEqual([])
    })
  })

  /* --------------------------------------------------------- dead-end greying */

  describe('dead-end greying', () => {
    /*
      **This block measures the index, not the picker, and since F2 the two give
      different answers on purpose.** `slotOptions` below resolves *every*
      declared part, `base` included, which is what the 416 is a count of. The
      picker resolves the accessory slots alone — the base under a placed piece is
      the template's slot, matched on footprint congruence, and no accessory pick
      can move it — so it greys none of these. Both halves are asserted here: the
      emptying is real, and the greying is empty.
    */
    it('measures 416 of 4,330 item picks emptying the base slot', () => {
      let picks = 0
      let dead = 0
      let partial = 0
      let accessorySibling = 0
      const blame = new Map<string, number>()

      for (const record of file.records) {
        const parts = record.config?.parts ?? []
        if (parts.length < 2) continue
        for (const slot of parts) {
          for (const option of slotOptions(record.id, slot, parts)) {
            picks += 1
            if (option.dead === option.variants) dead += 1
            else if (option.dead > 0) partial += 1
            for (const name of option.empties) {
              blame.set(name, (blame.get(name) ?? 0) + 1)
              if (name !== BASE_SLOT) accessorySibling += 1
            }
          }
        }
      }

      expect({ picks, dead, partial, accessorySibling }).toEqual({
        picks: 4330,
        dead: 416,
        partial: 0,
        accessorySibling: 0,
      })
      expect([...blame.keys()]).toEqual([BASE_SLOT])
    }, SLOW_MS)

    it('greys nothing, because every one of the 416 is the room s own base slot', () => {
      /* **F2.** `consequences` walked the host's `base` part as a sibling, so a
         door's `texture|wood` emptied it and every door card on every cut-stone
         door wall was a dead end — with `holds.ts` refusing to fill the doorway
         or the lintel notch by default in consequence. */
      let options = 0
      let dead = 0
      for (const record of file.records) {
        for (const state of slotStates(index!, record.id)) {
          for (const option of state.options) {
            options += 1
            if (option.deadEnd) dead += 1
          }
        }
      }
      expect({ options, dead }).toEqual({ options: 2194, dead: 0 })
    }, SLOW_MS)

    it('offers the cut-stone door wall s five doors and its lintel, all live', () => {
      const wall = file.records.find(
        (record) => record.file === 'cut-stone#wall,door+rectangular.A.openforge.stl',
      )
      if (wall === undefined) throw new Error('the corpus has no cut-stone rectangular door wall')

      const states = slotStates(index!, wall.id)
      expect(states.map((state) => state.name)).toEqual(['door', 'lintel'])
      expect(states.map((state) => state.options.length)).toEqual([5, 1])
      expect(states.flatMap((state) => state.options.map((option) => option.deadEnd))).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ])

      // And the base part it used to be greyed over: 6 candidates before any
      // pick, 0 after one — real, and not this picker's business.
      const base = index!.slotsOf(wall.id).find((part) => part.name === BASE_SLOT)
      if (base === undefined) throw new Error('the wall declares no base part')
      const door = states[0]?.options[0]?.variant.id
      if (door === undefined) throw new Error('the door slot offered nothing')
      expect(index!.resolve(base, wall.id).tiles).toHaveLength(6)
      expect(
        index!.resolve(base, wall.id, [{ partName: 'door', tags: index!.tagsOf(door) }]).tiles,
      ).toHaveLength(0)
    }, SLOW_MS)

    it('is either inert or fatal — a sibling pick narrows nothing in between', () => {
      // 33,221 observations, and the reason this row is about greying rather
      // than about progressive narrowing: 94.0% of picks change nothing, 6.0%
      // empty a slot outright, **3** make an empty slot resolvable, and not one
      // moves a non-empty set to a smaller non-empty set.
      let observations = 0
      let narrowed = 0
      let emptied = 0
      let unchanged = 0
      let widened = 0

      for (const record of file.records) {
        const parts = record.config?.parts ?? []
        if (parts.length < 2) continue
        for (let i = 0; i < parts.length; i += 1) {
          const slot = parts[i]!
          for (const tile of index!.resolve(slot, record.id).tiles) {
            const siblings = [{ partName: slot.name, tags: index!.tagsOf(tile) }]
            for (let j = 0; j < parts.length; j += 1) {
              if (j === i) continue
              const other = parts[j]!
              const before = index!.resolve(other, record.id).tiles.length
              const after = index!.resolve(other, record.id, siblings).tiles.length
              observations += 1
              if (after > before) widened += 1
              else if (after === before) unchanged += 1
              else if (after === 0) emptied += 1
              else narrowed += 1
            }
          }
        }
      }

      expect({ observations, narrowed, emptied, unchanged, widened }).toEqual({
        observations: 33221,
        narrowed: 0,
        emptied: 2000,
        unchanged: 31218,
        widened: 3,
      })
    }, SLOW_MS)

    it('leaves 526 of 3,695 slots empty before anything is picked, 517 of them base slots', () => {
      const empty = new Map<string, number>()
      for (const { parent, slot } of fileSlots()) {
        if (index!.resolve(slot, parent).deadEnd) {
          empty.set(slot.name, (empty.get(slot.name) ?? 0) + 1)
        }
      }
      const total = [...empty.values()].reduce((sum, count) => sum + count, 0)

      expect(total).toBe(526)
      expect(Math.round((total / fileSlots().length) * 1000) / 10).toBe(14.2)
      expect([...empty.entries()].sort((a, b) => b[1] - a[1])).toEqual([
        [BASE_SLOT, 517],
        ['fracture slope', 5],
        ['top', 4],
      ])

      // 9 of the 1,244 accessory slots. `planSlots`'s `unfillable` counts these.
      expect(total - 517).toBe(9)
    })
  })

  /* ------------------------------------------------- 62%, and both readings */

  describe('the plan row’s 62%', () => {
    it('is 76.9% under the ported reading and 33.7% under the wide one', () => {
      let ported = 0
      let wide = 0
      let slots = 0
      for (const { parent, slot } of fileSlots()) {
        slots += 1
        if (index!.resolve(slot, parent).tiles.length < 50) ported += 1
        const bare = index!.candidatesFor({
          require: (slot.tags.require ?? []).map((ref) => ref.tag),
          deny: (slot.tags.deny ?? []).map((ref) => ref.tag),
          accept: [],
        })
        if (bare.tiles.length < 50) wide += 1
      }

      expect(slots).toBe(3695)
      expect({ ported, wide }).toEqual({ ported: 2843, wide: 1247 })
      expect(Math.round((ported / slots) * 1000) / 10).toBe(76.9)
      expect(Math.round((wide / slots) * 1000) / 10).toBe(33.7)
      expect(Math.round((ported / slots) * 100)).not.toBe(62)
      expect(Math.round((wide / slots) * 100)).not.toBe(62)
    })
  })

  /* ------------------------------------------------------------------- the key */

  describe('the slot choice key', () => {
    it('is unique per file, which is why this row needs no key from A1', () => {
      let collisions = 0
      for (const record of file.records) {
        const seen = new Set<string>()
        for (const slot of record.config?.parts ?? []) {
          const key = slotChoiceKey(record.id, slot.name)
          if (seen.has(key)) collisions += 1
          seen.add(key)
        }
      }
      expect(collisions).toBe(0)
    })

    it('would collide on 12 aggregates, with or without `PartSlot.id`', () => {
      // The measurement behind "an aggregate-level slot choice would still need
      // A1's private `slotKey`". `id` is a pairing marker, not an identifier.
      let byName = 0
      let byNameAndId = 0
      for (const aggregate of items()) {
        const names = new Map<string, number>()
        const pairs = new Map<string, number>()
        for (const slot of aggregate.slots) {
          names.set(slot.slot.name, (names.get(slot.slot.name) ?? 0) + 1)
          const key = `${slot.slot.name}/${slot.slot.id ?? ''}`
          pairs.set(key, (pairs.get(key) ?? 0) + 1)
        }
        for (const count of names.values()) if (count > 1) byName += 1
        for (const count of pairs.values()) if (count > 1) byNameAndId += 1
      }
      expect({ byName, byNameAndId }).toEqual({ byName: 12, byNameAndId: 12 })
    })

    it('needs a delimiter no printable character can be', () => {
      // 5 live tile ids contain a space, and 5 of the 29 slot names do.
      expect(file.records.filter((record) => record.id.includes(' '))).toHaveLength(5)
      const names = [...new Set(fileSlots().map((entry) => entry.slot.name))]
      expect(names.filter((name) => name.includes(' '))).toHaveLength(5)
    })

    it('pairs exactly the six slots the fixture marks as one part', () => {
      const withId = fileSlots().filter((entry) => entry.slot.id !== undefined)
      expect(withId).toHaveLength(6)
      expect([...new Set(withId.map((entry) => entry.parent))]).toHaveLength(3)
      expect([...new Set(withId.map((entry) => entry.slot.name))].sort()).toEqual([
        'grate (left)',
        'grate (right)',
      ])
    })
  })

  /* ---------------------------------------------------------------- the states */

  describe('slotStates over the whole corpus', () => {
    it('never offers a base slot and never throws', () => {
      let states = 0
      let offered = 0
      for (const record of file.records) {
        const resolved = slotStates(index!, record.id)
        states += resolved.length
        offered += pickerSlots(index!, record.id).length
        expect(resolved.every((state) => state.name !== BASE_SLOT)).toBe(true)
      }
      expect({ states, offered }).toEqual({ states: 1244, offered: 1244 })
    }, SLOW_MS)
  })

  /* ------------------------------------------------------------------ helpers */

  /** One slot's candidate items, with how many of each item's files are dead. */
  function slotOptions(
    parent: TileId,
    slot: PartSlot,
    parts: readonly PartSlot[],
  ): readonly { readonly variants: number; readonly dead: number; readonly empties: readonly string[] }[] {
    const resolved = index!.resolve(slot, parent)
    const byItem = new Map<number, TileId[]>()
    for (const tile of resolved.tiles) {
      const variant = aggregates!.byTile.get(tile)
      if (variant === undefined) continue
      const aggregate = aggregates!.byDesign.get(variant.design)
      if (aggregate === undefined) continue
      const at = aggregate.address as unknown as number
      byItem.set(at, [...(byItem.get(at) ?? []), tile])
    }

    return [...byItem.values()].map((tiles) => {
      let dead = 0
      const empties = new Set<string>()
      for (const tile of tiles) {
        const siblings = [{ partName: slot.name, tags: index!.tagsOf(tile) }]
        let closed = false
        for (const other of parts) {
          if (other.name === slot.name) continue
          if (index!.resolve(other, parent).deadEnd) continue
          if (index!.resolve(other, parent, siblings).deadEnd) {
            closed = true
            empties.add(other.name)
          }
        }
        if (closed) dead += 1
      }
      return { variants: tiles.length, dead, empties: [...empties] }
    })
  }
})
