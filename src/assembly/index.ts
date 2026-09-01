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
 * ```
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

export type { AssemblyOptions, AssemblyPart, BaseMatch, PartRole, ResolvedPlacement } from './resolve'
export { MATCH_WEIGHTS, resolvePlacement } from './resolve'

export { SIZE_CODE_WIDTH_UNITS, sizeCodeWidth } from './sizeCode'
