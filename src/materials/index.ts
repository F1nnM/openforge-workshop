/**
 * The material registry's public surface.
 *
 * Import from `@/materials`, never from `@/materials/resolve` or
 * `@/materials/palette`, so the module can be reorganised without touching the
 * canvas, the catalog screen and the detail drawer at once.
 *
 * Nothing here imports a renderer, by requirement: architecture-plan.md §4
 * withdrew TSL node materials, so the registry is plain data plus a resolver
 * and is consumed identically by the v1 plan-view canvas (2D fills) and a later
 * `MeshStandardMaterial`.
 */
export type {
  Confidence,
  ContourStyle,
  GrainSpec,
  MaterialFamily,
  MaterialId,
  MortarSpec,
  SpriteMaterial,
  SurfaceTreatment,
} from './palette'
export { MATERIALS, MATERIAL_ORDER, PALETTE_INVARIANTS } from './palette'

export type { FinishOverride } from './mapping'
export {
  DEFAULT_ROOT_PRECEDENCE,
  FILENAME_HINTS,
  FINISH_OVERRIDES,
  PART_FALLBACK,
  ROOT_PRECEDENCE,
  TAG_CONFIDENCE,
  TEXTURE_ROOT_MATERIAL,
  TEXTURE_TAG_MATERIAL,
  WEAR_EXACT,
  WEAR_PREFIXES,
} from './mapping'

export type { Resolution, ResolutionPath, ResolvedFinish } from './resolve'
export {
  applyWear,
  contourFor,
  isWearTag,
  materialFor,
  resolveMaterial,
  spriteArgsFor,
  tintFor,
} from './resolve'

export type { Lab, LinearRgb, Rgb, VisionModel } from './color'
export {
  VISION_MODELS,
  contourOklch,
  contrastRatio,
  deltaE2000,
  deltaE2000Hex,
  deltaE2000UnderVision,
  formatHex,
  hexToLab,
  hexUnderVision,
  labUnderVision,
  linearRgbToLab,
  linearToSrgb,
  oklchToHex,
  parseHex,
  relativeLuminance,
  srgbToLinear,
} from './color'
