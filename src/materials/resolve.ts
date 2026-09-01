/**
 * OpenForge Workshop — `resolveMaterial(tags)`.
 *
 * Turns a blueprint's tag list into an appearance. Hardcoded, not user-facing,
 * no settings UI: architecture-plan.md §9. Pure and synchronous, with no
 * renderer import anywhere in the module graph, so the same call serves a 2D
 * canvas fill in v1 and a `MeshStandardMaterial` in v1.1.
 *
 * ── Resolution is an ordered fallback ───────────────────────────────────────
 *
 *   1. exact tag       `texture|cave|sandstone` → sandstone
 *   2. parent tag      `texture|cave|sandstone|2` → `texture|cave|sandstone`
 *   3. root            `texture|dungeon_stone|block` → `texture|dungeon_stone`
 *   4. filename hint   no texture tag; `…torch_plate.stl` → metal
 *   5. part-tag chain  no texture tag; `part|grate` → metal
 *   6. `unknown`       an explicit *unclassified* material, not a wrong guess
 *
 * Stage 6 is a real family with a dashed contour and zero chroma, because 89
 * tiles (1.0%) carry no texture tag and a plausible-looking grey would be a
 * lie. Absence of colour means absence of a claim.
 *
 * ── Several texture tags on one blueprint ───────────────────────────────────
 * Three distinct cases, all measured, all order-independent:
 *
 *   - **Same root, several depths** (3,339 blueprints). Not a conflict: one
 *     material described at several specificities. Take the deepest tag and
 *     walk up until something is mapped.
 *   - **Several distinct roots** (80 blueprints, 0.92%). Pick by
 *     `ROOT_PRECEDENCE` — lowest number wins, ties alphabetical — then resolve
 *     within that root alone. The inset material wins: a pool set into a
 *     dungeon-stone floor renders as water. This is a deliberate divergence
 *     from `CatalogRecord.texture`, which picks the design family; see
 *     `mapping.ts`.
 *   - **Several level-2 siblings under one root** (152 blueprints). Nearly all
 *     are base + wear (`dungeon_stone` + `block` + `ruined`). Deepest-first,
 *     then prefer a substance-bearing tag over a wear qualifier at equal depth,
 *     then alphabetical. The wear flag is set independently of which tag wins,
 *     so `dungeon_stone|block` + `dungeon_stone|ruined` resolves to dungeon
 *     stone, worn.
 *
 * Every comparison in the sort is total and none reads array position, so
 * shuffling the input cannot change the output. `resolve.test.ts` asserts that
 * over the whole corpus with a reversed tag list.
 */
import type {
  Confidence,
  ContourStyle,
  GrainSpec,
  MaterialFamily,
  MaterialId,
  MortarSpec,
  SurfaceTreatment,
} from './palette'
import { MATERIALS } from './palette'
import type { FinishOverride } from './mapping'
import {
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

/* --------------------------------------------------------------------- types */

/** Which fallback stage produced the answer. Surfaced so a wrong tint is diagnosable. */
export type ResolutionPath =
  | 'exact-tag'
  | 'parent-tag'
  | 'root'
  | 'filename-hint'
  | 'part-fallback'
  | 'unmapped-root'
  | 'terminal-default'

/** The material response after finish overrides and wear have been applied. */
export interface ResolvedFinish {
  readonly roughness: number
  readonly metalness: number
  readonly transmission: number
  readonly ior: number
  readonly surface: SurfaceTreatment
  readonly grain: GrainSpec | null
  readonly mortar: MortarSpec | null
}

export interface Resolution {
  readonly material: MaterialId
  readonly family: MaterialFamily
  readonly finish: ResolvedFinish
  readonly via: ResolutionPath
  /** The tag the decision was actually taken on, when there was one. */
  readonly matchedTag: string | null
  readonly worn: boolean
  readonly confidence: Confidence
  /**
   * Cache key. Renderers must key their material cache on this and share the
   * instance across every mesh — 8,702 models collapse to a few dozen
   * materials, which is what makes instanced drawing affordable.
   */
  readonly variantKey: string
}

const TEXTURE_PREFIX = 'texture|'

/* ------------------------------------------------------------------- tag maths */

function textureTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => tag.startsWith(TEXTURE_PREFIX))
}

function rootOf(tag: string): string {
  const parts = tag.split('|')
  return parts.length > 1 ? (parts[1] ?? '') : ''
}

function lastComponent(tag: string): string {
  const parts = tag.split('|')
  return parts[parts.length - 1] ?? ''
}

/**
 * Wear is detected on ANY component below the root, not just the last one:
 * `texture|towne|ruined_stucco|a` is worn, and its `|a` is a cosmetic sculpt
 * variant.
 *
 * In practice a blueprint always carries the parent tag too — the hierarchy is
 * strict, verified at 0 orphan children across the whole index — but resolving
 * a single tag in isolation must give the same answer, so this reads the whole
 * path rather than trusting the sibling to be present.
 */
export function isWearTag(tag: string): boolean {
  const parts = tag.split('|')
  for (let i = 2; i < parts.length; i += 1) {
    const component = parts[i] ?? ''
    if (WEAR_EXACT.has(component)) return true
    if (WEAR_PREFIXES.some((prefix) => component.startsWith(prefix))) return true
  }
  return false
}

/** Multi-root tie-break. Lowest precedence wins; ties break alphabetically. */
function chooseRoot(roots: readonly string[]): string {
  const sorted = roots.slice().sort((a, b) => {
    const pa = ROOT_PRECEDENCE[a] ?? DEFAULT_ROOT_PRECEDENCE
    const pb = ROOT_PRECEDENCE[b] ?? DEFAULT_ROOT_PRECEDENCE
    if (pa !== pb) return pa - pb
    return a < b ? -1 : a > b ? 1 : 0
  })
  return sorted[0] ?? ''
}

interface TagMatch {
  readonly material: MaterialId
  readonly via: ResolutionPath
  readonly matchedTag: string
}

/**
 * Ordered fallback for one tag: exact match, then each parent in turn, then the
 * root map. Terminates at the root, which is always mapped for a known tag —
 * all 38 roots are in `TEXTURE_ROOT_MATERIAL`.
 */
function matchTag(tag: string): TagMatch | null {
  let current = tag
  let depth = 0
  while (current.includes('|')) {
    const exact = TEXTURE_TAG_MATERIAL[current]
    if (exact !== undefined) {
      return {
        material: exact,
        via: depth === 0 ? 'exact-tag' : 'parent-tag',
        matchedTag: current,
      }
    }
    const parts = current.split('|')
    if (parts.length <= 2) {
      const root = TEXTURE_ROOT_MATERIAL[parts[1] ?? '']
      return root !== undefined
        ? { material: root, via: 'root', matchedTag: current }
        : { material: 'unknown', via: 'unmapped-root', matchedTag: current }
    }
    current = parts.slice(0, -1).join('|')
    depth += 1
  }
  return null
}

/* ---------------------------------------------------------------- the finish */

function finishOf(family: MaterialFamily): ResolvedFinish {
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    transmission: family.transmission,
    ior: family.ior,
    surface: family.surface,
    grain: family.grain,
    mortar: family.mortar,
  }
}

function applyOverride(base: ResolvedFinish, override: FinishOverride): ResolvedFinish {
  return {
    roughness: override.roughness ?? base.roughness,
    metalness: override.metalness ?? base.metalness,
    transmission: base.transmission,
    ior: base.ior,
    surface: override.surface ?? base.surface,
    grain: override.grain !== undefined ? override.grain : base.grain,
    mortar: override.mortar !== undefined ? override.mortar : base.mortar,
  }
}

/**
 * Wear: rougher, coarser grain, deeper joints. **Never a colour change.**
 *
 * Darkening and desaturating the parent was implemented and measured, then
 * rejected: at a visible delta (L×0.93, C×0.86) a worn `cut_stone` lands
 * 5.17 ΔE00 from base `plain` and 5.04 from its own parent, i.e. it belongs to
 * neither. Shrinking the delta until that stops (L×0.98) leaves it 1.39 ΔE00
 * from its parent — invisible. There is no usable window between the two, so
 * wear moves the response and nothing else.
 *
 * Those four figures were 4.06 and 1.09 against the palette as first shipped.
 * Re-solving the annealing moved them and strengthened the conclusion; the
 * palette's own header records why the two objectives differed.
 */
export function applyWear(base: ResolvedFinish): ResolvedFinish {
  return {
    roughness: Math.min(1, base.roughness + 0.05),
    metalness: base.metalness,
    transmission: base.transmission,
    ior: base.ior,
    surface: base.surface,
    grain:
      base.grain === null
        ? null
        : { scale: base.grain.scale, amplitude: Math.min(0.35, base.grain.amplitude * 1.4) },
    mortar:
      base.mortar === null
        ? null
        : {
            scale: base.mortar.scale,
            width: base.mortar.width,
            darken: Math.min(0.5, base.mortar.darken * 1.15),
          },
  }
}

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 }

function build(
  material: MaterialId,
  via: ResolutionPath,
  matchedTag: string | null,
  worn: boolean,
  overrideTags: readonly string[],
): Resolution {
  const family = MATERIALS[material]
  let finish = finishOf(family)
  const applied: string[] = []
  for (const tag of overrideTags) {
    const override = FINISH_OVERRIDES[tag]
    if (override !== undefined) {
      finish = applyOverride(finish, override)
      applied.push(lastComponent(tag))
    }
  }
  if (worn) finish = applyWear(finish)

  const suffix = applied.length > 0 ? `/${applied.slice().sort().join('+')}` : ''

  // Confidence is the WEAKEST claim involved: the family's own, anything the
  // matched tag or its siblings downgrade, and the resolution path itself. This
  // is where the four-segment `texture|towne|stone|stucco` gets its 'low' —
  // the decision was taken on its parent, but the sibling tag is still on the
  // tile and still says two materials share the mesh.
  let confidence: Confidence = family.confidence
  const downgrade = (candidate: Confidence | undefined): void => {
    if (candidate !== undefined && CONFIDENCE_RANK[candidate] < CONFIDENCE_RANK[confidence]) {
      confidence = candidate
    }
  }
  if (matchedTag !== null) downgrade(TAG_CONFIDENCE[matchedTag])
  for (const tag of overrideTags) downgrade(TAG_CONFIDENCE[tag])
  if (via === 'unmapped-root' || via === 'terminal-default') downgrade('low')
  if (via === 'part-fallback' || via === 'filename-hint') downgrade('low')

  return {
    material,
    family,
    finish,
    via,
    matchedTag,
    worn,
    confidence,
    variantKey: `${material}${suffix}${worn ? '/worn' : ''}`,
  }
}

/* ------------------------------------------------------------------ the entry */

/**
 * Resolve a blueprint's tags to a material.
 *
 * @param tags     every tag on the blueprint, not just the `texture|` ones —
 *                 the part-tag chain and the confidence downgrades both read
 *                 siblings. Pass a record's full de-interned tag list, never a
 *                 reconstructed `` `texture|${record.texture}` ``: that field is
 *                 the *first* texture root, and on the 80 two-root tiles it is
 *                 deliberately not the one the tint follows.
 * @param filename the blueprint's STL filename (`CatalogRecord.file`), used
 *                 only by the hint stage, and only when there is no texture tag
 *                 at all.
 */
export function resolveMaterial(tags: readonly string[], filename = ''): Resolution {
  const texture = textureTags(tags)

  if (texture.length === 0) {
    const lower = filename.toLowerCase()
    for (const [needle, material] of FILENAME_HINTS) {
      if (lower.includes(needle)) return build(material, 'filename-hint', null, false, [])
    }
    for (const [tag, material] of PART_FALLBACK) {
      if (tags.some((candidate) => candidate === tag || candidate.startsWith(`${tag}|`))) {
        return build(material, 'part-fallback', tag, false, [])
      }
    }
    return build('unknown', 'terminal-default', null, false, [])
  }

  const roots: string[] = []
  for (const tag of texture) {
    const root = rootOf(tag)
    if (root !== '' && !roots.includes(root)) roots.push(root)
  }
  const root = chooseRoot(roots)
  const scoped = texture.filter((tag) => rootOf(tag) === root)

  const worn = scoped.some(isWearTag)

  // Deepest first; a substance-bearing tag beats a wear qualifier at equal
  // depth; alphabetical last so the result is order-independent.
  const ranked = scoped.slice().sort((a, b) => {
    const da = a.split('|').length
    const db = b.split('|').length
    if (da !== db) return db - da
    const wa = isWearTag(a) ? 1 : 0
    const wb = isWearTag(b) ? 1 : 0
    if (wa !== wb) return wa - wb
    return a < b ? -1 : a > b ? 1 : 0
  })

  for (const tag of ranked) {
    const hit = matchTag(tag)
    if (hit !== null && hit.via !== 'unmapped-root') {
      return build(hit.material, hit.via, hit.matchedTag, worn, scoped)
    }
  }
  return build('unknown', 'unmapped-root', ranked[0] ?? null, worn, scoped)
}

/* ------------------------------------------------------------------ shorthands */

/** The family a blueprint renders as. */
export function materialFor(tags: readonly string[], filename = ''): MaterialFamily {
  return resolveMaterial(tags, filename).family
}

/** The base colour a blueprint renders as, sRGB hex. */
export function tintFor(tags: readonly string[], filename = ''): string {
  return resolveMaterial(tags, filename).family.tint
}

/**
 * The silhouette contour, and whether it is dashed.
 *
 * The plan-view canvas draws this as a stroke round the fill. It is what
 * carries WCAG 1.4.11's 3:1 against the parchment well; the fill cannot, and
 * forcing it to would put every material below L* 50. Dashed means
 * unclassified.
 */
export function contourFor(
  tags: readonly string[],
  filename = '',
): { readonly color: string; readonly style: ContourStyle } {
  const family = resolveMaterial(tags, filename).family
  return { color: family.edge, style: family.contour }
}

/**
 * Arguments for the offline sprite renderer, which is `stl-thumb`. Splice these
 * in ahead of the existing `-s`/`-c` flags:
 *
 *   stl-thumb model.stl out.png -s 512 -c 0 -4 2 -m 1b1c20 99a3b7 6b6357
 *
 * Unused by v1 — §5 accepts that the existing sheets stay blue and only the 3D
 * views are tinted — and carried because a coloured re-render in v1.1 needs the
 * same table this module already holds.
 */
export function spriteArgsFor(material: MaterialId): readonly string[] {
  const sprite = MATERIALS[material].sprite
  return ['-m', sprite.ambient.slice(1), sprite.diffuse.slice(1), sprite.specular.slice(1)]
}
