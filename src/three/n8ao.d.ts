/**
 * Types for `n8ao` 2.0.1, which ships JavaScript and JSDoc but no `.d.ts`.
 *
 * Declared narrowly on purpose: only the members this app touches, so a change
 * in the upstream shape surfaces here as a compile error rather than as an `any`
 * that silently accepts a renamed configuration key. The JSDoc block on
 * `N8AOPostPass`'s constructor in `dist/N8AO.js` is the source for every field
 * below, including the defaults quoted in `Stage.tsx`.
 *
 * `N8AOPostPass` — not `N8AOPass` — is the variant built for the
 * `postprocessing` package's `EffectComposer`, which is the composer §4 pins.
 */
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three'
  import { Pass } from 'postprocessing'

  export interface N8AOConfiguration {
    aoSamples: number
    aoRadius: number
    denoiseSamples: number
    denoiseRadius: number
    distanceFalloff: number
    intensity: number
    denoiseIterations: number
    renderMode: 0 | 1 | 2 | 3 | 4
    color: Color
    gammaCorrection: boolean
    screenSpaceRadius: boolean
    halfRes: boolean
    depthAwareUpsampling: boolean
    colorMultiply: boolean
    transparencyAware: boolean
    accumulate: boolean
  }

  export type N8AOQuality = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    readonly configuration: N8AOConfiguration
    setQualityMode(mode: N8AOQuality): void
    setSize(width: number, height: number): void
    override dispose(): void
  }
}
