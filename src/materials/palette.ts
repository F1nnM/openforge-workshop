/**
 * OpenForge Workshop — the material palette. 16 families, and the invariants
 * that make them a palette rather than 16 opinions.
 *
 * `docs/texture-materials.draft.ts` stays in place as the design artefact of
 * record. Its hues, its material responses and its reasoning are what is below;
 * its lightness and chroma values were **re-solved here**, because the port
 * measured the draft's palette 0.136 ΔE00 short of its own 9.0 dichromacy
 * target and the shortfall stood as a documented exception instead of being
 * closed. See `PALETTE_INVARIANTS` for the re-solve: what bound it, what moved,
 * and by how little.
 *
 * The solve is constrained simulated annealing maximising the minimum CIEDE2000
 * distance across all 120 family pairs, evaluated simultaneously under normal
 * vision and Machado-2009 protanopia, deuteranopia and tritanopia, subject to
 * the hard constraints in `PALETTE_INVARIANTS`. `palette.test.ts` re-derives
 * every scalar below from the hex literals — nothing here is a number you have
 * to take on trust.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * The STLs are colourless. Every blueprint carries one or more `texture|…` tags
 * naming the real-world surface its sculpt represents, and architecture-plan.md
 * §9 turns those into an appearance: a base colour, a PBR response, and a
 * surface-detail recipe. The mapping is hardcoded, **not user-facing**, has no
 * settings UI, and drives the plan-view fills in v1 and the 3D materials in
 * v1.1 from one table.
 *
 * ── How the numbers were chosen ─────────────────────────────────────────────
 * Hue is a semantic anchor, taken from measured dielectric albedo and the
 * Munsell/GSA Geological Rock-Color Chart's hue families, so a cave still reads
 * as rock and a brick still reads as fired clay.
 *
 * Lightness and chroma are **not** physical, and that is the central decision.
 * Measured stone albedos sit 1.5–9 ΔE00 apart — below the 50% just-noticeable
 * difference for a 25 px mark — so physical correctness would render cut stone,
 * dungeon stone, rough stone and cave identically and defeat the entire
 * feature. Separation was optimised instead, inside the hard constraints in
 * `PALETTE_INVARIANTS`.
 *
 * ── Two rules that came out of measurement ──────────────────────────────────
 * - **Silhouette is carried by a contour, not the fill** (`edge`). Meeting WCAG
 *   1.4.11's 3:1 against the parchment well with fills alone would force every
 *   material below L* 50, destroying plaster, sandstone and ice.
 * - **Wear changes roughness, never colour.** Darkening and desaturating for
 *   `ruined` / `eroded` was implemented and measured, then rejected: at a
 *   visible delta a worn `cut_stone` lands 5.17 ΔE00 from base `plain` and only
 *   5.04 from its own parent — it stops belonging to either — and at a delta
 *   small enough to stop that, it is 1.39 ΔE00 from its parent, i.e. invisible.
 *   See `applyWear` in `resolve.ts`, whose docblock still quotes the pre-P2
 *   figures (4.06 / 1.09) for the same conclusion.
 *
 * ── No renderer, by requirement ─────────────────────────────────────────────
 * Nothing in `src/materials/` imports three.js, and there is no TSL here. §4
 * withdrew node materials: `WebGLNodesHandler` documents that *"instanced mesh
 * geometry cannot be shared"*, which is exactly the builder's rendering
 * strategy, and it imports from `three/webgpu` — 425 KB gz against 129 KB, more
 * JavaScript than the entire catalog payload. So this module is plain data plus
 * a resolver, consumable by a 2D canvas fill, a `MeshStandardMaterial`, or the
 * build-time sprite renderer.
 */

/* ------------------------------------------------------------------ identity */

/**
 * The 16 families. This union is closed on purpose: a 17th family costs a
 * re-run of the separation solve, because adding one colour to a set optimised
 * for maximum minimum distance moves every other member's headroom.
 */
export type MaterialId =
  | 'dungeon_stone'
  | 'cut_stone'
  | 'plain'
  | 'rough_stone'
  | 'wood'
  | 'stucco'
  | 'aztlan'
  | 'sandstone'
  | 'cave'
  | 'brick'
  | 'sewer'
  | 'necro'
  | 'water'
  | 'metal'
  | 'ice'
  | 'unknown'

/* --------------------------------------------------------------- surface spec */

/** Object-space fBm applied to albedo and roughness. Needs no UVs. */
export interface GrainSpec {
  /** Noise frequency, in tile units (1 unit = one 1×1 OpenForge tile). */
  readonly scale: number
  /** Peak multiplicative deviation applied to the base colour. */
  readonly amplitude: number
}

/** Worley cell mask used to draw mortar joints on ashlar and brick. */
export interface MortarSpec {
  readonly scale: number
  /** Joint half-width in cell units. */
  readonly width: number
  /** How far the joint darkens the base colour, 0–1. */
  readonly darken: number
}

/**
 * Phong triple for `stl-thumb -m <ambient> <diffuse> <specular>`, which renders
 * the pre-baked sprite sheets. Derived from the measured response of the live
 * bucket sprites: output = ambient + 0.525 × diffuse, verified to three decimal
 * places against the shipped default material on real sheets.
 *
 * Every triple below is that relation solved for the family's own `tint`, so a
 * retuned palette retints the sprites too: `diffuse` is the tint scaled by
 * 0.75 / 0.525 and clamped to 8-bit, `ambient` is whatever is left over
 * (`tint − 0.525 × diffuse`) so the two still sum back to the albedo even where
 * the diffuse term clipped. `palette.test.ts` re-derives all sixteen.
 *
 * **These triples are live, not deferred.** Every sheet in the bucket is
 * rendered in `stl-thumb`'s default **blue** Phong material (ambient `#002142`,
 * diffuse peaking `#3375c8`; 99.8% of opaque pixels are non-neutral), and row
 * P1 tints that away in the browser rather than accepting it: `materials/tint.ts`
 * un-mixes the blue render's two terms and re-mixes them with the triple below,
 * which composes to one `feColorMatrix` per family. Applied to the blue pixel at
 * `s = 0.525` that matrix returns each family's own `tint` hex to within 0.475 of
 * one 8-bit level — so a retuned palette retints the grid as well as the sprites,
 * and `tint.test.ts` asserts it for all sixteen.
 *
 * So the blue does not kill CSS-tinting. It kills *greyscaling and then*
 * tinting, which is a different claim. Every opaque sheet pixel is
 * `ambient + s·diffuse + k·specular` with a **white** specular: fitting that
 * two-term model over 2,105,442 decoded pixels leaves a mean absolute residual of
 * 1.417/255, against 10.531/255 for the one-term model of blue times a scalar,
 * because 95.8% of pixels carry `k > 0.02`. Any single greyscale is therefore a
 * fixed mixture of the two terms — Rec.709 luma weights the achromatic sheen
 * 2.3403× the form — so one scalar cannot separate them and two, un-mixed
 * exactly, can.
 *
 * And leaving the blue was never the neutral option. The sixteen albedos sit a
 * mean **31.88** ΔE00 from the corpus-median sprite pixel against **18.34** from
 * a luminance-matched neutral, with `water` the nearest family at **14.82** while
 * `dungeon_stone` is **16.41** away — 1.59 apart, far inside the 9.0 the palette
 * needs to tell two families apart at all. A dungeon-stone tile drawn in sheet
 * blue reads as the pool.
 *
 * An offline coloured re-render — `resolve.ts`'s `spriteArgsFor` — would use
 * these same triples, and is now an optimisation rather than the only route to
 * a coloured grid.
 */
export interface SpriteMaterial {
  readonly ambient: string
  readonly diffuse: string
  readonly specular: string
}

export type SurfaceTreatment = 'flat' | 'noise' | 'noise+mortar'
export type ContourStyle = 'solid' | 'dashed'
export type Confidence = 'high' | 'medium' | 'low'

/**
 * One material family.
 *
 * The derived scalars (`cielab`, `luminance`, `contrastVsWell`, `deltaEVsWell`)
 * are cached measurements, not inputs. They are stated so a reviewer can see
 * them without running anything, and `palette.test.ts` re-derives each one from
 * `tint` and fails on any drift — so they cannot rot into decoration.
 */
export interface MaterialFamily {
  readonly id: MaterialId
  readonly label: string
  /** Base colour, sRGB. This is an ALBEDO, not a rendered pixel value. */
  readonly tint: string
  /** [L, C, H] — the authoring space. Edit these, not the hex. */
  readonly oklch: readonly [number, number, number]
  /** [L*, C*, h] CIELAB D65, for reference against the Munsell anchors. */
  readonly cielab: readonly [number, number, number]
  /** WCAG relative luminance of `tint`. */
  readonly luminance: number
  /** WCAG contrast of `tint` against the viewport well floor `--bg3`. */
  readonly contrastVsWell: number
  /** CIEDE2000 distance from `--bg3`; the palette floor is 12.0. */
  readonly deltaEVsWell: number
  /** Silhouette contour colour. Carries the 3:1 obligation the fill cannot. */
  readonly edge: string
  readonly contour: ContourStyle
  readonly roughness: number
  readonly metalness: number
  readonly transmission: number
  readonly ior: number
  readonly surface: SurfaceTreatment
  readonly grain: GrainSpec | null
  readonly mortar: MortarSpec | null
  readonly sprite: SpriteMaterial
  /** Live blueprints resolving to this family, measured over the real index. */
  readonly liveBlueprints: number
  readonly confidence: Confidence
  readonly note: string
}

/* ------------------------------------------------------------------ the table */

export const MATERIALS: Readonly<Record<MaterialId, MaterialFamily>> = {
  dungeon_stone: {
    id: 'dungeon_stone',
    label: 'Dungeon stone',
    tint: '#6b7280',
    oklch: [0.551, 0.023, 264.4],
    cielab: [47.9, 8.6, 273.3],
    luminance: 0.1672,
    contrastVsWell: 3.23,
    deltaEVsWell: 35.6,
    edge: '#393d46',
    contour: 'solid',
    roughness: 0.92,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 1.8, amplitude: 0.1 },
    mortar: null,
    sprite: { ambient: '#1b1c20', diffuse: '#99a3b7', specular: '#6b6357' },
    liveBlueprints: 3082,
    confidence: 'high',
    note: 'Rough dressed masonry, the catalog core set. Cool blue-grey (Munsell 5B 5/1 medium bluish gray) to hold it off the parchment hue axis.',
  },
  cut_stone: {
    id: 'cut_stone',
    label: 'Cut stone',
    tint: '#918e85',
    oklch: [0.646, 0.014, 93.3],
    cielab: [59.0, 5.2, 96.3],
    luminance: 0.2706,
    contrastVsWell: 2.19,
    deltaEVsWell: 20.7,
    edge: '#3f3d37',
    contour: 'solid',
    roughness: 0.72,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise+mortar',
    grain: { scale: 3.0, amplitude: 0.05 },
    mortar: { scale: 2.2, width: 0.06, darken: 0.32 },
    sprite: { ambient: '#242321', diffuse: '#cfcbbe', specular: '#6b6357' },
    liveBlueprints: 1425,
    confidence: 'high',
    note: 'Worked ashlar with mortar joints. Warm-neutral light olive grey (5Y 6/1); the Worley mask draws the joints the tint cannot.',
  },
  plain: {
    id: 'plain',
    label: 'Plain / bare',
    tint: '#76736d',
    oklch: [0.557, 0.01, 89.7],
    cielab: [48.5, 3.7, 90.2],
    luminance: 0.1722,
    contrastVsWell: 3.16,
    deltaEVsWell: 30.3,
    edge: '#3e3d39',
    contour: 'solid',
    roughness: 0.9,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#1d1d1b', diffuse: '#a9a49c', specular: '#6b6357' },
    liveBlueprints: 1235,
    confidence: 'high',
    note: 'Base plates and risers — "no surface sculpt", not a material. Deliberately untextured and near-neutral; it asserts nothing.',
  },
  rough_stone: {
    id: 'rough_stone',
    label: 'Rough stone',
    tint: '#655c4c',
    oklch: [0.479, 0.027, 82.1],
    cielab: [39.5, 10.6, 86.0],
    luminance: 0.1094,
    contrastVsWell: 4.4,
    deltaEVsWell: 38.7,
    edge: '#3e382e',
    contour: 'solid',
    roughness: 0.97,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 1.2, amplitude: 0.16 },
    mortar: null,
    sprite: { ambient: '#191713', diffuse: '#90836d', specular: '#6b6357' },
    liveBlueprints: 721,
    confidence: 'high',
    note: 'Undressed rubble, cobble and mortared footings. Brown-grey (5YR 6/1 light brownish gray), darker than cut stone.',
  },
  wood: {
    id: 'wood',
    label: 'Timber',
    tint: '#54362d',
    oklch: [0.367, 0.046, 38.2],
    cielab: [25.9, 16.5, 42.4],
    luminance: 0.0471,
    contrastVsWell: 7.22,
    deltaEVsWell: 57.4,
    edge: '#332019',
    contour: 'solid',
    roughness: 0.78,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 0.6, amplitude: 0.12 },
    mortar: null,
    sprite: { ambient: '#150e0b', diffuse: '#784d40', specular: '#6b6357' },
    liveBlueprints: 446,
    confidence: 'high',
    note: 'Stained and weathered timber, planking, shingles. Dark red-brown — the light end of real timber albedo is unusable on parchment.',
  },
  stucco: {
    id: 'stucco',
    label: 'Stucco / plaster',
    tint: '#8d9da3',
    oklch: [0.686, 0.02, 223.1],
    cielab: [63.7, 6.7, 229.1],
    luminance: 0.3242,
    contrastVsWell: 1.87,
    deltaEVsWell: 23.1,
    edge: '#353f43',
    contour: 'solid',
    roughness: 0.88,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 3.2, amplitude: 0.06 },
    mortar: null,
    sprite: { ambient: '#232729', diffuse: '#c9e0e9', specular: '#6b6357' },
    liveBlueprints: 428,
    confidence: 'medium',
    note: 'Limewash and rendered plaster. Deliberately COOL: a warm plaster at its true value is invisible on parchment.',
  },
  aztlan: {
    id: 'aztlan',
    label: 'Aztlan tuff',
    tint: '#aa8164',
    oklch: [0.637, 0.065, 56.8],
    cielab: [57.2, 24.9, 61.4],
    luminance: 0.2517,
    contrastVsWell: 2.32,
    deltaEVsWell: 24.1,
    edge: '#503725',
    contour: 'solid',
    roughness: 0.82,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 2.2, amplitude: 0.08 },
    mortar: null,
    sprite: { ambient: '#2a2019', diffuse: '#f3b88f', specular: '#6b6357' },
    liveBlueprints: 326,
    confidence: 'medium',
    note: 'Carved Mesoamerican temple stone. Warm red-ochre volcanic tuff; motif sub-levels (mosaic, calendar, trim) inherit it.',
  },
  sandstone: {
    id: 'sandstone',
    label: 'Sandstone',
    tint: '#b9a66c',
    oklch: [0.728, 0.08, 91.9],
    cielab: [68.5, 32.6, 92.4],
    luminance: 0.3867,
    contrastVsWell: 1.61,
    deltaEVsWell: 14.0,
    edge: '#483c17',
    contour: 'solid',
    roughness: 0.9,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 1.4, amplitude: 0.14 },
    mortar: null,
    sprite: { ambient: '#332a1b', diffuse: '#ffed9a', specular: '#6b6357' },
    liveBlueprints: 257,
    confidence: 'high',
    note: 'Bedded sandstone. Warm ochre; the one place a genuinely chromatic warm reads as measurement, not decoration.',
  },
  cave: {
    id: 'cave',
    label: 'Cave rock',
    tint: '#4a526e',
    oklch: [0.443, 0.048, 272.2],
    cielab: [35.2, 17.6, 283.5],
    luminance: 0.0862,
    contrastVsWell: 5.15,
    deltaEVsWell: 50.6,
    edge: '#2c3244',
    contour: 'solid',
    roughness: 0.98,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 0.9, amplitude: 0.18 },
    mortar: null,
    sprite: { ambient: '#12151c', diffuse: '#6a759d', specular: '#6b6357' },
    liveBlueprints: 224,
    confidence: 'high',
    note: 'Damp natural rock and hewn mine passage. Dark blue-violet (5PB 3/2 dusky blue) — the darkest of the rock entries.',
  },
  brick: {
    id: 'brick',
    label: 'Fired brick',
    tint: '#7b4427',
    oklch: [0.447, 0.086, 47.4],
    cielab: [35.0, 34.6, 52.8],
    luminance: 0.0849,
    contrastVsWell: 5.2,
    deltaEVsWell: 46.8,
    edge: '#4c2916',
    contour: 'solid',
    roughness: 0.86,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise+mortar',
    grain: { scale: 2.6, amplitude: 0.07 },
    mortar: { scale: 2.6, width: 0.07, darken: 0.28 },
    sprite: { ambient: '#1f110a', diffuse: '#b06138', specular: '#6b6357' },
    liveBlueprints: 196,
    confidence: 'high',
    note: 'Fired clay (10R 4/6 moderate reddish brown), close to the measured brick albedo 0.262/0.095/0.061 linear.',
  },
  sewer: {
    id: 'sewer',
    label: 'Sewer stone',
    tint: '#817438',
    oklch: [0.557, 0.081, 97.2],
    cielab: [48.8, 34.7, 95.3],
    luminance: 0.1744,
    contrastVsWell: 3.12,
    deltaEVsWell: 30.1,
    edge: '#453d17',
    contour: 'solid',
    roughness: 0.8,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise+mortar',
    grain: { scale: 1.5, amplitude: 0.13 },
    mortar: { scale: 2.0, width: 0.05, darken: 0.24 },
    sprite: { ambient: '#201d0e', diffuse: '#b8a650', specular: '#6b6357' },
    liveBlueprints: 101,
    confidence: 'medium',
    note: 'Algal olive-green over sewer masonry. Held at hue 97 to stay clear of the reserved verdigris band (139–175).',
  },
  necro: {
    id: 'necro',
    label: 'Ossuary / bone',
    tint: '#a7ad94',
    oklch: [0.735, 0.035, 117.9],
    cielab: [69.6, 13.8, 118.6],
    luminance: 0.4024,
    contrastVsWell: 1.55,
    deltaEVsWell: 13.5,
    edge: '#3c3f30',
    contour: 'solid',
    roughness: 0.85,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 2.0, amplitude: 0.09 },
    mortar: null,
    sprite: { ambient: '#2a2b25', diffuse: '#eff7d3', specular: '#6b6357' },
    liveBlueprints: 92,
    confidence: 'low',
    note: 'A theme, not a substance. Pallid green-grey bone is an authored aesthetic call for the necromancer sets.',
  },
  water: {
    id: 'water',
    label: 'Water',
    tint: '#4e8ea6',
    oklch: [0.612, 0.075, 224.6],
    cielab: [55.8, 23.4, 234.3],
    luminance: 0.2372,
    contrastVsWell: 2.44,
    deltaEVsWell: 35.3,
    edge: '#194352',
    contour: 'solid',
    roughness: 0.15,
    metalness: 0.0,
    transmission: 0.6,
    ior: 1.33,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#14232a', diffuse: '#6fcbed', specular: '#6b6357' },
    liveBlueprints: 82,
    confidence: 'medium',
    note: 'Pool surfaces. The material response (low roughness, transmission) carries more of the read than the albedo does.',
  },
  metal: {
    id: 'metal',
    label: 'Iron',
    tint: '#2e2e34',
    oklch: [0.304, 0.01, 289.0],
    cielab: [19.2, 4.1, 291.2],
    luminance: 0.0278,
    contrastVsWell: 9.01,
    deltaEVsWell: 66.7,
    edge: '#1a1a1d',
    contour: 'solid',
    roughness: 0.55,
    metalness: 0.85,
    transmission: 0.0,
    ior: 1.5,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#0b0b0d', diffuse: '#42424a', specular: '#6b6357' },
    liveBlueprints: 75,
    confidence: 'high',
    note: 'Wrought iron: grates, portcullises, bell metal, torch sconces. Also the target of the untextured part-tag fallback.',
  },
  ice: {
    id: 'ice',
    label: 'Ice',
    tint: '#a3d0e3',
    oklch: [0.831, 0.054, 225.7],
    cielab: [81.0, 17.6, 233.9],
    luminance: 0.5844,
    contrastVsWell: 1.11,
    deltaEVsWell: 24.7,
    edge: '#26414c',
    contour: 'solid',
    roughness: 0.22,
    metalness: 0.0,
    transmission: 0.75,
    ior: 1.31,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#294a5d', diffuse: '#e9ffff', specular: '#6b6357' },
    liveBlueprints: 8,
    confidence: 'medium',
    note: 'Cracked ice. The only entry above L* 70; it survives there on hue distance from the parchment, not on value.',
  },
  unknown: {
    id: 'unknown',
    label: 'Unclassified',
    tint: '#4d4d4d',
    oklch: [0.42, 0.0, 89.9],
    cielab: [32.7, 0.0, 142.5],
    luminance: 0.0742,
    contrastVsWell: 5.64,
    deltaEVsWell: 47.9,
    edge: '#2e2e2e',
    contour: 'dashed',
    roughness: 0.9,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#131313', diffuse: '#6e6e6e', specular: '#6b6357' },
    liveBlueprints: 4,
    confidence: 'low',
    note: 'No data. The only chroma-zero entry in the system and the only dashed contour: absence of colour means absence of a claim. It must read as unclassified, not as a wrong guess.',
  },
}

/** Stable display order, dominant families first. Used by legends and the facet list. */
export const MATERIAL_ORDER: readonly MaterialId[] = [
  'dungeon_stone',
  'cut_stone',
  'plain',
  'rough_stone',
  'wood',
  'stucco',
  'aztlan',
  'sandstone',
  'cave',
  'brick',
  'sewer',
  'necro',
  'water',
  'metal',
  'ice',
  'unknown',
]

/* ------------------------------------------------------------------ invariants */

/**
 * The palette's hard constraints. Asserted by `palette.test.ts`, never read at
 * runtime — a floor that the code silently enforces is a floor nobody can see.
 *
 * ── The re-solve, and what it cost ──────────────────────────────────────────
 * The ported palette measured **8.864 ΔE00** under deuteranopia
 * (`cut_stone`/`necro`), 0.136 short of its own 9.0 target, while clearing 9.0
 * under normal vision (9.211), protanopia (9.041) and tritanopia (9.043). Every
 * other figure in the draft reproduced exactly, so the shortfall was not port
 * drift: the draft was solved against Machado-2009 applied to *gamma-encoded*
 * sRGB, and this registry measures it in **linear** sRGB, the space the paper
 * derives the matrices in. Applying the gamma convention reproduces the draft's
 * limiting pair (`wood`/`brick`, protanopia) but at 8.576 — further from 9.0,
 * not closer. So the shipped colours sat at an optimum of the wrong objective,
 * which is exactly why there was headroom to recover.
 *
 * Re-solved against the linear-light instrument, with CIEDE2000 validated
 * against all 34 Sharma test vectors:
 *
 *   normal ……………… 9.934  (plain / rough_stone)  — was 9.211
 *   protanopia ……… 9.787  (rough_stone / brick)  — was 9.041
 *   deuteranopia … 9.807  (plain / rough_stone)  — was 8.864
 *   tritanopia ……… 9.900  (rough_stone / sewer)  — was 9.043
 *
 * The 9.0 target is met on all four axes with 0.78 ΔE00 to spare, so
 * `minPairwiseUnderCvd` is now the target rather than an exception to it.
 *
 * ── Why the colours barely moved ────────────────────────────────────────────
 * The search was capped so that **no family's albedo moves more than 1.5 ΔE00**
 * from the draft's value. 1.5 is the low end of the 1.5–9 ΔE00 spread this
 * file's own header measures between real stone albedos and calls sub-JND for a
 * 25 px mark: a move inside that bound is invisible by the palette's own
 * instrument. Three of the sixteen tints — `dungeon_stone`, `cave`, `ice` — are
 * byte-identical to the draft's, the worst move of the other thirteen is
 * 1.49 ΔE00, and no CIELAB hue moves more than 3.2° except `plain`, which moves
 * 9.3° at C* 3.7 — a hue rotation on a colour that has essentially no hue, and
 * whose whole brief is to assert nothing. `palette.test.ts` states the draft's
 * sixteen tints and checks both bounds, so neither claim is just prose.
 *
 * `dungeon_stone` is pinned outright: 3,082 live blueprints, the anchor of the
 * cool-grey axis, and `src/three/material.test.ts` asserts its hex.
 *
 * That cap is what binds the result: at 1.5 ΔE00 the search tops out at 9.787,
 * and every family that could still gain is pressed against it. Lifting it
 * entirely reaches about 10.4 ΔE00, where `brick` and `sewer` are instead
 * pressed against the 0.086 chroma ceiling and the hue windows bind — but at a
 * 10.0 target five families already exceed the sub-JND bound and the worst move
 * is 2.0 ΔE00. Separation the palette does not need is not worth repainting
 * anchors that came from measurement.
 *
 * ── Everything the solve had to honour ──────────────────────────────────────
 * The floors and ceilings below, all of them, plus:
 *
 *   - hue windows of ±10° in OKLCH per family — under a third of a Munsell hue
 *     family, so `cave` stays 5PB and `brick` stays 10R;
 *   - `dungeon_stone` pinned, and `unknown` chroma-zero (it is the only such
 *     entry, and the only dashed contour: absence of colour is the claim);
 *   - `plain` and `metal` held below chroma 0.03, because "near-neutral" is
 *     their brief and not an accident of the last solve;
 *   - `ice` alone above CIELAB L* 70, `metal` alone below OKLCH L 0.36 — the
 *     latter is what makes the `min()` in `contourOklch` load-bearing;
 *   - `cave` the darkest rock entry;
 *   - every `tint` and every `edge` inside the sRGB gamut without clamping, so
 *     the OKLCH column stays an honest description of the hex beside it.
 *
 * `palette.test.ts` pins all four measured minima and their limiting pairs,
 * which is a far tighter clamp on hex drift than a `≥ 9.0` inequality would be.
 */
export const PALETTE_INVARIANTS = {
  /**
   * Parchment surfaces a tile is seen against: `--bg`, `--bg2`, `--bg3`,
   * `--chip`. Stated here as literals so this module stays dependency-free;
   * `palette.test.ts` asserts they are exactly the `@/tokens` values, so a
   * token edit cannot leave the palette judged against a ground that no longer
   * exists.
   */
  grounds: ['#e7dcc4', '#f1e8d3', '#dfd2b5', '#d8caab'] as readonly string[],
  /** UI accents a material must never be mistaken for: `--acc`, `--acc2`. */
  accents: ['#8f5b21', '#5d7a68'] as readonly string[],
  /** The viewport well floor a tile is normally seen on — `--bg3`. */
  well: '#dfd2b5',
  /** Minimum pairwise CIEDE2000 under normal vision. Measured: 9.934. */
  minPairwise: 9.0,
  /**
   * Minimum pairwise CIEDE2000 under each dichromacy. Measured worst: 9.787
   * (protanopia, `rough_stone`/`brick`). This is the design target, met — see
   * the note above for the re-solve that closed the 0.136 ΔE00 gap.
   */
  minPairwiseUnderCvd: 9.0,
  /** Minimum CIEDE2000 from every ground token. Measured: 12.06 (sandstone vs `--chip`). */
  minToGround: 12.0,
  /** Minimum CIEDE2000 from every UI accent. Measured: 11.16 (brick vs `--acc`). */
  minToAccent: 10.0,
  /** `--acc` sits at OKLCH chroma 0.099; nothing sculpted may out-saturate it. */
  maxChroma: 0.086,
  /** `--acc2` verdigris hue band. No material with chroma > 0.02 may enter it. */
  reservedHue: [139, 175] as readonly [number, number],
  /**
   * Contour floor against the parchment, per WCAG 1.4.11. Measured: 7.13
   * against the well `--bg3` (`water`, the lightest contour), and 6.59 against
   * `--chip`, the darkest ground any tile is drawn on. Both more than double
   * the obligation, which is the headroom that lets the *fills* stay light
   * enough for plaster, sandstone and ice to exist.
   */
  minEdgeContrast: 3.0,
} as const
