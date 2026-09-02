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
 * **Two stores, not one.** `workshopStore.ts` is the persisted one; `selection.ts`
 * is the un-persisted selection channel row G5 added, and the split is the point
 * rather than an accident of file layout — see its docblock. Both are re-exported
 * here so a caller still imports from `@/store` and never has to know which of
 * the two a name came from.
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
  movePlacement,
  placeTile,
  removeFromLibrary,
  removePlacement,
  resetWorkshop,
  rotatePlacement,
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
