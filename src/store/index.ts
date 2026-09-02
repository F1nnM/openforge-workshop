/**
 * The persisted client state's public surface.
 *
 * Import from `@/store`, not from `@/store/workshopStore`, so the module can be
 * split later without touching the four workstreams that read it — the catalog's
 * "add to library" action, the library screen, the builder, and the share-link
 * codec.
 *
 * Nothing here reads the network or the catalog file. The store holds ids; the
 * records they name are looked up by the caller.
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
  Placement,
  PlacementId,
  WorkshopState,
  defaultWorkshopState,
  normalizeRotation,
} from './schema'

export type { MigrationStep, RecoveredState } from './migrations'
export { MIGRATION_STEPS, STORE_VERSION, migrateWorkshopState, salvageWorkshopState } from './migrations'

export { STORAGE_KEY, clearPersistedWorkshopState, requestPersistentStorage } from './storage'

export {
  acknowledgeLockSystem,
  addToLibrary,
  clearLibrary,
  clearPlacements,
  moveGeneratedPlacement,
  movePlacement,
  placeGeneratedBase,
  placeTile,
  removeFromLibrary,
  removeGeneratedPlacement,
  removePlacement,
  resetWorkshop,
  rotateGeneratedPlacement,
  rotatePlacement,
  selectGeneratedPlacements,
  selectIsInLibrary,
  selectLibrary,
  selectLibraryCount,
  selectLockChosen,
  selectLockSystem,
  selectPlacement,
  selectPlacementCount,
  selectPlacements,
  setLockSystem,
  toggleLibrary,
  useGeneratedPlacements,
  useIsInLibrary,
  useLibrary,
  useLibraryCount,
  useLockChosen,
  useLockSystem,
  usePlacement,
  usePlacementCount,
  usePlacements,
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

export type { SelectionState } from './selection'
export {
  claimPendingTile,
  clearPendingTile,
  selectPendingTile,
  sendTileToBuilder,
  usePendingTile,
  useSelectionStore,
} from './selection'

export type { ImportResult } from './transfer'
export { WORKSHOP_EXPORT_KIND, WorkshopExport, exportWorkshop, importWorkshop } from './transfer'
