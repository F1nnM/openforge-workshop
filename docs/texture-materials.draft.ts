/**
 * OpenForge Workshop — texture-tag → material mapping.
 *
 * DESIGN ARTEFACT (`.draft.ts`): this file is the agreed mapping, written as
 * finished code so it can be moved into `src/` unchanged. The code is complete;
 * only its location is provisional.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * Every blueprint carries one or more `texture|…` tags naming the real-world
 * surface its sculpt represents. This module turns those tags into a material:
 * a base colour, a PBR response, and a surface-detail recipe. The mapping lives
 * in code. It is not user-facing, not customisable, and has no settings UI.
 *
 * It has NO dependencies — not even three.js. It emits plain descriptors, so
 * the same table drives the live 3D views, the offline sprite renderer, the
 * catalog CSS, and the palette CI test.
 *
 * ── How the numbers were chosen ─────────────────────────────────────────────
 * Hue is a semantic anchor, taken from measured dielectric albedo and the
 * Munsell/GSA Geological Rock-Color Chart's hue families, so a cave still reads
 * as rock and a brick still reads as fired clay.
 *
 * Lightness and chroma are NOT physical. Measured stone albedos sit 1.5–9 ΔE00
 * apart — below the 50 % JND for a 25 px mark — so physical correctness would
 * deliver no separation at all. They were solved instead by constrained search
 * that maximises the minimum CIEDE2000 distance between every pair of families,
 * evaluated simultaneously under normal vision and the three dichromacies,
 * subject to the hard constraints in `PALETTE_INVARIANTS` below.
 *
 * Measured result for the 16 entries here (120 pairs):
 *   • min pairwise ΔE00, worst of 4 vision conditions … 9.05  (wood / brick)
 *   • min pairwise ΔE00, normal vision …………………………………… 9.21  (cut_stone / plain)
 *   • median pairwise ΔE00, normal vision ………………………… 25.1
 *   • min ΔE00 to any Parchment ground token ………………… 12.34
 *   • min ΔE00 to either UI accent ……………………………………… 12.22
 *   • max OKLCH chroma …………………………………………………………………… 0.086  (--acc is 0.099)
 * For comparison, the 6-entry dark-theme map in the design mock measures a min
 * pairwise ΔE00 of 5.42 with every entry inside a 15° hue band that the
 * parchment ground itself occupies (CIELAB h 70–85° vs --bg at h 90.7°).
 *
 * ── Silhouette ──────────────────────────────────────────────────────────────
 * On a light ground, WCAG 1.4.11's 3:1 requirement would force every material
 * below L* 50, which would make plaster, sandstone and ice into wrong guesses.
 * So the 3:1 obligation is carried by a dedicated dark contour (`edge`), not by
 * the fill. Every `edge` measures ≥ 7.14:1 against `--bg3` and ≥ 8.76:1 against
 * `--bg2`, and every one is darker than its own fill.
 *
 * ── Wear is not a colour ────────────────────────────────────────────────────
 * `ruined` / `eroded` / `broken_stucco` / `ruined_stucco` are a wear axis, and
 * the obvious treatment — darken and desaturate the parent — was measured and
 * rejected: at a visible delta (L×0.93, C×0.86 → 4.1 ΔE00 from its parent) a
 * worn `cut_stone` lands 4.06 ΔE00 from base `plain`, i.e. it becomes a
 * different family. Shrinking the delta until that stops (L×0.98) leaves it
 * 1.09 ΔE00 from its parent — invisible. So wear moves ROUGHNESS and GRAIN
 * only, and never the albedo. See `applyWear`.
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

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
  | 'unknown';

/** Object-space fBm applied to albedo and roughness. Needs no UVs. */
export interface GrainSpec {
  /** Noise frequency, in tile units (1 unit = one 1×1 OpenForge tile). */
  readonly scale: number;
  /** Peak multiplicative deviation applied to the base colour. */
  readonly amplitude: number;
}

/** Worley cell mask used to draw mortar joints on ashlar and brick. */
export interface MortarSpec {
  readonly scale: number;
  /** Joint half-width in cell units. */
  readonly width: number;
  /** How far the joint darkens the base colour, 0–1. */
  readonly darken: number;
}

/**
 * Phong triple for `stl-thumb -m <ambient> <diffuse> <specular>`, which renders
 * the pre-baked sprite sheets. Derived from the measured response of the live
 * bucket sprites: output = ambient + 0.525 × diffuse (verified to three decimal
 * places against the shipped default material on real sheets).
 */
export interface SpriteMaterial {
  readonly ambient: string;
  readonly diffuse: string;
  readonly specular: string;
}

export type SurfaceTreatment = 'flat' | 'noise' | 'noise+mortar';
export type ContourStyle = 'solid' | 'dashed';
export type Confidence = 'high' | 'medium' | 'low';

export interface MaterialFamily {
  readonly id: MaterialId;
  readonly label: string;
  /** Base colour, sRGB. This is an ALBEDO, not a rendered pixel value. */
  readonly tint: string;
  /** [L, C, H] — the authoring space. Edit these, not the hex. */
  readonly oklch: readonly [number, number, number];
  /** [L*, C*, h] CIELAB D65, for reference against the Munsell anchors. */
  readonly cielab: readonly [number, number, number];
  /** WCAG relative luminance of `tint`. */
  readonly luminance: number;
  /** WCAG contrast of `tint` against the viewport well floor `--bg3`. */
  readonly contrastVsWell: number;
  /** CIEDE2000 distance from `--bg3`; the palette floor is 12.0. */
  readonly deltaEVsWell: number;
  /** Silhouette contour colour. Carries the 3:1 obligation the fill cannot. */
  readonly edge: string;
  readonly contour: ContourStyle;
  readonly roughness: number;
  readonly metalness: number;
  readonly transmission: number;
  readonly ior: number;
  readonly surface: SurfaceTreatment;
  readonly grain: GrainSpec | null;
  readonly mortar: MortarSpec | null;
  readonly sprite: SpriteMaterial;
  /** Live blueprints resolving to this family, measured over the real index. */
  readonly liveBlueprints: number;
  readonly confidence: Confidence;
  readonly note: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The palette                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

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
    note:
      'Rough dressed masonry, the catalog core set. Cool blue-grey (Munsell 5B 5/1 medium bluish gray) to hold it off the parchment hue axis.',
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
    note:
      'Worked ashlar with mortar joints. Warm-neutral light olive grey (5Y 6/1); the Worley mask draws the joints the tint cannot.',
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
    note:
      'Base plates and risers - "no surface sculpt", not a material. Deliberately untextured and near-neutral; it asserts nothing.',
  },
  rough_stone: {
    id: 'rough_stone',
    label: 'Rough stone',
    tint: '#665d4e',
    oklch: [0.482, 0.026, 80.5],
    cielab: [39.9, 10.0, 84.8],
    luminance: 0.1120,
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
    note:
      'Undressed rubble, cobble and mortared footings. Brown-grey (5YR 6/1 light brownish gray), darker than cut stone.',
  },
  wood: {
    id: 'wood',
    label: 'Timber',
    tint: '#593931',
    oklch: [0.380, 0.048, 34.7],
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
    note:
      'Stained and weathered timber, planking, shingles. Dark red-brown - the light end of real timber albedo is unusable on parchment.',
  },
  stucco: {
    id: 'stucco',
    label: 'Stucco / plaster',
    tint: '#8b9ba1',
    oklch: [0.679, 0.020, 222.3],
    cielab: [62.9, 6.7, 229.1],
    luminance: 0.3150,
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
    note:
      'Limewash and rendered plaster. Deliberately COOL: a warm plaster at its true value is invisible on parchment.',
  },
  aztlan: {
    id: 'aztlan',
    label: 'Aztlan tuff',
    tint: '#a97f62',
    oklch: [0.630, 0.067, 55.8],
    cielab: [56.6, 25.3, 60.7],
    luminance: 0.2450,
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
    note:
      'Carved Mesoamerican temple stone. Warm red-ochre volcanic tuff; motif sub-levels (mosaic, calendar, trim) inherit it.',
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
    note:
      'Bedded sandstone. Warm ochre; the one place a genuinely chromatic warm reads as measurement, not decoration.',
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
    note:
      'Damp natural rock and hewn mine passage. Dark blue-violet (5PB 3/2 dusky blue) - the darkest mineral entry.',
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
    note:
      'Fired clay (10R 4/6 moderate reddish brown), close to the measured brick albedo 0.262/0.095/0.061 linear.',
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
    note:
      'Algal olive-green over sewer masonry. Held at hue 98 to stay clear of the reserved verdigris band (139-175).',
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
    note:
      'A theme, not a substance. Pallid green-grey bone is an authored aesthetic call for the necromancer sets.',
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
    note:
      'Pool surfaces. The material response (low roughness, transmission) carries more of the read than the albedo does.',
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
    note:
      'Wrought iron: grates, portcullises, bell metal, torch sconces. Also the target of the untextured part-tag fallback.',
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
    note:
      'Cracked ice. The only entry above L* 70; it survives there on hue distance from the parchment, not on value.',
  },
  unknown: {
    id: 'unknown',
    label: 'Unclassified',
    tint: '#505050',
    oklch: [0.431, 0.000, 89.9],
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
    note:
      'No data. The only chroma-zero entry in the system and the only dashed contour: absence of colour means absence of a claim.',
  },
};

export const MATERIAL_ORDER: readonly MaterialId[] = [
  'dungeon_stone', 'cut_stone', 'plain', 'rough_stone', 'wood', 'stucco',
  'aztlan', 'sandstone', 'cave', 'brick', 'sewer', 'necro', 'water', 'metal',
  'ice', 'unknown',
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Palette invariants — asserted by the CI test, not used at runtime          */
/* ────────────────────────────────────────────────────────────────────────── */

export const PALETTE_INVARIANTS = {
  /** Parchment surfaces a tile is seen against. */
  grounds: ['#e7dcc4', '#f1e8d3', '#dfd2b5', '#d8caab'] as readonly string[],
  /** UI accents a material must never be mistaken for. */
  accents: ['#8f5b21', '#5d7a68'] as readonly string[],
  /** Floors, all CIEDE2000. */
  minPairwise: 9.0,
  minPairwiseUnderCvd: 9.0,
  minToGround: 12.0,
  minToAccent: 10.0,
  /** `--acc` sits at OKLCH chroma 0.099; nothing sculpted may out-saturate it. */
  maxChroma: 0.086,
  /** `--acc2` verdigris hue band. No material with chroma > 0.02 may enter it. */
  reservedHue: [139, 175] as readonly [number, number],
  /** Contour floor against the well, per WCAG 1.4.11. */
  minEdgeContrast: 3.0,
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Tag → material                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Level-1 roots. All 38 that exist in the catalog are mapped, so root lookup
 * never fails for a known tag. Counts are live blueprints carrying the tag,
 * measured over the 8,702-row index.
 *
 * `%` and `+` in a filename both produce deeper tags (`texture|a|b`), and the
 * scanner's output makes the two indistinguishable — `towne+stone` and
 * `towne%stone` both yield `texture|towne|stone`. Level 2 is therefore treated
 * uniformly as "material variant", never as "qualifier vs sub-texture".
 */
export const TEXTURE_ROOT_MATERIAL: Readonly<Record<string, MaterialId | undefined>> = {
  dungeon_stone: 'dungeon_stone',   // 3130
  plain: 'plain',                   // 1235 — bases; "no surface sculpt", not a material
  'cut-stone': 'cut_stone',         //  965
  towne: 'stucco',                  //  711 — a building SET; stucco is its dominant surface
  rough_stone: 'rough_stone',       //  537
  cave: 'cave',                     //  368
  aztlan: 'aztlan',                 //  323
  wood: 'wood',                     //  169
  brick: 'brick',                   //  161
  streets: 'rough_stone',           //  103 — a setting; sub-levels carry the material
  necro: 'necro',                   //   92
  stone_brick: 'cut_stone',         //   84 — reads as dressed ashlar, not fired clay
  shingles: 'wood',                 //   82
  pool: 'water',                    //   82
  dwarven_halls: 'cut_stone',       //   79 — precision ashlar; see FINISH_OVERRIDES
  sewer: 'sewer',                   //   72
  mine: 'cave',                     //   69 — hewn rock; its timber shoring is a separate part
  timber: 'wood',                   //   59
  stone: 'cut_stone',               //   57 — orphaned by the `%` parse; dressed is the safe default
  foundation: 'rough_stone',        //   51
  mortar_and_stone: 'rough_stone',  //   40
  cavern: 'cave',                   //   39
  ironbound_wood: 'wood',           //   35
  legacy_sewers: 'sewer',           //   29
  tudor: 'stucco',                  //   29 — half-timbered; plaster dominates the area
  stucco: 'stucco',                 //   24
  large_brick: 'brick',             //   18
  wrought_iron: 'metal',            //   15
  metal: 'metal',                   //    9
  cracked_ice: 'ice',               //    8
  goblin_fireplace: 'rough_stone',  //    5 — a named prop, not a texture
  sandstone: 'sandstone',           //    5
  foundations: 'rough_stone',       //    2 — spelling split of `foundation`
  catacombs: 'cut_stone',           //    2
  bamboo: 'wood',                   //    1
  calendar: 'aztlan',               //    1 — carved relief motif, not a substance
  mosaic: 'aztlan',                 //    1
  trim: 'aztlan',                   //    1
};

/**
 * Exact-tag overrides, for the deeper tags whose sub-level names a DIFFERENT
 * substance from its root. Anything not listed inherits its root, so cosmetic
 * sculpt variants (`|2`, `|3`, `|a`…`|d`, `|fracture`, `|xenolith`,
 * `|3-2_joint`) need no entries — they carry no colour implication.
 */
export const TEXTURE_TAG_MATERIAL: Readonly<Record<string, MaterialId | undefined>> = {
  'texture|cave|sandstone': 'sandstone',            // 247 (+ 259 qualifier carriers)
  'texture|cave|sandstone-aggregate': 'sandstone',  //   5
  'texture|cave|aggregate': 'cave',                 // 117 — conglomerate; stays cave
  'texture|cavern|volcanic': 'cave',                //  39

  'texture|towne|stone': 'cut_stone',               // 154
  'texture|towne|stucco': 'stucco',                 // 154
  'texture|towne|wood': 'wood',                     //  75
  'texture|towne|long_planks': 'wood',              //  35
  'texture|towne|broken_stucco': 'stucco',          //   4
  'texture|towne|broken_stucco-a': 'stucco',        //  43
  'texture|towne|broken_stucco-b': 'stucco',        //  43
  'texture|towne|broken_stucco-c': 'stucco',        //   1
  'texture|towne|broken_stucco-d': 'stucco',        //   1
  'texture|towne|ruined_stucco': 'stucco',          //  21
  'texture|towne|ruined_stucco-a': 'stucco',        //   1
  'texture|towne|ruined_stucco-b': 'stucco',        //   1
  // Hyphenated pairs encode a genuinely TWO-material wall (stone base course,
  // stucco above, or the reverse) in a single mesh. First-named wins: it is a
  // deterministic coin-flip on 144 models, and it is honestly wrong on ~half.
  'texture|towne|stone-stucco': 'cut_stone',        //  72
  'texture|towne|stucco-stone': 'stucco',           //  72

  'texture|streets|cobble': 'rough_stone',          //  62
  'texture|streets|fan_cobble': 'rough_stone',      //  11
  'texture|streets|brick_sidewalk': 'brick',        //  17
  'texture|streets|mud': 'rough_stone',             //  13 — no earth family; brown-grey is closest

  'texture|sewer|sewer_brick': 'sewer',             //  26 — brick by substance, sewer by context
};

/**
 * When a blueprint carries more than one texture ROOT (80 live blueprints,
 * 0.92 %), the lower precedence wins. The rare inset material is always the
 * distinguishing feature — the reason the tile exists — so it takes the tile.
 *
 * Covers every multi-root pair in the catalog:
 *   dungeon_stone + pool          (48) → water   — a pool set into a stone floor
 *   shingles + stucco             (24) → stucco  — dormer with stucco cheeks
 *   shingles + stone_brick         (8) → cut_stone
 *
 * Sorting by global tag frequency instead would get `shingles + stone_brick`
 * wrong (82 vs 84), which is why this is authored rather than derived.
 */
export const ROOT_PRECEDENCE: Readonly<Record<string, number | undefined>> = {
  pool: 10,
  stucco: 20,
  stone_brick: 20,
  shingles: 60,
  dungeon_stone: 90,
};

export const DEFAULT_ROOT_PRECEDENCE = 50;

/**
 * Finish overrides. These change the material RESPONSE for a tag without
 * spending a colour on it — the cheapest way to distinguish surfaces that are
 * the same substance at a different finish.
 */
export interface FinishOverride {
  readonly roughness?: number;
  readonly metalness?: number;
  readonly surface?: SurfaceTreatment;
  readonly grain?: GrainSpec | null;
  readonly mortar?: MortarSpec | null;
}

export const FINISH_OVERRIDES: Readonly<Record<string, FinishOverride | undefined>> = {
  // Precision dwarven ashlar: same stone, machined finish.
  'texture|dwarven_halls': { roughness: 0.55, grain: { scale: 3.6, amplitude: 0.035 } },
  // Hewn passage rock, coarser than a natural cave wall.
  'texture|mine': { roughness: 0.99, grain: { scale: 0.8, amplitude: 0.2 } },
  'texture|cavern|volcanic': { roughness: 0.99, grain: { scale: 0.7, amplitude: 0.22 } },
  // Roof shingles: wood, but courses rather than plank grain.
  'texture|shingles': { roughness: 0.9, grain: { scale: 1.0, amplitude: 0.14 } },
  'texture|ironbound_wood': { roughness: 0.72 },
  'texture|towne|long_planks': { grain: { scale: 0.4, amplitude: 0.13 } },
  // Ashlar-sized brick courses.
  'texture|stone_brick': {
    surface: 'noise+mortar',
    mortar: { scale: 1.8, width: 0.07, darken: 0.26 },
  },
  'texture|large_brick': { mortar: { scale: 1.4, width: 0.08, darken: 0.28 } },
  'texture|legacy_sewers': { roughness: 0.9 },
  // Carved relief motifs: polished against their surround.
  'texture|mosaic': { roughness: 0.7 },
  'texture|calendar': { roughness: 0.7 },
  'texture|trim': { roughness: 0.7 },
  'texture|tudor': { roughness: 0.86 },
};

/**
 * Per-tag confidence downgrades — the judgement calls that belong to the TAG
 * rather than to the family it lands in. Everything unlisted inherits its
 * family's confidence. These are the rows to argue about first.
 */
export const TAG_CONFIDENCE: Readonly<Record<string, Confidence | undefined>> = {
  'texture|stone': 'low',                  //  57 — orphaned by `%`; ambiguous dressed vs rough
  'texture|stone_brick': 'medium',         //  84 — filed as ashlar; arguably fired brick
  'texture|tudor': 'low',                  //  29 — half-timbered: two materials by definition
  'texture|shingles': 'medium',            //  82 — wood assumed; could be clay or slate
  'texture|mine': 'medium',                //  69 — hewn rock, but timber-shored
  'texture|goblin_fireplace': 'low',       //   5 — a named prop, not a texture at all
  'texture|bamboo': 'low',                 //   1 — orphaned Aztlan sub-texture
  'texture|streets|mud': 'low',            //  13 — no earth family exists; brown-grey is the nearest
  'texture|sewer|sewer_brick': 'low',      //  26 — brick by substance, sewer by context
  'texture|towne|stone-stucco': 'low',     //  72 — two materials in one mesh
  'texture|towne|stucco-stone': 'low',     //  72
  'texture|towne|stone|stucco': 'low',     //   7
  'texture|towne|stucco|stone': 'low',     //   7
};

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };

/**
 * Wear qualifiers. Detected on any component below the root; they move
 * roughness and grain, never colour. See the header for the measurement that
 * forced that.
 */
const WEAR_EXACT: ReadonlySet<string> = new Set(['ruined', 'eroded']);
const WEAR_PREFIXES: readonly string[] = ['broken_stucco', 'ruined_stucco'];

/**
 * The 89 live blueprints with no texture tag at all are not a random remainder
 * — they are the insert/accessory population: grates, torch hardware, mine
 * beams, statues, log piles, window inserts. A neutral default would render an
 * iron portcullis identically to a stone wall, so they get a part-tag chain
 * before the terminal default. Measured: this resolves 85 of the 89.
 */
export const PART_FALLBACK: readonly (readonly [string, MaterialId])[] = [
  ['part|grate', 'metal'],
  ['part|torch', 'wood'],
  ['scatter|statue', 'cut_stone'],
  ['scatter|mine|beam', 'wood'],
  ['scatter|log', 'wood'],
  ['part|support_block', 'wood'],
  ['part|window_insert', 'wood'],
];

/**
 * Filename hints, consulted before the part chain because they disambiguate
 * inside a single part tag: `part|torch` covers both the wooden torch and its
 * iron `torch_plate`, and `part|grate` covers the iron `grate.flange`.
 */
export const FILENAME_HINTS: readonly (readonly [string, MaterialId])[] = [
  ['torch_plate', 'metal'],
  ['plate', 'metal'],
  ['flange', 'metal'],
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Resolution                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export type ResolutionPath =
  | 'exact-tag'
  | 'parent-tag'
  | 'root'
  | 'filename-hint'
  | 'part-fallback'
  | 'unmapped-root'
  | 'terminal-default';

/** The material response after finish overrides and wear have been applied. */
export interface ResolvedFinish {
  readonly roughness: number;
  readonly metalness: number;
  readonly transmission: number;
  readonly ior: number;
  readonly surface: SurfaceTreatment;
  readonly grain: GrainSpec | null;
  readonly mortar: MortarSpec | null;
}

export interface Resolution {
  readonly material: MaterialId;
  readonly family: MaterialFamily;
  readonly finish: ResolvedFinish;
  readonly via: ResolutionPath;
  /** The tag the decision was actually taken on, when there was one. */
  readonly matchedTag: string | null;
  readonly worn: boolean;
  readonly confidence: Confidence;
  /**
   * Cache key. Renderers must key their material cache on this and share the
   * instance across every mesh — 8,702 models collapse to a few dozen shaders.
   */
  readonly variantKey: string;
}

const TEXTURE_PREFIX = 'texture|';

function textureTags(tags: readonly string[]): string[] {
  return tags.filter((t) => t.startsWith(TEXTURE_PREFIX));
}

function rootOf(tag: string): string {
  const parts = tag.split('|');
  return parts.length > 1 ? (parts[1] ?? '') : '';
}

function lastComponent(tag: string): string {
  const parts = tag.split('|');
  return parts[parts.length - 1] ?? '';
}

/**
 * Wear is detected on ANY component below the root, not just the last one:
 * `texture|towne|ruined_stucco|a` is worn, and its `|a` is a cosmetic sculpt
 * variant. (In practice a blueprint always carries the parent tag too — the
 * hierarchy is strict, verified: 0 orphan children across the whole index — but
 * resolving a single tag in isolation must give the same answer.)
 */
function isWearTag(tag: string): boolean {
  const parts = tag.split('|');
  for (let i = 2; i < parts.length; i += 1) {
    const c = parts[i] ?? '';
    if (WEAR_EXACT.has(c)) return true;
    if (WEAR_PREFIXES.some((p) => c.startsWith(p))) return true;
  }
  return false;
}

/**
 * Multi-root tie-break. Lowest precedence wins; ties break alphabetically so
 * the result never depends on tag order.
 */
function chooseRoot(roots: readonly string[]): string {
  const sorted = roots.slice().sort((a, b) => {
    const pa = ROOT_PRECEDENCE[a] ?? DEFAULT_ROOT_PRECEDENCE;
    const pb = ROOT_PRECEDENCE[b] ?? DEFAULT_ROOT_PRECEDENCE;
    return pa !== pb ? pa - pb : a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted[0] ?? '';
}

interface TagMatch {
  readonly material: MaterialId;
  readonly via: ResolutionPath;
  readonly matchedTag: string;
}

/**
 * Ordered fallback for one tag: exact match, then each parent in turn, then the
 * root map. Terminates at the root, which is always mapped for a known tag.
 */
function matchTag(tag: string): TagMatch | null {
  let current = tag;
  let depth = 0;
  while (current.indexOf('|') >= 0) {
    const exact = TEXTURE_TAG_MATERIAL[current];
    if (exact !== undefined) {
      return { material: exact, via: depth === 0 ? 'exact-tag' : 'parent-tag', matchedTag: current };
    }
    const parts = current.split('|');
    if (parts.length <= 2) {
      const root = TEXTURE_ROOT_MATERIAL[parts[1] ?? ''];
      return root !== undefined
        ? { material: root, via: 'root', matchedTag: current }
        : { material: 'unknown', via: 'unmapped-root', matchedTag: current };
    }
    current = parts.slice(0, -1).join('|');
    depth += 1;
  }
  return null;
}

function finishOf(family: MaterialFamily): ResolvedFinish {
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    transmission: family.transmission,
    ior: family.ior,
    surface: family.surface,
    grain: family.grain,
    mortar: family.mortar,
  };
}

function applyOverride(base: ResolvedFinish, o: FinishOverride): ResolvedFinish {
  return {
    roughness: o.roughness ?? base.roughness,
    metalness: o.metalness ?? base.metalness,
    transmission: base.transmission,
    ior: base.ior,
    surface: o.surface ?? base.surface,
    grain: o.grain !== undefined ? o.grain : base.grain,
    mortar: o.mortar !== undefined ? o.mortar : base.mortar,
  };
}

/**
 * Wear: rougher, coarser, deeper joints. Never a colour change — see header.
 */
function applyWear(base: ResolvedFinish): ResolvedFinish {
  return {
    roughness: Math.min(1, base.roughness + 0.05),
    metalness: base.metalness,
    transmission: base.transmission,
    ior: base.ior,
    surface: base.surface,
    grain: base.grain === null
      ? null
      : { scale: base.grain.scale, amplitude: Math.min(0.35, base.grain.amplitude * 1.4) },
    mortar: base.mortar === null
      ? null
      : { scale: base.mortar.scale, width: base.mortar.width, darken: Math.min(0.5, base.mortar.darken * 1.15) },
  };
}

function build(
  material: MaterialId,
  via: ResolutionPath,
  matchedTag: string | null,
  worn: boolean,
  overrideTags: readonly string[],
): Resolution {
  const family = MATERIALS[material];
  let finish = finishOf(family);
  const applied: string[] = [];
  for (const tag of overrideTags) {
    const o = FINISH_OVERRIDES[tag];
    if (o !== undefined) {
      finish = applyOverride(finish, o);
      applied.push(lastComponent(tag));
    }
  }
  if (worn) finish = applyWear(finish);

  const suffix = applied.length > 0 ? `/${applied.sort().join('+')}` : '';

  // Confidence is the WEAKEST claim involved: the family's own, anything the
  // matched tag or its siblings downgrade, and the resolution path itself.
  let confidence: Confidence = family.confidence;
  const downgrade = (c: Confidence | undefined): void => {
    if (c !== undefined && CONFIDENCE_RANK[c] < CONFIDENCE_RANK[confidence]) confidence = c;
  };
  if (matchedTag !== null) downgrade(TAG_CONFIDENCE[matchedTag]);
  for (const tag of overrideTags) downgrade(TAG_CONFIDENCE[tag]);
  if (via === 'unmapped-root' || via === 'terminal-default') downgrade('low');
  if (via === 'part-fallback' || via === 'filename-hint') downgrade('low');

  return {
    material,
    family,
    finish,
    via,
    matchedTag,
    worn,
    confidence,
    variantKey: `${material}${suffix}${worn ? '/worn' : ''}`,
  };
}

/**
 * Resolve a blueprint's tags to a material.
 *
 * Ordered fallbacks:
 *   1. exact tag match      — `texture|cave|sandstone` → sandstone
 *   2. parent tag match     — `texture|cave|sandstone|2` → `texture|cave|sandstone`
 *   3. root match           — `texture|dungeon_stone|block` → `texture|dungeon_stone`
 *   4. filename hint        — no texture tag; `…torch_plate.stl` → metal
 *   5. part-tag fallback    — no texture tag; `part|grate` → metal
 *   6. terminal default     — `unknown`
 *
 * Several texture tags on one blueprint:
 *   • Same root, several depths (3,339 blueprints) — not a conflict. One
 *     material described at several specificities: take the deepest tag and
 *     walk up until something is mapped.
 *   • Several distinct roots (80 blueprints) — pick by `ROOT_PRECEDENCE`, then
 *     resolve within that root alone.
 *   • Several level-2 siblings under one root (152 blueprints) — nearly all are
 *     base + wear (`dungeon_stone` + `block` + `ruined`). Sorting deepest-first
 *     and preferring a tag that carries an exact mapping over a wear qualifier
 *     lands on the substance, and the wear flag is set independently.
 *
 * @param tags     every tag on the blueprint, not just `texture|` ones
 * @param filename the blueprint's STL filename, used only by the hint stage
 */
export function resolveMaterial(tags: readonly string[], filename = ''): Resolution {
  const texture = textureTags(tags);

  if (texture.length === 0) {
    const lower = filename.toLowerCase();
    for (const [needle, material] of FILENAME_HINTS) {
      if (lower.includes(needle)) return build(material, 'filename-hint', null, false, []);
    }
    for (const [tag, material] of PART_FALLBACK) {
      if (tags.some((t) => t === tag || t.startsWith(`${tag}|`))) {
        return build(material, 'part-fallback', tag, false, []);
      }
    }
    return build('unknown', 'terminal-default', null, false, []);
  }

  const roots: string[] = [];
  for (const t of texture) {
    const r = rootOf(t);
    if (r !== '' && !roots.includes(r)) roots.push(r);
  }
  const root = chooseRoot(roots);
  const scoped = texture.filter((t) => rootOf(t) === root);

  const worn = scoped.some(isWearTag);

  // Deepest first; a substance-bearing tag beats a wear qualifier at equal
  // depth; alphabetical last so the result is order-independent.
  const ranked = scoped.slice().sort((a, b) => {
    const da = a.split('|').length;
    const db = b.split('|').length;
    if (da !== db) return db - da;
    const wa = isWearTag(a) ? 1 : 0;
    const wb = isWearTag(b) ? 1 : 0;
    if (wa !== wb) return wa - wb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const tag of ranked) {
    const hit = matchTag(tag);
    if (hit !== null && hit.via !== 'unmapped-root') {
      return build(hit.material, hit.via, hit.matchedTag, worn, scoped);
    }
  }
  return build('unknown', 'unmapped-root', ranked[0] ?? null, worn, scoped);
}

/** The family a blueprint renders as. */
export function materialFor(tags: readonly string[], filename = ''): MaterialFamily {
  return resolveMaterial(tags, filename).family;
}

/** The base colour a blueprint renders as, sRGB hex. */
export function tintFor(tags: readonly string[], filename = ''): string {
  return resolveMaterial(tags, filename).family.tint;
}

/** The silhouette contour colour, and whether it is dashed (unclassified). */
export function contourFor(
  tags: readonly string[],
  filename = '',
): { readonly color: string; readonly style: ContourStyle } {
  const family = resolveMaterial(tags, filename).family;
  return { color: family.edge, style: family.contour };
}

/**
 * Arguments for the offline sprite renderer, which is `stl-thumb`. Splice
 * these in ahead of the existing `-s`/`-c` flags in `_generate_angle_tile`.
 *
 *   stl-thumb model.stl out.png -s 512 -c 0 -4 2 -m 1b1c20 99a3b7 6b6357
 *
 * `stl-thumb`'s default material is BLUE (ambient 0.00/0.13/0.26, diffuse
 * 0.38/0.63/1.00, specular white) — every sheet in the bucket today is blue,
 * not grey.
 */
export function spriteArgsFor(material: MaterialId): readonly string[] {
  const s = MATERIALS[material].sprite;
  return ['-m', s.ambient.slice(1), s.diffuse.slice(1), s.specular.slice(1)];
}
