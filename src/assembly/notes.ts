/**
 * The note vocabulary — the whole of what assembly resolution is allowed to say.
 *
 * §7's rule, stated exactly: **compatibility informs; it never refuses a
 * placement.** Everything a resolution finds wrong with an instance is a note.
 *
 * The reason enforcement stops there is not caution, it is data: refusing a
 * placement would need trustworthy per-edge connector data, and the corpus has
 * none — 2,978 tiles (34.2%) carry no `build|` tag at all, and the `connection|`
 * tags name systems and mount positions, not edges. A resolver that refused
 * placements on this data would refuse correct builds, which is worse than
 * permitting a wrong one, because the user can see a wrong one on the table.
 *
 * **One thing is now refused, and it is a download rather than a placement.** A
 * template instance with a required slot unfilled is not a wrong build, it is an
 * *incomplete* one, and §3.2's "places anyway" says the grid must accept it. But
 * a zip of an incomplete instance is a pack one file short of a printable model,
 * and that is not something a note can carry on its own — see `slot-unfilled`
 * below and `BillOfTiles.complete`.
 *
 * Two severities, and the split is by **who the note is for**:
 *
 *   - `warn` — something the user should look at before they print. Fires on a
 *     minority of placements by construction; if a warn ever fires on a third of
 *     the corpus it is mis-classified.
 *   - `info` — something true of the data that the UI may want to show but that
 *     nobody needs to act on. `build-unspecified` is the archetype: it is true
 *     of **3,610 of the 14,241 (slot, candidate) pairs the 128 shipped template
 *     slots admit** (25.35%), so at `warn` it would be wallpaper and the real
 *     warnings would be read past.
 *
 * ## Row A3 removed eight of the fourteen codes
 *
 * Every one of the eight was about the base the resolver used to insert, and
 * with a template declaring its base as an ordinary slot there is nothing left
 * for any of them to be about:
 *
 *   - `base-auto-inserted`, `base-option-chosen`, `base-lock-mismatch` and
 *     `base-texture-mismatch` disclosed a choice the app made on the user's
 *     behalf. It does not make it: the fill is in the scene, the user or the
 *     solver put it there, and `@/composition` says whether it belongs.
 *   - `base-already-on-plan` warned that a topper got a base added while a base
 *     already sat on its cell — *"the bill asks for two prints of a base you
 *     have placed once."* Nothing adds a base, so the bill cannot ask for the
 *     second print. Two slots of one instance resolving to the same file is now
 *     a *legitimate* quantity of 2, which is contract C-c and is the md5 dedupe
 *     doing its job rather than a fault.
 *   - `no-matching-base`, `no-congruent-base` and `base-unmatchable` classified
 *     the archive's base gap. That classification survived —
 *     `baseMatch.ts#baseGap` — but it is no longer a *note*, because no bill can
 *     emit one. Leaving them in this union would have left `billView.ts`
 *     rendering copy for three codes it can never receive, with nothing to make
 *     that visible.
 *
 * Three arrived in their place, and all three are conditions the old resolver
 * was structurally unable to express: a fill can now be wrong, missing, or name
 * a template this build does not ship.
 *
 * ## Four more for the accessories, and only two of them are warnings
 *
 * A fill may carry **holds** — the torch in the wall's socket, the door in its
 * opening — and 1,047 of the 1,244 accessory declarations in the corpus are
 * required, so a hold is not a decoration the vocabulary can stay silent about.
 * `hold-unknown-tile` and `hold-off-slot` are `unknown-tile` and `fill-off-slot`
 * read one level down, and they are separate codes rather than a widening of
 * those two because a roll-up that mixed the two levels would count a missing
 * torch as a missing wall.
 *
 * `hold-unplaced` is `info` and that is the considered half: a host with no
 * measured mount for the slot is a gap in `tools/mounts/`'s pass rather than a
 * fault in the room, the accessory is still billed once, and *"in the bill, and
 * not on the plan"* is the sentence `no-footprint` already carries at `info`.
 *
 * `hold-unanchored` is the same gap read from the other end — the *insert* has
 * no measured `CatalogRecord.anchor` — and is `info` for the same reason.
 * Two codes rather than one, because the two are different halves of one pair
 * and a user who is told *"nothing measured this"* can do nothing with either;
 * whoever runs `tools/mounts/` needs to know which side came back empty.
 */
import type { TileId } from '@/catalog'
import type { PlacementId, SlotName } from '@/store'

/**
 * Every note the resolver can emit.
 *
 * A closed union rather than free-form strings, so a UI can switch on it
 * exhaustively and a new note cannot be added without the compiler pointing at
 * every place that must decide what to do with it.
 */
export type NoteCode =
  /**
   * The instance names a template this build does not ship.
   *
   * The subject is a `TemplateId` and **not** a {@link TileId}, which is why
   * this is its own code rather than a widening of `unknown-tile`: a template id
   * is not a catalog identity at all — none of the 40 carries `file_metadata`,
   * so none is a `CatalogRecord` and none is in `catalog.json` — and a note that
   * named one in `Note.tileId` would hand a UI a string that no lookup in the
   * app can resolve.
   *
   * Reachable two ways. A persisted scene can name a family a later build
   * dropped, which `store/migrations.ts` cannot catch because it deliberately
   * has no access to the template table. And a `DesignId` is `d` plus twelve hex
   * characters, which **matches `TemplateId`'s slug pattern**, so a hand-edited
   * blob that renamed the field as well as re-stamping the version parses and
   * arrives here. Either way it fails closed: no slots, no parts, one note.
   */
  | 'unknown-template'
  /**
   * A slot's fill names a file that is not in this catalog build.
   *
   * The subject is the fill's own {@link TileId}, so this note names something a
   * reader can look up — which is the whole difference from the pre-A3 form,
   * where the placement named a `DesignId` and the message had to carry an
   * identity the catalog did not hold. A fill is a *file*, and §2's ordinal rule
   * 3 applies to it directly: a retired file id in a persisted scene, or an old
   * share link.
   *
   * Costs **one part, not one placement**. That is the substantive change and it
   * cuts both ways: an instance survives a dead fill and still prints its other
   * slots, and the same instance no longer announces itself as unresolvable.
   * `slot-unfilled` is what carries the consequence, and `BillOfTiles.complete`
   * is what stops the zip.
   */
  | 'unknown-tile'
  /**
   * A declared, **non-optional** slot has nothing in it — or has something this
   * catalog cannot resolve.
   *
   * `PartSlot.optional` is absent on 1,050 of the 3,695 live tile slots and
   * **absence means required**; measured over the 40 shipped templates it is
   * absent from **all 128 parts**, so every slot of every template is required
   * today and this note is the only thing standing between an unfilled slot and
   * a zip one file short of a printable model. §3.2 still places the instance
   * anyway — this informs, and `BillOfTiles.complete` refuses.
   *
   * Fires for an unfilled slot *and* for a slot whose fill did not resolve, on
   * purpose: from the print's point of view those are the same missing file, and
   * splitting them would let a scene look complete while holding a dead id. The
   * `unknown-tile` note beside it says which of the two happened.
   */
  | 'slot-unfilled'
  /**
   * The file in a slot is not among the files that slot admits.
   *
   * The condition `@/composition` computes: the fill fails the slot's `require`,
   * is caught by its `deny`, or violates the `constrain` join over the
   * template's tags and the siblings' — C1's port of the catalog frontend's own
   * `config-processing.ts`, with all 69 of its tests. This module's directory is
   * the fourth consumer of that machinery and grows no copy of it.
   *
   * Unreachable through the solver, which fills from the candidate set, and
   * reachable through everything else: a **pinned** fill that a later lock
   * change or corpus rebuild has moved out of the set (`config` is the one field
   * A1's aggregate collapse is not lossless on — it varies within 828
   * aggregates, 21.7%), a hand-edited `localStorage` blob, or a share link
   * decoded against a different manifest. `warn`, because the piece will print
   * and will not fit.
   */
  | 'fill-off-slot'
  /** The filled tile carries lock systems, none of them the preferred one. */
  | 'lock-unavailable'
  /** `Footprint` is `none`: the tile is in the bill but cannot be drawn on the plan. */
  | 'no-footprint'
  /**
   * A `part|` insert is filling a slot that is not an insert socket.
   *
   * Kept from the pre-A3 vocabulary and **measured before keeping it**: across
   * all 14,241 (slot, candidate) pairs the 128 shipped template slots admit,
   * **0 name a record with `layer === 'insert'`**. So the solver cannot reach
   * this note, and what can is exactly the population `fill-off-slot` describes
   * — a pinned or imported fill from outside the candidate set. It is `info`
   * rather than `warn` because `fill-off-slot` is the note that says the fill is
   * wrong; this one only says what kind of wrong.
   */
  | 'insert-on-grid'
  /** The tile carries no `build|` tag — true of 25.35% of what the template slots admit. */
  | 'build-unspecified'
  /**
   * A hold names a file that is not in this catalog build.
   *
   * {@link 'unknown-tile'} one level down, and a separate code rather than a
   * reuse of it because the subject is not the same kind of thing: the slot's
   * own fill is a *tile on the grid* and a hold is an accessory fitted into that
   * tile, so a roll-up mixing the two would tell a user that "2 slots name files
   * not in this build" when one of them is a torch inside a wall that is
   * perfectly present. The message names the hold, because {@link Note} carries
   * a `slot` and has no field for one — see {@link Note.slot}.
   *
   * Costs **one accessory, not the host**: the wall still prints and still fits,
   * and its other holds are untouched.
   */
  | 'hold-unknown-tile'
  /**
   * A hold sits in a slot the host file does not declare.
   *
   * `fill-off-slot`'s reading for an accessory, and the same population: nothing
   * the app writes can produce it — the accessory editor offers the host's own
   * `config.parts` — so what reaches it is a hand-edited `localStorage` blob, a
   * share link decoded against another manifest, or a host whose composition
   * changed under a saved room. `warn`, because the file will print and there is
   * nowhere on the host it goes.
   *
   * It is still counted in the bill. A hold this resolver dropped would be a
   * file the room draws and the bill does not list, and the two disagreeing
   * about what is in the scene is the failure this row is closing.
   */
  | 'hold-off-slot'
  /**
   * A hold's host has no measured mount for that slot: it prints, and nothing
   * can draw it.
   *
   * `info` for exactly {@link 'no-footprint'}'s reason — *in the bill, not on
   * the plan* — and not `warn`, because it is a gap in the **measurement** and
   * not a fault in the user's room: `CatalogRecord.mounts` is absent both for a
   * host with no accessory slot and for a host nobody has measured, and
   * `mountsFor` folds the two together. The accessory is billed once, so a
   * download taken before the measuring pass has caught up still holds the file
   * the user chose.
   */
  | 'hold-unplaced'
  /**
   * The **insert** has no measured anchor: it prints, and nothing can draw it.
   *
   * `hold-unplaced`'s mirror image and `info` for the same reason. The host may
   * be measured to the millimetre; without `CatalogRecord.anchor` there is no
   * point on the accessory's *own* mesh to seat on the mount, and
   * `builder/three/instances.ts` neither draws nor fetches one. Separate from
   * `hold-unplaced` because the two name opposite halves of one pair, and the
   * repair — measure this blob — is aimed at a different file.
   */
  | 'hold-unanchored'
  /**
   * The scene mixes construction systems that do not physically go together.
   *
   * `separate wall` (3,351 tiles) and `wall on tile` (863) are different ways of
   * building the same room and do not interleave on the table. **Read off every
   * part of every instance**, which is not where it used to look: it read one
   * record per placement, and under a multi-slot instance that would see the
   * floor and miss a wall in another slot — a genuine mix reported as none, with
   * absence of a note indistinguishable from nothing being wrong.
   */
  | 'mixed-build-systems'

/** Severity per {@link NoteCode}. Exported so a UI can filter without a switch. */
export const NOTE_SEVERITY: Readonly<Record<NoteCode, 'info' | 'warn'>> = Object.freeze({
  'unknown-template': 'warn',
  'unknown-tile': 'warn',
  'slot-unfilled': 'warn',
  'fill-off-slot': 'warn',
  'lock-unavailable': 'warn',
  'no-footprint': 'info',
  'insert-on-grid': 'info',
  'build-unspecified': 'info',
  'hold-unknown-tile': 'warn',
  'hold-off-slot': 'warn',
  'hold-unplaced': 'info',
  'hold-unanchored': 'info',
  'mixed-build-systems': 'warn',
})

/**
 * One note, and what it is about.
 *
 * **Three optional subject fields rather than one `tileId`, and the reason is
 * hazard 2's shape.** A pre-A3 note carried the placed tile's id and nothing
 * else, because a placement *was* one tile: naming the tile named the placement.
 * An instance has up to five slots, so a note carrying only a `TileId` cannot
 * say which slot asked — and for `slot-unfilled` there is no `TileId` to carry
 * at all, so a roll-up would show a count with an empty subject list and no way
 * to find the hole.
 *
 * All three are optional because the bill-level note (`mixed-build-systems`) is
 * about the scene and has no subject, and `unknown-template` has a placement but
 * no slot and no tile.
 */
export interface Note {
  code: NoteCode
  severity: 'info' | 'warn'
  /** Prose for a human. Never parsed — switch on `code`. */
  message: string
  /** The instance the note is about. Absent only on a scene-level note. */
  placement?: PlacementId
  /** The slot within that instance. Absent on a scene- or instance-level note. */
  slot?: SlotName
  /** The file the note is about, when there is one. */
  tileId?: TileId
}

/** What a note is about, as the one argument {@link note} takes for it. */
export interface NoteSubject {
  placement?: PlacementId
  slot?: SlotName
  tileId?: TileId
}

/** Build a note, taking its severity from {@link NOTE_SEVERITY} so the two cannot drift. */
export function note(code: NoteCode, message: string, subject: NoteSubject = {}): Note {
  return {
    code,
    severity: NOTE_SEVERITY[code],
    message,
    ...(subject.placement === undefined ? {} : { placement: subject.placement }),
    ...(subject.slot === undefined ? {} : { slot: subject.slot }),
    ...(subject.tileId === undefined ? {} : { tileId: subject.tileId }),
  }
}

/**
 * One note code, rolled up across a whole bill.
 *
 * The roll-up is not cosmetic. `build-unspecified` fires on a quarter of what
 * the template slots admit, and an instance holds up to five slots, so a bill
 * that listed it once per fill would be 250 lines of the same sentence for a
 * fifty-instance room — five times what it was before A3.
 */
export interface BillNote {
  code: NoteCode
  severity: 'info' | 'warn'
  message: string
  /** How many notes of this code the bill collected. */
  count: number
  /** The distinct files it fired for, sorted. Empty for a code with no file subject. */
  tileIds: TileId[]
  /**
   * The distinct instances it fired for, sorted.
   *
   * The field `slot-unfilled` exists for: it has no `tileIds` when the slot is
   * simply empty, so without this a UI could say "3 slots are empty" and nothing
   * about which three instances to go and look at.
   */
  placements: PlacementId[]
  /** The distinct slot names it fired for, sorted. Empty for a scene-level note. */
  slots: SlotName[]
}

/**
 * Collapse per-slot notes to one entry per code.
 *
 * Ordering is `warn` before `info`, then by descending count, then by code — a
 * total order, so two runs over the same scene produce the same bill and a
 * snapshot test is meaningful.
 */
export function rollUpNotes(notes: Iterable<Note>): BillNote[] {
  interface Bucket {
    note: Note
    count: number
    tiles: Set<TileId>
    placements: Set<PlacementId>
    slots: Set<SlotName>
  }
  const byCode = new Map<NoteCode, Bucket>()

  for (const item of notes) {
    let bucket = byCode.get(item.code)
    if (bucket === undefined) {
      bucket = { note: item, count: 0, tiles: new Set(), placements: new Set(), slots: new Set() }
      byCode.set(item.code, bucket)
    }
    bucket.count += 1
    if (item.tileId !== undefined) bucket.tiles.add(item.tileId)
    if (item.placement !== undefined) bucket.placements.add(item.placement)
    if (item.slot !== undefined) bucket.slots.add(item.slot)
  }

  return [...byCode.values()]
    .map(({ note: first, count, tiles, placements, slots }) => ({
      code: first.code,
      severity: first.severity,
      message: first.message,
      count,
      tileIds: [...tiles].sort(ascending),
      placements: [...placements].sort(ascending),
      slots: [...slots].sort(ascending),
    }))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'warn' ? -1 : 1
      if (a.count !== b.count) return b.count - a.count
      return ascending(a.code, b.code)
    })
}

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
