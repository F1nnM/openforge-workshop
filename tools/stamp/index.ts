/**
 * Row X4's public surface: one stamp across the index, the LOD store, the
 * thumbnail set, the share manifest and W1's measurement sidecar.
 *
 * Read `run.ts` first — it is the CI step, and the order the checks run in is
 * the design. `lock.ts` is the derivation-versus-check rule made enforceable,
 * `corpus.ts` is the md5 join that detects churn, and `report.ts` holds the
 * severity policy and the three renderings.
 */
export type { Args } from './args'
export { ARTEFACT_IDS, USAGE, parseArgs } from './args'

export type { ArtefactFile, ArtefactStamp } from './artefacts'
export {
  ARTEFACT_PATHS,
  SUPPORTED_MANIFEST_VERSIONS,
  UPLOAD_MANIFEST_NAME,
  formatStamp,
  liveBlobs,
  readMeasureSidecar,
  readUploadManifest,
  stampDifference,
  stampOf,
} from './artefacts'

export type { CorpusDigest, CorpusDrift } from './corpus'
export { corpusDigest, corpusDrift, isClean } from './corpus'

export type { DerivationDigests, LockCheck } from './lock'
export {
  DerivationLock,
  FIXTURES_ENV_PATH,
  LOCK_FIXTURES_REF,
  LOCK_PATH,
  checkLock,
  derivationDigests,
  lockFor,
  lockedBuild,
  pinnedFixturesRef,
  readLock,
  writeLock,
} from './lock'

export type {
  ArtefactId,
  ArtefactReport,
  ArtefactStatus,
  JoinedArtefact,
  LockReport,
  ShareReport,
  StampReport,
} from './report'
export {
  STAMP_VERSION,
  failuresOf,
  formatReport,
  indexCorpus,
  isBadStatus,
  markdownSummary,
  reportFor,
  serialiseStamp,
  serialiseWorklist,
  statusFor,
  titleOf,
} from './report'

export type { StampOptions, StampRun } from './run'
export { ARTEFACT_BLOCKERS, DEFAULT_REQUIRED, runStamp, shareReport } from './run'
