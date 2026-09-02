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
 * const which = resolveVariant(tileId, index, { lock })  // rule 0, on its own
 * ```
 *
 * Row A6 added the fourth line and a step above the other three: a placement
 * names a file, and the lock preference decides **which file of that item** to
 * print before any base is considered. `resolvePlacement`'s `tile` is therefore
 * the resolved record, and `ResolvedPlacement.resolution` says what was chosen
 * and how complete an assembly it is.
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
export { MATCH_WEIGHTS, matchBase, missingBaseNote, resolvePlacement, resolveVariant } from './resolve'

export { SIZE_CODE_WIDTH_UNITS, sizeCodeWidth } from './sizeCode'
