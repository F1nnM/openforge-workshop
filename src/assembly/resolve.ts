/**
 * Resolving one template instance into the physical parts a person has to print.
 *
 * ## The guessing is gone, and that is the row
 *
 * This module was 956 lines and roughly 700 of them existed to infer what the
 * user meant. Two rules did the inferring and decision **D1** deleted both:
 *
 *   - **Rule 0** took the `DesignId` a placement named and asked the aggregate
 *     layer which of the item's files this build's lock preference wanted —
 *     necessary, because 1,705 of the 3,822 designs hold more than one file and
 *     the three lock systems disagree about the answer for 1,419 of them
 *     (37.1%). A fill names an exact `TileId`, so there is nothing left to
 *     choose and nothing left to disclose.
 *   - **Rule 1** auto-inserted a base under every `connection|openforge` piece
 *     and ranked the candidates on a five-criterion weighted ladder. A template
 *     declares its base as a slot — all 40 of the shipped templates do, one
 *     `base` part each — so the base is an ordinary fill and the insert is gone.
 *     The *ladder* is not: `baseMatch.ts` keeps it as the default-fill ranking a
 *     slot solver needs, and its docblock says why deleting it would have been
 *     deleting a good decision rather than a decision.
 *
 * What is left is arithmetic over what the scene already says: walk the
 * template's declared slots, look each fill up by id, and report what is missing
 * or wrong. Nothing here substitutes a file, adds a part, or has an opinion
 * about which file belongs in a slot.
 *
 * ## What replaced the guessing: saying when a fill is wrong
 *
 * An explicitly-filled instance can be wrong in ways rule 0 and rule 1
 * structurally could not express — a fill failing its part's `require`, a
 * `constrain` sibling violation, a retired fill, a fill that disagrees with the
 * lock. **That machinery already exists once**, in `@/composition`: C1's port of
 * the catalog frontend's own `config-processing.ts` with all 69 of its tests,
 * emitting 0 bytes into the artefact. `src/assembly/` is its **fourth** consumer
 * and grows no copy of it — {@link AssemblyContext.composition} is the index,
 * and one call to `resolveSlotTags` plus one to `candidatesFor` is the whole of
 * the check.
 *
 * ## `ResolvedPlacement.tile` is deleted rather than repointed — contract C-h
 *
 * It was one `CatalogRecord` per placement, read by eight call sites, and under
 * a multi-slot instance there is no honest value for it: "the primary slot's
 * record" would describe a fifth of a five-part instance while type-checking
 * everywhere. So the field is gone and every reader is a compile error. The same
 * discipline took `AssemblyPart.role` and `BillLine.baseQuantity` with it: a
 * `role` of `'placed'` on every fill would read as *no bases were added* rather
 * than *this no longer applies*, and mapping a slot **named** `base` to
 * `role: 'base'` would count a deliberate user choice as an auto-insert.
 *
 * ## What survives untouched, and why it has to
 *
 * {@link selectVariantForLock} — *which file does this item resolve to under
 * this preference* — is the one piece of rule 0 that was never about placements.
 * Five call sites outside this directory ask it, including the canvas and the
 * slots panel, and row C2's solver is the sixth: a candidate grid is an **item**
 * grid, and the file is chosen from the item afterwards. It is the only reason
 * `@/catalog`'s aggregate layer is still named in this file.
 */
import type { CatalogRecord, PartSlot, TileAggregate, VariantSelection } from '@/catalog'
import { mountsFor, selectVariant } from '@/catalog'
import type { CompositionIndex, SlotTags } from '@/composition'
import { resolveSlotTags } from '@/composition'
import type {
  HoldFill,
  HoldName,
  LockSystem,
  SlotFill,
  SlotName,
  TemplateId,
  TemplateInstance,
} from '@/store'
import { filledSlots } from '@/store'

import type { AssemblyIndex } from './assemblyIndex'
import { PRINT_OPTIONS } from './assemblyIndex'
import type { Note } from './notes'
import { note } from './notes'

/* ------------------------------------------------------------------ templates */

/**
 * One declared slot of a template, as this module needs it.
 *
 * A **structural** contract rather than an import, and the layering is the whole
 * reason: the 40 shipped templates live in `src/screens/assemblies/templates.ts`
 * because *"the recipe list is the one part of that screen that renders before
 * the index lands"*, and `src/assembly` must not reach into a screen. So the
 * caller passes the template in, and `RecipeTemplate` from `@/screens/assemblies`
 * is assignable to {@link AssemblyTemplate} without a cast or an adapter — its
 * `TemplatePart` is `Pick<PartSlot, 'name' | 'tags'>` plus `fulfills`, and extra
 * properties are fine in a non-literal position.
 *
 * `tags` is `SlotTags` from `@/composition` rather than `PartSlot['tags']` from
 * `@/catalog`, for C1's stated reason: `PartSlot['tags']` is assignable to
 * `SlotTags`, `SlotTags` models two spec keys the schema deliberately does not
 * (`accept`, `constrain[].parent`, both 0 corpus-wide), and this is the type the
 * port *consumes*. Naming the consumed type means a real divergence between the
 * two is a compile error at the call site instead of nothing at all.
 */
export interface AssemblySlot {
  readonly name: string
  readonly tags: SlotTags
  /**
   * **Absence means required.** `PartSlot.optional` is absent on 1,050 of the
   * 3,695 live tile slots, and measured over the 40 shipped templates it is
   * absent from **all 128 parts** — so every slot of every template ships
   * required today, and a reading that treated absence as optional would let the
   * download gate pass on every incomplete instance in the app.
   */
  readonly optional?: boolean
}

/** A template family, as this module needs it: an id, its own tags, and its slots. */
export interface AssemblyTemplate {
  readonly id: string
  /**
   * The template's own tags — the `parentTags` a `constrain` entry reads.
   *
   * Four roots over all 230 of them: `object`, `build`, `shape`, `component`.
   * The absence of `size|` and `connection|` is why a template's slots *narrow*
   * where a tile's slots do not — 8,645 narrowings in 11,938 observations
   * against a tile parent's 0 in 33,221 — and it is what makes the `constrain`
   * check below worth running rather than vacuous.
   */
  readonly tags: readonly string[]
  readonly parts: readonly AssemblySlot[]
}

/**
 * The template a `TemplateId` names, or `undefined` when this build ships none.
 *
 * A function rather than a `ReadonlyMap`, so a caller may back it with the
 * screen's 40-entry array, a map, or a lazily-loaded chunk without this module
 * having an opinion. `undefined` is the honest answer for a persisted scene that
 * names a retired family, and it produces one `unknown-template` note and no
 * parts.
 */
export type TemplateLookup = (id: TemplateId) => AssemblyTemplate | undefined

/* -------------------------------------------------------------------- context */

/**
 * Everything a resolution needs beside the instance and the catalog index.
 *
 * **Required, and it replaced an `AssemblyOptions = {}` default.** The old shape
 * was two optional fields, so a caller who passed nothing got a working
 * resolution; the two authorities added here are not like that. Without the
 * template there are no slots to walk, and without the composition index a fill
 * cannot be checked against the slot that holds it — and a resolution that
 * silently skipped the check would emit a plausible bill for a scene full of
 * misfitting parts. So there is no default and no optional field for either: a
 * call site that has not decided is a compile error.
 */
export interface AssemblyContext {
  /** The template table this build ships. See {@link TemplateLookup}. */
  readonly templates: TemplateLookup
  /**
   * `@/composition`'s inverted index over the **same** catalog as the assembly
   * index.
   *
   * A parameter and never built here, for the reason C1 and C3 both give: it is
   * a 409,432-byte inverted index and about 11 ms of work,
   * `createCompositionIndex` is pure and deterministic, and
   * `screens/detail/slots/slotPicker.ts#compositionIndexFor` has very likely
   * already built one for this catalog. A second copy would buy nothing and
   * would double the memory.
   *
   * Two indexes over *different* catalogs is the one hazard that survives, and
   * it fails towards noise rather than silence: a fill this composition index
   * has never seen is in no candidate set, so it is reported `fill-off-slot`
   * rather than passing unchecked.
   */
  readonly composition: CompositionIndex
  /**
   * The global lock preference (§2: you cannot physically mix systems in one
   * build).
   *
   * **Optional, and absence means "no preference" rather than a default.** The
   * default lives in the store, and reading it here would give this module a
   * runtime dependency on the store and would silently apply openlock to a
   * caller that had deliberately not chosen. With no preference,
   * `lock-unavailable` simply cannot fire.
   *
   * It no longer picks anything. It used to choose the file *and* the base; a
   * fill names both, so all this does now is decide whether a fill that carries
   * lock systems is carrying the wrong one. Re-solving the `auto` fills when the
   * preference changes is the store's and row C2's job — see `SlotFill.pinned`.
   */
  readonly lock?: LockSystem
}

/* --------------------------------------------------------------------- parts */

/**
 * One file to print, and the slot that asked for it.
 *
 * **There is no `role`.** It was `'placed' | 'base'` and it meant *did the user
 * put this here or did rule 1*. Nothing is auto-inserted, so every part would be
 * `'placed'` — and a UI reading that would say "no added bases" where the truth
 * is "the question no longer applies". The slot name is what replaces it, and it
 * says strictly more: `base` is one of the six slot names the 40 templates use
 * (`floor` 40, `base` 40, `wall` 32, `column` 8, `right wall` 4, `left wall` 4),
 * so a caller that wants the base of an instance asks for the slot by name and
 * gets a fact about the recipe rather than an inference about provenance.
 */
export interface AssemblyPart {
  /** The template slot this part fills. */
  slot: SlotName
  record: CatalogRecord
  /** `true` when the user chose this file, `false` when the default solver did. */
  pinned: boolean
  /**
   * The accessory slot of {@link slot}'s **own file** this part fills, when it
   * is an accessory rather than a tile.
   *
   * Absent for a recipe part, which is what makes `hold === undefined` the test
   * for *is this a tile on the grid*. `slot` stays the template slot in both
   * cases, so a hold's provenance is the pair: the wall the torch is in, and the
   * socket it is in on that wall.
   */
  hold?: HoldName
  /**
   * Copies to print of {@link record}.
   *
   * **1 for a recipe part, and one per measured mount for a hold.** A slot is
   * one place on the grid, so a template part is always a single print; an
   * accessory slot is not — a 1×1 full pillar carries a torch socket on each of
   * its four faces, and one `torch` hold in it is four torches. `mountsFor`
   * returns the measured list and this is `max(1, …)` of its length, so a host
   * nobody has measured still bills the accessory once rather than dropping the
   * file the user chose — see `notes.ts#hold-unplaced`.
   */
  quantity: number
}

/**
 * One accessory slot of one filled slot's file, resolved.
 *
 * Present for **every** declared accessory slot of every resolved fill, filled
 * or not, for {@link ResolvedSlotFill}'s reason one level down: 1,047 of the
 * 1,244 accessory declarations in the corpus are required, so an unfilled one is
 * a hole in the print and has to be a value a caller can render rather than an
 * absence it infers by differencing the host's `config.parts` against the fill's
 * `holds` map.
 *
 * Plus one per hold naming a slot the host does **not** declare, which is the
 * `hold-off-slot` case: dropping it would leave a file the room draws and the
 * bill does not list.
 */
export interface ResolvedHold {
  /** The **template** slot whose file holds this accessory. */
  readonly slot: SlotName
  /** The accessory slot of that file — a `config.parts` name, never `base`. */
  readonly hold: HoldName
  /**
   * `PartSlot.optional !== true`, resolved.
   *
   * Always `true` for an undeclared hold: there is no declaration to be required
   * by, so a stray hold can never refuse a download.
   */
  readonly optional: boolean
  /** The hold as persisted, or `undefined` for a declared slot with nothing in it. */
  readonly fill: HoldFill | undefined
  /** The record it resolved to. `undefined` for an empty slot or a retired id. */
  readonly record: CatalogRecord | undefined
  /**
   * Measured mounts for this slot on the host — `mountsFor(host, hold).length`.
   *
   * `0` means *nowhere to put it*, and it is the ordinary reading today rather
   * than an exceptional one: `CatalogRecord.mounts` is absent both for a host
   * with no accessory slot and for a host nobody has measured, and the shipped
   * artefact carries no measurement at all until `npm run mounts` has walked the
   * archive.
   */
  readonly mounts: number
}

/**
 * One declared slot of one instance, resolved.
 *
 * Present for **every** slot the template declares, filled or not, and in the
 * template's declared order — which is what makes an unfilled slot a value a
 * caller can render rather than an absence it has to infer by differencing two
 * lists.
 */
export interface ResolvedSlotFill {
  slot: SlotName
  /** See {@link AssemblySlot.optional}: this is the resolved reading, never `undefined`. */
  optional: boolean
  /** The fill as persisted, or `undefined` for a slot with no entry in `fills`. */
  fill: SlotFill | undefined
  /** The record the fill resolved to. `undefined` for an unfilled slot or a retired id. */
  record: CatalogRecord | undefined
  /**
   * Whether the fill is among the files this slot admits.
   *
   * `undefined` — not `false` — when there is nothing to check: an unfilled
   * slot, or a fill this catalog does not hold. Three states rather than two
   * because "not checked" and "checked and wrong" are different things to show,
   * and a boolean would report the first as the second.
   */
  admissible: boolean | undefined
}

/**
 * One template instance, resolved.
 *
 * Total: every input produces a `ResolvedInstance`. Nothing throws and nothing
 * is refused — §7 — so an unknown template yields empty `slots` and `parts` and
 * one note, and an instance with every slot empty yields a `slots` entry per
 * declared slot, no parts, and one `slot-unfilled` note each.
 */
export interface ResolvedInstance {
  /** Carried through unchanged; nothing here reads `x`, `z` or `rotation`. */
  instance: TemplateInstance
  /** The template, or `undefined` when this build ships none by that id. */
  template: AssemblyTemplate | undefined
  /** Every declared slot, in the template's declared order. Empty for an unknown template. */
  slots: ResolvedSlotFill[]
  /**
   * Every accessory slot of every resolved fill, in the host's declared order.
   *
   * The `slots` field one level down — see {@link ResolvedHold}. Empty for most
   * instances: 1,005 of the 8,702 live files (11.6%) declare an accessory slot
   * at all, so a room of plain floors and walls resolves no holds whatever.
   */
  holds: ResolvedHold[]
  /**
   * The files to print, in slot order — each with the copies it costs.
   *
   * One per resolved fill *and* one per resolved hold, immediately after the
   * slot that holds it; **not** one per slot and not one per mount. The four
   * torches of a four-socket pillar are one part with a `quantity` of 4, because
   * they are one file and one download.
   */
  parts: AssemblyPart[]
  notes: Note[]
  /**
   * Every declared non-optional slot **and accessory slot** resolved to a
   * record.
   *
   * `false` for an unknown template as well, because an instance whose recipe
   * this build does not hold cannot be shown to be complete. This is the
   * per-instance half of the download gate; `BillOfTiles.complete` is the other.
   *
   * The accessory half is not a widening of the same rule but the same rule
   * applied to the same kind of thing: 1,047 of the 1,244 accessory declarations
   * are required, and a pack missing the door of a doorway is a pack one file
   * short of a printable model exactly as a pack missing the doorway is.
   */
  complete: boolean
}

/* --------------------------------------------------------- variant selection */

/**
 * Which file of an item a lock preference wants — rule 0's one surviving half.
 *
 * Two arguments and both are load-bearing. `bottom` is the lock the build wants
 * *underneath* the piece, which is the question `docs/tile-aggregation.md` §5.2
 * ranks on.
 *
 * **`PRINT_OPTIONS` is passed, always**, and what omitting it costs is measured:
 * `VariantPreference.options` is optional, and without it the rank falls through
 * to `bytes` ascending — which is the tie-break D1 removed from base matching
 * for cause, because the topless print of a base is its smallest file. There is
 * exactly one right value for that argument, so it is supplied here rather than
 * offered as a choice to six call sites.
 *
 * It takes an aggregate and returns a selection, and it never sees a placement —
 * which is why it outlived the rule it came from. Its callers are
 * `builder/canvas/catalog.ts` (so the canvas draws the file the bill lists),
 * `builder/panels/slots/planSlots.ts` (a composition slot is a property of a
 * *file*), `screens/builder/BuilderScreen.tsx`, and row C2's fill solver, which
 * needs it for the same two-step every candidate grid uses: pick the item, then
 * pick the file.
 */
export function selectVariantForLock(aggregate: TileAggregate, lock: LockSystem | undefined): VariantSelection {
  return selectVariant(aggregate, { bottom: lock, options: PRINT_OPTIONS })
}

/* ---------------------------------------------------------------- resolution */

/**
 * Resolve one template instance into its parts and its notes.
 *
 * Three passes over the template's slots and no more: read the fills, resolve
 * each filled slot's tag list for the sibling join, then walk the slots in
 * declared order emitting parts and notes. The sibling tags are computed once
 * per instance rather than once per slot — a five-slot instance would otherwise
 * ask `tagsOf` twenty-five times for five answers.
 */
export function resolveInstance(
  instance: TemplateInstance,
  index: AssemblyIndex,
  context: AssemblyContext,
): ResolvedInstance {
  const template = context.templates(instance.template)
  if (template === undefined) {
    // The subject is a template id, which is not a catalog identity, so it goes
    // in the message and **not** in `Note.tileId` — see `notes.ts`.
    const message = `this build ships no template called ${instance.template}; the recipe may have been retired.`
    return {
      instance,
      template: undefined,
      slots: [],
      holds: [],
      parts: [],
      notes: [note('unknown-template', message, { placement: instance.id })],
      complete: false,
    }
  }

  const notes: Note[] = []
  const parts: AssemblyPart[] = []
  const slots: ResolvedSlotFill[] = []
  const holds: ResolvedHold[] = []

  const filled = readFills(instance, template, index)
  const tagsByName = tagsOfFills(context.composition, filled)
  let complete = true

  for (const part of template.parts) {
    const slot = slotName(part)
    const optional = part.optional === true
    const entry = filled.get(part.name)

    // `Filled` is a union discriminated on `record`, so this one condition
    // narrows both halves at once: the else branch has a `CatalogRecord` and a
    // `SlotFill`, with no non-null assertion and no second lookup.
    if (entry === undefined || entry.record === undefined) {
      const fill = entry?.fill
      if (fill !== undefined) {
        notes.push(
          note('unknown-tile', `${fill.tile} is not in this catalog build; it may have been retired.`, {
            placement: instance.id,
            slot,
            tileId: fill.tile,
          }),
        )
      }
      if (!optional) {
        complete = false
        const why = fill === undefined ? 'is empty' : 'names a file this build does not hold'
        notes.push(
          note('slot-unfilled', `${template.id}'s ${part.name} slot ${why}.`, {
            placement: instance.id,
            slot,
            ...(fill === undefined ? {} : { tileId: fill.tile }),
          }),
        )
      }
      slots.push({ slot, optional, fill, record: undefined, admissible: undefined })
      continue
    }

    const { fill, record } = entry
    const admissible = admits(context, template, part, tagsByName, fill.tile)
    slots.push({ slot, optional, fill, record, admissible })
    parts.push({ slot, record, pinned: fill.pinned, quantity: 1 })
    notes.push(...slotNotes(instance, template, part, slot, record, admissible, context.lock))

    // The accessories fitted into *this file*. Walked here rather than in a
    // second pass because everything it needs is in hand: the host record
    // carries both the declarations (`config.parts`) and the measurements
    // (`mounts`), and neither exists for a fill this catalog cannot resolve.
    for (const held of resolveHolds(slot, fill, record, index)) {
      holds.push(held)
      notes.push(...holdNotes(instance, record, held))
      if (held.record !== undefined) {
        parts.push({
          slot,
          record: held.record,
          pinned: held.fill?.pinned === true,
          hold: held.hold,
          quantity: Math.max(1, held.mounts),
        })
      } else if (!held.optional) {
        complete = false
      }
    }
  }

  return { instance, template, slots, holds, parts, notes, complete }
}

/* --------------------------------------------------------------- the holds */

/**
 * The accessory slots of one filled slot's file, resolved.
 *
 * Two passes and they are not interchangeable. The first walks what the **host
 * declares** — `config.parts`, in fixture order — so an unfilled required slot
 * is a value rather than an absence; the second walks what the **fill holds**
 * and emits the entries the first could not name, which is the `hold-off-slot`
 * population.
 *
 * `base` is dropped from the declarations and it is not an accessory slot by any
 * reading: 2,451 of the 3,695 live file slots are `base`, the builder's base
 * comes from footprint congruence rather than from the texture-inheriting slot,
 * and treating one as an accessory would put a required hole in 2,451 hosts that
 * nothing in the app can fill. `screens/detail/slots/slotPicker.ts#pickerSlots`
 * makes the same cut for the same reason — the constant is not shared because
 * `@/assembly` must not import from a screen.
 */
function resolveHolds(
  slot: SlotName,
  fill: SlotFill,
  host: CatalogRecord,
  index: AssemblyIndex,
): ResolvedHold[] {
  const out: ResolvedHold[] = []
  const declared = accessorySlots(host)

  for (const part of declared) {
    out.push(resolvedHold(slot, holdName(part.name), part.optional === true, fill, host, index))
  }

  for (const name of filledSlots(fill.holds ?? {})) {
    if (declared.some((part) => part.name === name)) continue
    // Required-ness comes from a declaration and there is none, so an undeclared
    // hold is `optional` — it prints, `hold-off-slot` says it does not fit, and
    // it never refuses a download.
    out.push(resolvedHold(slot, name, true, fill, host, index))
  }
  return out
}

/** One {@link ResolvedHold}: the persisted hold, the record it names, and the mounts for it. */
function resolvedHold(
  slot: SlotName,
  hold: HoldName,
  optional: boolean,
  fill: SlotFill,
  host: CatalogRecord,
  index: AssemblyIndex,
): ResolvedHold {
  const held = fill.holds?.[hold]
  return {
    slot,
    hold,
    optional,
    fill: held,
    record: held === undefined ? undefined : index.byId.get(held.tile),
    mounts: mountsFor(host, hold).length,
  }
}

/**
 * Every note that is a fact about one hold.
 *
 * Three, and none of them is `slot-unfilled`'s: an empty required accessory slot
 * is carried by {@link ResolvedInstance.complete} and `BillOfTiles.unfilled`
 * alone, because `slot-unfilled`'s copy is about the 128 template parts and a
 * roll-up that mixed the two would tell a user a *recipe* slot is empty when a
 * torch socket is.
 */
function holdNotes(instance: TemplateInstance, host: CatalogRecord, held: ResolvedHold): Note[] {
  const notes: Note[] = []
  const subject = { placement: instance.id, slot: held.slot }

  if (held.fill !== undefined && held.record === undefined) {
    notes.push(
      note(
        'hold-unknown-tile',
        `the ${held.hold} in ${host.name} names ${held.fill.tile}, which is not in this catalog build.`,
        { ...subject, tileId: held.fill.tile },
      ),
    )
  }
  if (held.record === undefined) return notes

  if (!hasDeclaration(host, held.hold)) {
    notes.push(
      note(
        'hold-off-slot',
        `${host.name} declares no ${held.hold} slot, so ${held.record.name} will print and will not fit.`,
        { ...subject, tileId: held.record.id },
      ),
    )
    // **And nothing else.** An undeclared slot has no mount by construction, so
    // `hold-unplaced` would fire beside this one on every off-slot hold and add
    // *the plan cannot draw it* to *there is nowhere on the host it goes* — the
    // second note being a consequence of the first rather than a second fact.
    return notes
  }
  if (held.mounts === 0) {
    notes.push(
      note(
        'hold-unplaced',
        `nothing has measured where a ${held.hold} attaches to ${host.name}, so ${held.record.name} ` +
          'is in the bill and cannot be drawn.',
        { ...subject, tileId: held.record.id },
      ),
    )
  }
  return notes
}

function hasDeclaration(host: CatalogRecord, hold: HoldName): boolean {
  return accessorySlots(host).some((part) => part.name === hold)
}

/**
 * The accessory slots a host file declares — `config.parts` without `base`.
 *
 * One function rather than the filter written twice, so *what counts as an
 * accessory slot* has a single answer: {@link resolveHolds} walks it and
 * {@link hasDeclaration} tests against it, and a host that declared a slot the
 * note said was undeclared would be exactly the disagreement this row is
 * closing. 3,036 live tiles (34.9%) declare a `config` at all and 2,501 of those
 * carry exactly one slot, so the scan is over a one-element array in the
 * overwhelming case.
 */
function accessorySlots(host: CatalogRecord): readonly PartSlot[] {
  return (host.config?.parts ?? []).filter((part) => part.name !== BASE_SLOT)
}

/**
 * The slot name that is a base match and not an accessory.
 *
 * 2,451 of the 3,695 live file slots. `screens/detail/slots/slotPicker.ts`
 * exports the same constant and this is deliberately not that import:
 * `@/assembly` must not reach into a screen, and a shared constant in a third
 * module would be a module for one string. The *fact* is asserted in both
 * places instead.
 */
const BASE_SLOT = 'base'

/* ------------------------------------------------------------ the slot notes */

/** Every note that is a fact about one resolved fill. */
function slotNotes(
  instance: TemplateInstance,
  template: AssemblyTemplate,
  part: AssemblySlot,
  slot: SlotName,
  record: CatalogRecord,
  admissible: boolean,
  lock: LockSystem | undefined,
): Note[] {
  const notes: Note[] = []
  const subject = { placement: instance.id, slot, tileId: record.id }

  if (!admissible) {
    notes.push(
      note(
        'fill-off-slot',
        `${record.name} is not one of the files ${template.id}'s ${part.name} slot admits, ` +
          'so it will print and will not fit.',
        subject,
      ),
    )
  }
  if (record.foot.shape === 'none') {
    notes.push(
      note('no-footprint', `${record.name} has no derivable footprint and cannot be drawn on the plan.`, subject),
    )
  }
  if (record.layer === 'insert') {
    notes.push(
      note('insert-on-grid', `${record.name} is a component fitted into another piece, not a grid tile.`, subject),
    )
  }
  if (record.build === undefined) {
    notes.push(
      note('build-unspecified', `${record.name} names no build system, so its construction is unconstrained.`, subject),
    )
  }
  if (lock !== undefined && record.conn.some(isLockSystem) && !record.conn.includes(lock)) {
    notes.push(
      note(
        'lock-unavailable',
        `${record.name} offers ${record.conn.filter(isLockSystem).join(', ')}, not ${lock}.`,
        subject,
      ),
    )
  }
  return notes
}

/* ------------------------------------------------------------ the fill reads */

/**
 * One slot's fill and the record it resolved to.
 *
 * A **union discriminated on `record`** rather than one interface with a
 * nullable field, so a single `entry.record === undefined` test narrows the fill
 * as well: the resolved branch gets a `CatalogRecord` *and* a `SlotFill` with no
 * assertion. Written as one interface it needed either two guards or a non-null
 * assertion, and an assertion here would be exactly the kind of claim this row
 * exists to delete.
 */
type Filled =
  | { readonly fill: SlotFill; readonly record: CatalogRecord }
  | { readonly fill: SlotFill; readonly record: undefined }

/**
 * The fills of the slots this template declares, by declared part name.
 *
 * **Keys of `fills` that are not slots of the template are dropped, silently and
 * deliberately.** `store/schema.ts` states the condition and why it is
 * expressible: checking it would need the template table, which must not enter
 * the store's file closure, so *"an unknown key fails closed the same way an
 * unknown template does — nothing renders it, because rendering walks the
 * template's parts and asks `fills` for each."* This is that walk. A note for
 * one would be a note about a corruption class no path in the app can produce.
 */
function readFills(instance: TemplateInstance, template: AssemblyTemplate, index: AssemblyIndex): Map<string, Filled> {
  const out = new Map<string, Filled>()
  for (const part of template.parts) {
    const fill = fillOf(instance, part.name)
    if (fill === undefined) continue
    out.set(part.name, { fill, record: index.byId.get(fill.tile) })
  }
  return out
}

/**
 * The tag list of each fill, keyed by part name — the `siblings` half of a
 * `constrain` join.
 *
 * Computed once per instance. `CompositionIndex.tagsOf` de-interns a record's
 * tags into fresh strings on every call, and a five-slot instance asks about
 * four siblings per slot, so resolving them per slot would be twenty-five calls
 * for five answers on every bill build.
 *
 * A fill this catalog does not hold contributes **no tags**, which is the
 * correct reading rather than a shortcut: `constrain` collects tags *from* the
 * siblings, so a sibling with no tags narrows nothing, and an instance with a
 * retired fill therefore checks its other slots against a weaker constraint
 * instead of failing all of them.
 */
function tagsOfFills(
  composition: CompositionIndex,
  filled: ReadonlyMap<string, Filled>,
): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>()
  for (const [name, entry] of filled) {
    if (entry.record === undefined) continue
    out.set(name, composition.tagsOf(entry.fill.tile))
  }
  return out
}

/* ------------------------------------------------------------ admissibility */

/**
 * The candidate sets already computed, per composition index.
 *
 * Keyed on the **resolved constraint**, not on the slot, and the difference
 * matters: fifty instances of one template with the same fills resolve fifty
 * identical constraints, and one instance's five slots resolve five different
 * ones. Keyed on the constraint the whole fifty cost one postings intersection
 * each; keyed on the slot they would cost fifty. Measured cold on the live
 * corpus, resolving all 128 shipped template parts costs **14-19 ms over four
 * runs**, so a fifty-instance room would otherwise pay roughly 20-30 ms of
 * postings walks on every bill build.
 *
 * A `WeakMap` on the index rather than a module-level `Map`, so the cache dies
 * with the catalog it describes: `createCompositionIndex` is memoised on the
 * version stamp, and a reimport produces a new index and a new — empty — cache
 * rather than answers about the previous corpus.
 */
const CANDIDATE_CACHE = new WeakMap<CompositionIndex, Map<string, ReadonlySet<string>>>()

/**
 * The two delimiters the cache key is built from — **constructed, never typed.**
 *
 * A tag can hold any printable character and 5 slot names contain a space, so
 * every printable delimiter is ambiguous on real data; `assemblyStepKey` picked a
 * control character one namespace over for exactly that reason. What is different
 * here is how it is written.
 *
 * `tools/hygiene/source.test.ts` fails the build on a raw control byte in a
 * source file, and this repository has been bitten ten times by one — including
 * once while this row was being written, when a NUL written as a two-character
 * escape reached the file as the single byte it denotes.
 * {@link String.fromCharCode} makes that class of mistake unreachable: there is
 * no escape sequence in this file for a tool, an editor or a paste to collapse
 * into a byte, and the hygiene guard has nothing to find. The cost is two named
 * constants; the benefit is that the failure cannot recur here.
 */
const FIELD_SEPARATOR = String.fromCharCode(0)
const GROUP_SEPARATOR = String.fromCharCode(1)

/**
 * Is this file one of the files this slot admits?
 *
 * `resolveSlotTags` over the slot's own tags, the template's tags as the parent,
 * and the sibling fills — then `candidatesFor`, which is the postings
 * intersection. Both are `@/composition`'s; nothing here reimplements either.
 */
function admits(
  context: AssemblyContext,
  template: AssemblyTemplate,
  part: AssemblySlot,
  tagsByName: ReadonlyMap<string, readonly string[]>,
  tile: string,
): boolean {
  const siblings = [...tagsByName]
    .filter(([name]) => name !== part.name)
    .map(([partName, tags]) => ({ partName, tags }))
  const resolved = resolveSlotTags(part.tags, template.tags, siblings)

  const key = [
    resolved.require.join(FIELD_SEPARATOR),
    resolved.deny.join(FIELD_SEPARATOR),
    resolved.accept.join(FIELD_SEPARATOR),
  ].join(GROUP_SEPARATOR)

  let cache = CANDIDATE_CACHE.get(context.composition)
  if (cache === undefined) {
    cache = new Map<string, ReadonlySet<string>>()
    CANDIDATE_CACHE.set(context.composition, cache)
  }
  let admitted = cache.get(key)
  if (admitted === undefined) {
    admitted = new Set<string>(context.composition.candidatesFor(resolved).tiles)
    cache.set(key, admitted)
  }
  return admitted.has(tile)
}

/* --------------------------------------------------------------------- casts */

/**
 * A template's declared part name, as the type that addresses `fills`.
 *
 * One of the two casts in this module, and it is the position `store/schema.ts`
 * says a brand buys nothing in: *"a Zod brand is dropped from the key position
 * of a `Record`"*, so `SlotName` and `string` are interchangeable as keys and
 * the brand cannot distinguish a real slot name from any other string. What it
 * *does* buy is the argument position — `fillSlot(id, slot, tile)` — so minting
 * it here means a consumer can take a {@link ResolvedSlotFill.slot} straight to
 * `fillSlot` without a cast of its own, which is the one place the compiler has
 * anything to say.
 */
function slotName(part: AssemblySlot): SlotName {
  return part.name as SlotName
}

/**
 * A host's declared accessory-slot name, as the type that addresses `holds`.
 *
 * {@link slotName} for the other brand, and the same argument: `HoldName` is
 * dropped in key position, so the cast buys nothing there and everything at
 * `fillHold(id, slot, hold, tile)`, where it is the only thing saying which of
 * the three strings is which. Minting it here means a consumer can take a
 * {@link ResolvedHold.hold} straight to that action.
 *
 * The second loop of {@link resolveHolds} needs no cast: `filledSlots` reads the
 * key type off the map it is given, which is why it exists.
 */
function holdName(name: string): HoldName {
  return name as HoldName
}

/**
 * `fills[slot]`, with the index signature the brand collapses to made explicit.
 *
 * The inverse of {@link slotName} and the same fact: the key type is an index
 * signature, so `Readonly<Record<string, SlotFill | undefined>>` is what the map
 * really is at a read site. Written once, here, rather than at every read site.
 */
function fillOf(instance: TemplateInstance, slot: string): SlotFill | undefined {
  return (instance.fills as Readonly<Record<string, SlotFill | undefined>>)[slot]
}

/**
 * The lock systems, as a total map over the type.
 *
 * `Record<LockSystem, true>` rather than an array: the compiler rejects the
 * object if a member of the union is missing, so adding a fourth lock system
 * cannot leave this list stale. Membership is also O(1), which matters because
 * it is asked once per fill per connection tag.
 */
const LOCK_SYSTEMS: Readonly<Record<LockSystem, true>> = Object.freeze({
  openlock: true,
  dragonlock: true,
  magnetic: true,
})

function isLockSystem(value: string): boolean {
  return Object.hasOwn(LOCK_SYSTEMS, value)
}
