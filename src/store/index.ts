/**
 * The persisted client state's public surface.
 *
 * Import from `@/store`, not from `@/store/workshopStore`, so the module can be
 * split later without touching the workstreams that read it — the builder, the
 * assembly resolver, the mesh warmer and the share-link codec.
 *
 * Nothing here reads the network or the catalog file. The store holds ids; the
 * records they name are looked up by the caller.
 *
 * **{@link TemplateInstance} is the one contract change a reader of this barrel
 * has to know about**, and it is the epic's single serialisation point. A
 * placement is no longer a design on a cell: it is a template family, a
 * rotation, and a fill per named slot, each fill naming an exact file and
 * carrying whether the user chose it. `schema.ts` has the argument; every row
 * that renders, resolves, prices or shares a placement imports the type from
 * here.
 *
 * **The library is gone**, field and all — no `library`, no `addToLibrary`, no
 * `useIsInLibrary`, no `libraryDesigns`. Row A0 deleted the screen and every
 * reader; row A1 deleted the state. Templates are the only placement unit.
 *
 * **Three stores, not one.** `workshopStore.ts` is the persisted one;
 * `selection.ts` is the un-persisted selection channel row G5 added; `meshes.ts`
 * is the un-persisted generated-mesh holdings row X9 added. The splits are the
 * point rather than an accident of file layout — see each docblock. All three are
 * re-exported here so a caller still imports from `@/store` and never has to know
 * which of them a name came from.
 *
 * The `meshes.ts` split is the same argument as `selection.ts`'s, made about a
 * different kind of value: a generated base's **recipe** is durable and lives in
 * `WorkshopState`, and its **mesh** is 0.5–2.4 MB that must not reach
 * `localStorage` and is not meaningful across engine builds anyway. So a reload
 * brings back the base and not its bytes, which row S5 already modelled as a
 * `warn` bill row and a refused download rather than as an error.
 */
export {
  DEFAULT_LOCK_SYSTEM,
  LockSystem,
  PlacementId,
  Rotation,
  SlotFill,
  SlotName,
  TemplateId,
  TemplateInstance,
  WorkshopState,
  defaultWorkshopState,
  filledSlots,
  normalizeRotation,
} from './schema'

export type { RecoveredState } from './migrations'
export { STORE_VERSION, readPersistedState, salvageWorkshopState } from './migrations'

export { STORAGE_KEY, clearPersistedWorkshopState, requestPersistentStorage } from './storage'

export type { ClearOutcome, FillOutcome, NewTemplateInstance, UnpinOutcome } from './workshopStore'
export {
  acknowledgeLockSystem,
  clearFill,
  clearPlacements,
  fillSlot,
  moveGeneratedPlacement,
  movePlacement,
  pinFill,
  placeGeneratedBase,
  placeTemplate,
  removeGeneratedPlacement,
  removePlacement,
  resetWorkshop,
  rotateGeneratedPlacement,
  rotatePlacement,
  selectGeneratedPlacements,
  selectLockChosen,
  selectLockSystem,
  selectPlacement,
  selectPlacementCount,
  selectPlacements,
  selectRoomDesign,
  setLockSystem,
  setRoomDesign,
  unpinFill,
  useGeneratedPlacements,
  useLockChosen,
  useLockSystem,
  usePlacement,
  usePlacementCount,
  usePlacements,
  useRoomDesign,
  useWorkshopStore,
} from './workshopStore'

export type { GeneratedMeshState } from './meshes'
export {
  clearGeneratedMeshes,
  holdGeneratedMesh,
  meshFactsOf,
  retainGeneratedMeshes,
  useGeneratedHoldings,
  useGeneratedMeshStore,
  useGeneratedMeshes,
} from './meshes'

export type { PendingArm, SelectionState } from './selection'
export {
  armTemplateInBuilder,
  claimPendingArm,
  clearPendingArm,
  selectPendingArm,
  usePendingArm,
  useSelectionStore,
} from './selection'

export type { ImportResult } from './transfer'
export { WORKSHOP_EXPORT_KIND, WorkshopExport, exportWorkshop, importWorkshop } from './transfer'
