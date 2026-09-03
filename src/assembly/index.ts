/**
 * Assembly resolution's public surface.
 *
 * Import from `@/assembly`, not from the modules beneath it. The whole surface
 * is two functions over an index:
 *
 * ```ts
 * const index = buildAssemblyIndex(catalog)              // once per catalog build
 * const one   = resolvePlacement(placement, index, { lock })
 * const bill  = buildBillOfTiles(Object.values(scene), index, { lock })
 * const which = resolveVariant(design, index, { lock })  // rule 0, on its own
 * ```
 *
 * Row A6 added the fourth line and a step above the other three: the lock
 * preference decides **which file of the placed item** to print before any base
 * is considered. Row V4 made that step the *only* resolution — a placement names
 * an item and never a file — so `resolvePlacement`'s `tile` is the resolved
 * record and there is no other, and `ResolvedPlacement.resolution` says what was
 * chosen out of how many and how complete an assembly it is.
 *
 * {@link selectVariantForLock} is the fifth name, and it is the one the *canvas*
 * and the slots panel take: rule 0 with no base index, so a room draws and a
 * composition resolves against the same file the bill lists. `resolve.ts`'s
 * module docblock names all three callers.
 *
 * Pure throughout — no React, no DOM, no fetch, no renderer, and no state of its
 * own. {@link buildAssemblyIndex} is a deterministic function of the catalog, so
 * a caller may memoise it on the catalog's version stamp and never think about
 * it again.
 *
 * `PrintOption` is re-exported for a reason worth stating: `BaseMatch.option` is
 * of that type and `BaseMatch` is part of this surface, so without the name here
 * a consumer could hold the value and not be able to declare it.
 */
export type { AssemblyIndex, AssemblyIndexStats, PrintOption } from './assemblyIndex'
export { PRINT_OPTIONS, buildAssemblyIndex, printOption } from './assemblyIndex'

export type { BillLine, BillOfTiles, DownloadSize, DownloadVerdict, FilenameCollision } from './bill'
export { DOWNLOAD_HUGE_BYTES, DOWNLOAD_LARGE_BYTES, buildBillOfTiles, downloadSize } from './bill'

export { footprintKey, footprintsMatch } from './footprint'

export type { BillNote, Note, NoteCode } from './notes'
export { NOTE_SEVERITY, rollUpNotes } from './notes'

export type {
  AssemblyOptions,
  AssemblyPart,
  BaseMatch,
  MatchedBase,
  PartRole,
  PlacementVerdict,
  ResolvedPlacement,
  VariantResolution,
} from './resolve'
/**
 * `matchBase` and `missingBaseNote` are rule 1's two halves, exported together
 * and for one reason: row A6's rule 0 resolves an item to a file *before* a base
 * is considered, so `resolvePlacement` no longer observes either. A topper whose
 * item has a one-part print in the chosen lock gets no base and no warning —
 * correctly — which makes "what base would this topper get?" and "why does this
 * topper have none?" questions the resolver can no longer be asked. They are
 * corpus facts that `docs/corpus-base-gap.md` and every D1/D4/D5 guard rest on.
 *
 * Neither adds a part. Rule 1 — every `connection|openforge` piece gets a base
 * line item — is still enforced in exactly one place, and that is
 * `resolvePlacement`.
 */
export {
  MATCH_WEIGHTS,
  matchBase,
  missingBaseNote,
  resolvePlacement,
  resolveVariant,
  selectVariantForLock,
} from './resolve'

export { SIZE_CODE_WIDTH_UNITS, sizeCodeWidth } from './sizeCode'
