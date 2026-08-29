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
  selectLockSystem,
  selectPlacement,
  selectPlacementCount,
  selectPlacements,
  setLockSystem,
  toggleLibrary,
  useIsInLibrary,
  useLibrary,
  useLibraryCount,
  useLockSystem,
  usePlacement,
  usePlacementCount,
  usePlacements,
  useWorkshopStore,
} from './workshopStore'

export type { ImportResult } from './transfer'
export { WORKSHOP_EXPORT_KIND, WorkshopExport, exportWorkshop, importWorkshop } from './transfer'
