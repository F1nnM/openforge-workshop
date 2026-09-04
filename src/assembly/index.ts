/**
 * Assembly resolution's public surface.
 *
 * Import from `@/assembly`, not from the modules beneath it. The whole surface
 * is three functions over an index and a context:
 *
 * ```ts
 * const index = buildAssemblyIndex(catalog)          // once per catalog build
 * const ctx   = { templates, composition, lock }     // AssemblyContext
 * const one   = resolveInstance(instance, index, ctx)
 * const bill  = buildBillOfTiles(Object.values(scene), index, ctx)
 * ```
 *
 * ## What row A3 removed from this list
 *
 * `resolvePlacement` and `resolveVariant` are gone, and so is the two-step they
 * described. A placement used to name a `DesignId`, so *"which file of the placed
 * item does this build want"* (rule 0) and *"which base goes under it"* (rule 1)
 * were both questions this module answered on the user's behalf. A template
 * instance names a template and its slots name **files**, so neither question
 * exists at resolution time: {@link resolveInstance} looks up what the scene
 * already says and reports what is missing or wrong.
 *
 * Two names survived the deletion because they were never about placements:
 *
 *   - {@link selectVariantForLock} — rule 0's ranking, over an aggregate rather
 *     than a placement. Five call sites outside this directory ask it, and row
 *     C2's fill solver is the sixth: a candidate grid is an *item* grid, and the
 *     file is picked from the item afterwards.
 *   - {@link matchBase} and {@link rankBases} — rule 1's *ranking*, without rule
 *     1. The auto-insert is gone; the ladder that chose between candidate bases
 *     is the default-fill C2 needs for a `base` slot, and it is exported for the
 *     way `src/ui/lock-picker/build.ts` already used it. `baseMatch.ts` carries
 *     the argument and the corpus figures.
 *
 * {@link baseGap} replaced `missingBaseNote`, and the change of return type is
 * the point: the archive's base gap is still a fact worth asserting — 86 / 31 /
 * 260 over 4,363 toppers, identical under every lock preference — but it is no
 * longer a `Note`, because no bill can emit one now that nothing inserts a base.
 *
 * Pure throughout — no React, no DOM, no fetch, no renderer, and no state of its
 * own. {@link buildAssemblyIndex} is a deterministic function of the catalog, so
 * a caller may memoise it on the catalog's version stamp and never think about
 * it again; the same contract holds for `@/composition`'s index, which
 * {@link AssemblyContext} asks the caller to supply for that reason.
 *
 * `PrintOption` is re-exported for a reason worth stating: `BaseRanking.option`
 * is of that type and `BaseRanking` is part of this surface, so without the name
 * here a consumer could hold the value and not be able to declare it.
 */
export type { AssemblyIndex, AssemblyIndexStats, PrintOption } from './assemblyIndex'
export { PRINT_OPTIONS, buildAssemblyIndex, printOption } from './assemblyIndex'

export type {
  BillLine,
  BillOfTiles,
  BillSlotRef,
  DownloadSize,
  DownloadVerdict,
  FilenameCollision,
  UnfilledSlot,
} from './bill'
export { DOWNLOAD_HUGE_BYTES, DOWNLOAD_LARGE_BYTES, buildBillOfTiles, downloadSize } from './bill'

export { footprintKey } from './footprint'

export type { BillNote, Note, NoteCode, NoteSubject } from './notes'
export { NOTE_SEVERITY, rollUpNotes } from './notes'

export type {
  AssemblyContext,
  AssemblyPart,
  AssemblySlot,
  AssemblyTemplate,
  ResolvedInstance,
  ResolvedSlotFill,
  TemplateLookup,
} from './resolve'
export { resolveInstance, selectVariantForLock } from './resolve'

/**
 * The base ranking, exported without the rule it used to serve.
 *
 * Row A3 deleted the auto-insert and kept the choice: something must
 * default-fill a `base` slot, and that default is exactly this ladder. Row C2
 * owns the fill solver and takes {@link rankBases} — the ranking over a
 * candidate set `@/composition` produced. {@link matchBase} keeps its pre-A3
 * signature for `src/ui/lock-picker/build.ts`, whose question is about the
 * archive rather than about a scene, and {@link baseGap} answers the other half
 * of it: which of the three ways the archive holds no base for a topper.
 *
 * **Neither adds a part.** A base reaches a bill as a filled slot and nothing
 * else, so there is no second implementation of "this instance needs a base".
 */
export type { BaseGap, BaseMatch, BaseRanking, MatchedBase } from './baseMatch'
export { MATCH_WEIGHTS, baseGap, matchBase, rankBases } from './baseMatch'
