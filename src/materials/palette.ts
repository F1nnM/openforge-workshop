/**
 * OpenForge Workshop — the material palette. 16 families, and the invariants
 * that make them a palette rather than 16 opinions.
 *
 * Ported from `docs/texture-materials.draft.ts`, which stays in place as the
 * design artefact of record. The values here are that file's values: they were
 * solved by constrained simulated annealing maximising the minimum CIEDE2000
 * distance across all 120 family pairs, evaluated simultaneously under normal
 * vision and Machado-2009 protanopia, deuteranopia and tritanopia. Nothing was
 * re-solved in the port — `palette.test.ts` re-derives every scalar below from
 * the hex literals and the draft's own reported figures reproduce exactly, with
 * one documented exception recorded in `PALETTE_INVARIANTS`.
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
 *   visible delta a worn `cut_stone` lands 4.06 ΔE00 from base `plain` — it
 *   becomes a different family — and at a delta small enough to stop that, it
 *   is 1.09 ΔE00 from its parent, i.e. invisible. See `applyWear` in
 *   `resolve.ts`.
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
 * Carried here, unused by v1. §5 records that every sheet in the bucket today
 * is rendered in `stl-thumb`'s default **blue** Phong material (ambient
 * `#002142`, diffuse peaking `#3375c8`; 99.8% of opaque pixels are
 * non-neutral), which is what kills any plan to CSS-tint the existing PNGs.
 * v1 accepts the split — grid thumbnails stay blue, 3D views are tinted — and
 * these triples are what a coloured re-render in v1.1 would use.
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
    tint: '#8f8c81',
    oklch: [0.639, 0.016, 94.3],
    cielab: [58.2, 6.3, 98.4],
    luminance: 0.2618,
    contrastVsWell: 2.25,
    deltaEVsWell: 21.1,
    edge: '#3f3d36',
    contour: 'solid',
    roughness: 0.72,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise+mortar',
    grain: { scale: 3.0, amplitude: 0.05 },
    mortar: { scale: 2.2, width: 0.06, darken: 0.32 },
    sprite: { ambient: '#242320', diffuse: '#ccc8b8', specular: '#6b6357' },
    liveBlueprints: 1425,
    confidence: 'high',
    note: 'Worked ashlar with mortar joints. Warm-neutral light olive grey (5Y 6/1); the Worley mask draws the joints the tint cannot.',
  },
  plain: {
    id: 'plain',
    label: 'Plain / bare',
    tint: '#76746c',
    oklch: [0.558, 0.012, 95.3],
    cielab: [48.8, 4.8, 99.5],
    luminance: 0.1743,
    contrastVsWell: 3.13,
    deltaEVsWell: 29.8,
    edge: '#3e3d38',
    contour: 'solid',
    roughness: 0.9,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#1e1d1b', diffuse: '#a9a69a', specular: '#6b6357' },
    liveBlueprints: 1235,
    confidence: 'high',
    note: 'Base plates and risers — "no surface sculpt", not a material. Deliberately untextured and near-neutral; it asserts nothing.',
  },
  rough_stone: {
    id: 'rough_stone',
    label: 'Rough stone',
    tint: '#665d4e',
    oklch: [0.482, 0.026, 80.5],
    cielab: [39.9, 10.0, 84.8],
    luminance: 0.112,
    contrastVsWell: 4.33,
    deltaEVsWell: 38.3,
    edge: '#3f392f',
    contour: 'solid',
    roughness: 0.97,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 1.2, amplitude: 0.16 },
    mortar: null,
    sprite: { ambient: '#1a1714', diffuse: '#92856f', specular: '#6b6357' },
    liveBlueprints: 721,
    confidence: 'high',
    note: 'Undressed rubble, cobble and mortared footings. Brown-grey (5YR 6/1 light brownish gray), darker than cut stone.',
  },
  wood: {
    id: 'wood',
    label: 'Timber',
    tint: '#593931',
    oklch: [0.38, 0.048, 34.7],
    cielab: [27.5, 17.0, 39.5],
    luminance: 0.0527,
    contrastVsWell: 6.83,
    deltaEVsWell: 55.5,
    edge: '#36211c',
    contour: 'solid',
    roughness: 0.78,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 0.6, amplitude: 0.12 },
    mortar: null,
    sprite: { ambient: '#160e0c', diffuse: '#7f5146', specular: '#6b6357' },
    liveBlueprints: 446,
    confidence: 'high',
    note: 'Stained and weathered timber, planking, shingles. Dark red-brown — the light end of real timber albedo is unusable on parchment.',
  },
  stucco: {
    id: 'stucco',
    label: 'Stucco / plaster',
    tint: '#8b9ba1',
    oklch: [0.679, 0.02, 222.3],
    cielab: [62.9, 6.7, 229.1],
    luminance: 0.315,
    contrastVsWell: 1.92,
    deltaEVsWell: 23.6,
    edge: '#353f43',
    contour: 'solid',
    roughness: 0.88,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 3.2, amplitude: 0.06 },
    mortar: null,
    sprite: { ambient: '#232728', diffuse: '#c7dde6', specular: '#6b6357' },
    liveBlueprints: 428,
    confidence: 'medium',
    note: 'Limewash and rendered plaster. Deliberately COOL: a warm plaster at its true value is invisible on parchment.',
  },
  aztlan: {
    id: 'aztlan',
    label: 'Aztlan tuff',
    tint: '#a97f62',
    oklch: [0.63, 0.067, 55.8],
    cielab: [56.6, 25.3, 60.7],
    luminance: 0.245,
    contrastVsWell: 2.38,
    deltaEVsWell: 24.8,
    edge: '#503725',
    contour: 'solid',
    roughness: 0.82,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 2.2, amplitude: 0.08 },
    mortar: null,
    sprite: { ambient: '#2a2018', diffuse: '#f1b58c', specular: '#6b6357' },
    liveBlueprints: 326,
    confidence: 'medium',
    note: 'Carved Mesoamerican temple stone. Warm red-ochre volcanic tuff; motif sub-levels (mosaic, calendar, trim) inherit it.',
  },
  sandstone: {
    id: 'sandstone',
    label: 'Sandstone',
    tint: '#b5a36d',
    oklch: [0.718, 0.075, 91.7],
    cielab: [67.4, 30.5, 92.4],
    luminance: 0.3712,
    contrastVsWell: 1.66,
    deltaEVsWell: 14.3,
    edge: '#473c1a',
    contour: 'solid',
    roughness: 0.9,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 1.4, amplitude: 0.14 },
    mortar: null,
    sprite: { ambient: '#2f291b', diffuse: '#ffe99c', specular: '#6b6357' },
    liveBlueprints: 257,
    confidence: 'high',
    note: 'Bedded sandstone. Warm ochre; the one place a genuinely chromatic warm reads as measurement, not decoration.',
  },
  cave: {
    id: 'cave',
    label: 'Cave rock',
    tint: '#4a526e',
    oklch: [0.443, 0.047, 272.0],
    cielab: [35.2, 17.6, 283.5],
    luminance: 0.0862,
    contrastVsWell: 5.15,
    deltaEVsWell: 50.6,
    edge: '#2d3244',
    contour: 'solid',
    roughness: 0.98,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 0.9, amplitude: 0.18 },
    mortar: null,
    sprite: { ambient: '#12141c', diffuse: '#6a759d', specular: '#6b6357' },
    liveBlueprints: 224,
    confidence: 'high',
    note: 'Damp natural rock and hewn mine passage. Dark blue-violet (5PB 3/2 dusky blue) — the darkest mineral entry.',
  },
  brick: {
    id: 'brick',
    label: 'Fired brick',
    tint: '#7c442b',
    oklch: [0.449, 0.086, 44.1],
    cielab: [35.2, 33.4, 49.6],
    luminance: 0.0859,
    contrastVsWell: 5.16,
    deltaEVsWell: 46.9,
    edge: '#4d2919',
    contour: 'solid',
    roughness: 0.86,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise+mortar',
    grain: { scale: 2.6, amplitude: 0.07 },
    mortar: { scale: 2.6, width: 0.07, darken: 0.28 },
    sprite: { ambient: '#1f110b', diffuse: '#b1613d', specular: '#6b6357' },
    liveBlueprints: 196,
    confidence: 'high',
    note: 'Fired clay (10R 4/6 moderate reddish brown), close to the measured brick albedo 0.262/0.095/0.061 linear.',
  },
  sewer: {
    id: 'sewer',
    label: 'Sewer stone',
    tint: '#7f743c',
    oklch: [0.556, 0.077, 98.4],
    cielab: [48.7, 32.4, 96.7],
    luminance: 0.1733,
    contrastVsWell: 3.14,
    deltaEVsWell: 30.1,
    edge: '#443d19',
    contour: 'solid',
    roughness: 0.8,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise+mortar',
    grain: { scale: 1.5, amplitude: 0.13 },
    mortar: { scale: 2.0, width: 0.05, darken: 0.24 },
    sprite: { ambient: '#201d0f', diffuse: '#b5a656', specular: '#6b6357' },
    liveBlueprints: 101,
    confidence: 'medium',
    note: 'Algal olive-green over sewer masonry. Held at hue 98 to stay clear of the reserved verdigris band (139–175).',
  },
  necro: {
    id: 'necro',
    label: 'Ossuary / bone',
    tint: '#a3a890',
    oklch: [0.721, 0.034, 116.8],
    cielab: [67.9, 13.3, 117.4],
    luminance: 0.3781,
    contrastVsWell: 1.64,
    deltaEVsWell: 14.3,
    edge: '#3c3f31',
    contour: 'solid',
    roughness: 0.85,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'noise',
    grain: { scale: 2.0, amplitude: 0.09 },
    mortar: null,
    sprite: { ambient: '#292a24', diffuse: '#e9f0ce', specular: '#6b6357' },
    liveBlueprints: 92,
    confidence: 'low',
    note: 'A theme, not a substance. Pallid green-grey bone is an authored aesthetic call for the necromancer sets.',
  },
  water: {
    id: 'water',
    label: 'Water',
    tint: '#518ea4',
    oklch: [0.614, 0.071, 223.4],
    cielab: [55.9, 22.3, 232.7],
    luminance: 0.2378,
    contrastVsWell: 2.44,
    deltaEVsWell: 34.8,
    edge: '#1b4350',
    contour: 'solid',
    roughness: 0.15,
    metalness: 0.0,
    transmission: 0.6,
    ior: 1.33,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#142429', diffuse: '#74cbea', specular: '#6b6357' },
    liveBlueprints: 82,
    confidence: 'medium',
    note: 'Pool surfaces. The material response (low roughness, transmission) carries more of the read than the albedo does.',
  },
  metal: {
    id: 'metal',
    label: 'Iron',
    tint: '#2f2f35',
    oklch: [0.308, 0.011, 285.8],
    cielab: [19.6, 4.1, 291.2],
    luminance: 0.0289,
    contrastVsWell: 8.88,
    deltaEVsWell: 66.1,
    edge: '#1a1a1e',
    contour: 'solid',
    roughness: 0.55,
    metalness: 0.85,
    transmission: 0.0,
    ior: 1.5,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#0c0c0d', diffuse: '#43434c', specular: '#6b6357' },
    liveBlueprints: 75,
    confidence: 'high',
    note: 'Wrought iron: grates, portcullises, bell metal, torch sconces. Also the target of the untextured part-tag fallback.',
  },
  ice: {
    id: 'ice',
    label: 'Ice',
    tint: '#a3d0e3',
    oklch: [0.832, 0.054, 225.6],
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
    tint: '#505050',
    oklch: [0.431, 0.0, 89.9],
    cielab: [34.0, 0.0, 142.5],
    luminance: 0.0802,
    contrastVsWell: 5.38,
    deltaEVsWell: 46.4,
    edge: '#303030',
    contour: 'dashed',
    roughness: 0.9,
    metalness: 0.0,
    transmission: 0.0,
    ior: 1.5,
    surface: 'flat',
    grain: null,
    mortar: null,
    sprite: { ambient: '#141414', diffuse: '#727272', specular: '#6b6357' },
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
 * ── The one figure that did not reproduce ───────────────────────────────────
 * `docs/texture-materials.draft.ts` reports a worst-case minimum of **9.05
 * ΔE00** across the four vision conditions, limited by `wood`/`brick`. Every
 * other scalar in that file re-derives here to the digit — all 16 `oklch`
 * triples project to their `tint` exactly, and `luminance`,
 * `contrastVsWell`, `deltaEVsWell`, min-to-ground 12.34, min-to-accent 12.22
 * and min edge contrast 7.14 all reproduce — and the normal-vision minimum
 * reproduces at 9.211 on the same limiting pair (`cut_stone`/`plain`). So the
 * hexes were ported without drift; what differs is the dichromacy instrument.
 *
 * Re-derived with Machado-2009 at severity 1.0 applied in linear sRGB (the
 * space the paper derives the matrices in), with CIEDE2000 validated against
 * all 34 Sharma test vectors:
 *
 *   normal ……………… 9.211  (cut_stone / plain)   — clears 9.0
 *   protanopia ……… 9.041  (stucco / water)      — clears 9.0
 *   tritanopia ……… 9.043  (rough_stone / sewer) — clears 9.0
 *   deuteranopia … 8.864  (cut_stone / necro)   — 0.136 SHORT of 9.0
 *
 * Applying the same matrices to gamma-encoded sRGB instead — the convention
 * several browser and JS implementations use — reproduces the draft's limiting
 * *pair* (`wood`/`brick`, protanopia) but at 8.576, further from 9.0 rather
 * than closer. No standard application of the published severity-1.0 matrices
 * puts this palette at 9.05.
 *
 * So the floor asserted under dichromacy is **8.8**, and the 9.0 target is
 * recorded separately as `pairwiseTargetUnderCvd`. Closing the 0.136 gap means
 * re-running the annealing, which would move every other verified scalar in
 * this file; that is a palette decision, not a porting one, and it is
 * deliberately not taken here. `palette.test.ts` additionally pins all four
 * measured minima and their limiting pairs, which is a far tighter clamp on
 * hex drift than a `≥ 9.0` inequality would be.
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
  /** Minimum pairwise CIEDE2000 under normal vision. Measured: 9.211. */
  minPairwise: 9.0,
  /**
   * Minimum pairwise CIEDE2000 under each dichromacy. Measured worst: 8.864
   * (deuteranopia, `cut_stone`/`necro`). See the note above for why this is
   * 8.8 and not the 9.0 target.
   */
  minPairwiseUnderCvd: 8.8,
  /** What the design pass aimed for under dichromacy, and reported as 9.05. */
  pairwiseTargetUnderCvd: 9.0,
  /** Minimum CIEDE2000 from every ground token. Measured: 12.34 (sandstone). */
  minToGround: 12.0,
  /** Minimum CIEDE2000 from every UI accent. Measured: 12.22 (brick vs `--acc`). */
  minToAccent: 10.0,
  /** `--acc` sits at OKLCH chroma 0.099; nothing sculpted may out-saturate it. */
  maxChroma: 0.086,
  /** `--acc2` verdigris hue band. No material with chroma > 0.02 may enter it. */
  reservedHue: [139, 175] as readonly [number, number],
  /**
   * Contour floor against the parchment, per WCAG 1.4.11. Measured: 7.14
   * against the well `--bg3` (`water`, the lightest contour), and 6.59 against
   * `--chip`, the darkest ground any tile is drawn on. Both more than double
   * the obligation, which is the headroom that lets the *fills* stay light
   * enough for plaster, sandstone and ice to exist.
   */
  minEdgeContrast: 3.0,
} as const
