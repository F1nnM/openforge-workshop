/**
 * Upstream `bases.py`, transcribed as data — because no rule recovers it.
 *
 * The 1,963 catalogued bases *are* output of the vendored geometry, driven by
 * `openforge-bases/bases.py` at the pinned commit. That is what makes
 * catalog-first resolution possible at all: a parameter tuple can be mapped to
 * an archived file without a search. But the mapping is not derivable from the
 * filenames, and every attempt to shorten it into a rule loses information.
 * S1's PROVENANCE named three of the traps; a fourth turned up while
 * transcribing, and it is the worst of them.
 *
 * ## Trap 1 — the filename's lock name is not the `-D LOCK` value
 *
 * In {@link CONNECTIONS} the row whose filename says `openlock` renders with
 * `LOCK="triplex"`, and the row that says `openlock+unsupported` renders with
 * `LOCK="openlock"`. In {@link CURVED_CONNECTIONS} **those two are swapped.**
 * Same names, same order, opposite values — it reads as an upstream slip, and
 * either way it cannot be inferred from a name. Two of the values are not even
 * in the file's own `LOCK` enum: `openlock_topless` (six rows) and
 * `dragonlocktriplex` (the risers' `dragonlock`). A dropdown built from
 * `bases-square.scad`'s `// [openlock,triplex,infinitylock,dragonlock,none]`
 * cannot express the value that produced the archive's own topless bases.
 *
 * ## Trap 2 — option order encodes `PRIORITY`
 *
 * `generate()` emits the same filename stem **twice** when there are two
 * connectors and `x == 1 || y == 1 || flip`: once with the connector list as
 * written and `PRIORITY="lock"`, once reversed with `PRIORITY="magnets"`. So
 * `…openlock,magnetic+flex.stl` and `…magnetic+flex,openlock.stl` are different
 * meshes, and measurably so — the archive's 1x1 pair is 106,092 and 217,173
 * bytes. Otherwise one file is emitted, at `PRIORITY="magnets"`. The rule is
 * per-generator: `hex_corner_generate` always emits the pair, and
 * `curved_inverted_generate` always uses `"lock"` whatever the arity. Hence
 * {@link Sweep.priority} rather than a shared branch.
 *
 * ## Trap 3 — every catalogued base is `SQUARE_BASIS="inch"`
 *
 * Hard-coded in every `run_openscad_*`. The `.scad` offers four bases, so
 * `25mm`, `wyloch` and `drc` can never resolve against the archive and must go
 * to the live engine. `risers_*` are passed no basis at all and take the file's
 * default, which is also `inch`.
 *
 * ## Trap 4 — `kwargs.update(kv)` accumulates, and the archive says ignore it
 *
 * Not in PROVENANCE, and it decides the tuple of roughly half the corpus.
 * `generate()`'s loop body is
 *
 * ```python
 * for connection in connections:
 *     dirname, active, connectors, connector_setting, magnet_setting, options, kv = connection
 *     kwargs.update(kv)
 * ```
 *
 * — and `kwargs` is the enclosing call's dict, mutated in place. Read literally,
 * the `supports: "false"` that row 3 (`openlock+unsupported`) sets is still
 * there for every later row, none of which sets it, so the archive's
 * `openlock,magnetic+flex` bases would have been rendered with
 * `SUPPORTS="false"` — a value neither their filename nor the file's default
 * carries.
 *
 * **The archive says otherwise, and it says so twice.** Under the accumulating
 * reading, rows 5 and 6 assemble *byte-identical argv* — same `LOCK`, same
 * `MAGNETS`, same `PRIORITY`, same `TOPLESS`, same `SUPPORTS` — while the
 * archive publishes two different files for them: 54,881 B for
 * `plain#base+angled.1x1.openlock,magnetic+flex.stl` against 22,228 B for
 * `…openlock+unsupported,magnetic+flex.stl`. One argv cannot produce two meshes,
 * and the smaller file is the unsupported one in all 26 square, 6 angled, 13
 * curved and 2 inverted pairs. So the corpus was swept before the accumulation
 * existed, {@link rowKwargs} applies each row's `kv` to the sweep's own kwargs
 * and to nothing else, and the evidence is a measurement rather than a reading
 * of Python semantics. `resolve.test.ts` holds it: under the accumulating
 * reading the resolver's ambiguous-key count is 82, under this one it is 34, and
 * the 48 keys that separate them are exactly those pairs.
 *
 * ## What the replay is and is not
 *
 * It is the authority on **which archived file a parameter tuple names**. It is
 * not a claim that rendering that tuple reproduces the file's bytes: the
 * archive's bases are **ASCII** STL exported by an older revision of this
 * geometry, and 184 renders across the whole connector space of a 1x1 square
 * failed to match either the md5 or even the facet count of the archived 1x1.
 * `corpus.test.ts` pins that measurement, and `GeneratorDrawer.tsx` is worded
 * around it.
 */

/** A `-D` value as `../engine/args.ts` takes it. */
export type SweepValue = number | string

/** The connector-table rows, in table order. Order is load-bearing: see trap 4. */
export interface ConnectionRow {
  /** The folder `bases.py` writes into, and the canonical option spelling. */
  readonly dirname: string
  /** Connector tokens, in the order the filename writes them. */
  readonly connectors: readonly string[]
  /** `-D LOCK`. `null` means the row passes `LOCK="none"`. Trap 1 lives here. */
  readonly lock: string | null
  /** `-D MAGNETS`. `null` means `MAGNETS="none"`, `MAGNET_HOLE=0`, `PRIORITY="lock"`. */
  readonly magnets: string | null
  /** `connector -> suffix`, e.g. `{ openlock: 'topless' }`. Spells the filename. */
  readonly options: Readonly<Record<string, string>>
  /** The row's `kv`. Accumulated into the sweep's kwargs, never applied alone. */
  readonly kv: Readonly<Record<string, SweepValue>>
  /**
   * `false` for a row commented out upstream but present in the archive.
   *
   * `("openlock+topless", …)` is `#`-commented in `bases.py` today and the
   * archive holds 19 files from it. Dropping it would leave those 19 permanently
   * unresolvable; inventing it would be worse. It is carried, marked, and its
   * position in the table is where the comment sits — which matters, because
   * trap 4 makes position observable.
   */
  readonly active: boolean
}

const row = (
  dirname: string,
  connectors: readonly string[],
  lock: string | null,
  magnets: string | null,
  options: Readonly<Record<string, string>>,
  kv: Readonly<Record<string, SweepValue>>,
  active = true,
): ConnectionRow => ({ dirname, connectors, lock, magnets, options, kv, active })

/** `bases.py#connections()`. Note `openlock` -> `triplex`. */
export const CONNECTIONS: readonly ConnectionRow[] = [
  row('magnetic+flex', ['magnetic'], null, 'flex_magnetic', { magnetic: 'flex' }, {}),
  row('openlock', ['openlock'], 'triplex', null, {}, { topless: 'false' }),
  row('openlock+unsupported', ['openlock'], 'openlock', null, { openlock: 'unsupported' }, { supports: 'false', topless: 'false' }),
  row('openlock+topless', ['openlock'], 'openlock', null, { openlock: 'topless' }, { topless: 'true' }, false),
  row('openlock,magnetic+flex', ['openlock', 'magnetic'], 'openlock', 'flex_magnetic', { magnetic: 'flex' }, { topless: 'false' }),
  row('openlock+unsupported,magnetic+flex', ['openlock', 'magnetic'], 'openlock', 'flex_magnetic', { openlock: 'unsupported', magnetic: 'flex' }, { supports: 'false', topless: 'false' }),
  row('openlock+topless,magnetic+flex', ['openlock', 'magnetic'], 'openlock_topless', 'flex_magnetic', { openlock: 'topless', magnetic: 'flex' }, { topless: 'true' }),
  row('dragonlock', ['dragonlock'], 'dragonlock', null, {}, {}),
  row('dragonlock,magnetic+flex', ['dragonlock', 'magnetic'], 'dragonlock', 'flex_magnetic', { magnetic: 'flex' }, {}),
]

/** `bases.py#curved_connections()`. The same names; `openlock` -> `openlock`. */
export const CURVED_CONNECTIONS: readonly ConnectionRow[] = [
  row('magnetic+flex', ['magnetic'], null, 'flex_magnetic', { magnetic: 'flex' }, {}),
  row('openlock', ['openlock'], 'openlock', null, {}, { topless: 'false' }),
  row('openlock+unsupported', ['openlock'], 'triplex', null, { openlock: 'unsupported' }, { supports: 'false', topless: 'false' }),
  row('openlock+topless', ['openlock'], 'openlock', null, { openlock: 'topless' }, { topless: 'true' }, false),
  row('openlock,magnetic+flex', ['openlock', 'magnetic'], 'openlock', 'flex_magnetic', { magnetic: 'flex' }, { topless: 'false' }),
  row('openlock+unsupported,magnetic+flex', ['openlock', 'magnetic'], 'openlock', 'flex_magnetic', { openlock: 'unsupported', magnetic: 'flex' }, { supports: 'false', topless: 'false' }),
  row('openlock+topless,magnetic+flex', ['openlock', 'magnetic'], 'openlock_topless', 'flex_magnetic', { openlock: 'topless', magnetic: 'flex' }, { topless: 'true' }),
  row('dragonlock', ['dragonlock'], 'dragonlock', null, {}, {}),
  row('dragonlock,magnetic+flex', ['dragonlock', 'magnetic'], 'dragonlock', 'flex_magnetic', { magnetic: 'flex' }, {}),
]

/** `bases.py#wall_lock_connections()`. Magnets on every row, so no single-connector case. */
export const WALL_LOCK_CONNECTIONS: readonly ConnectionRow[] = [
  row('openlock,magnetic+flex', ['openlock', 'magnetic'], 'openlock', 'flex_magnetic', { magnetic: 'flex' }, { topless: 'false' }),
  row('openlock+unsupported,magnetic+flex', ['openlock', 'magnetic'], 'openlock', 'flex_magnetic', { openlock: 'unsupported', magnetic: 'flex' }, { supports: 'false', topless: 'false' }),
  row('openlock+topless,magnetic+flex', ['openlock', 'magnetic'], 'openlock_topless', 'flex_magnetic', { openlock: 'topless', magnetic: 'flex' }, { topless: 'true' }),
  row('dragonlock,magnetic+flex', ['dragonlock', 'magnetic'], 'dragonlock', 'flex_magnetic', { magnetic: 'flex' }, {}),
]

/**
 * `bases.py#riser_connections()` — `(title, -D LOCK)`.
 *
 * `run_openscad_risers` passes **only** `x`, `y`, `z` and `LOCK`: no basis, no
 * magnets, no priority. Everything else is the file's own default, and in
 * `risers_square.scad` `MAGNETS`, `MAGNET_HOLE`, `PRIORITY`, `NOTCH`, `TOPLESS`
 * and `HEIGHT` are assigned *below* the customizer block, where a `-D` cannot
 * reach them and the schema export does not list them.
 */
export const RISER_CONNECTIONS: readonly { readonly title: string; readonly lock: string }[] = [
  { title: 'openlock', lock: 'openlock' },
  { title: 'dragonlock', lock: 'dragonlocktriplex' },
]

/* ------------------------------------------------------------- coordinates */

const grid = (xs: readonly number[], ys: readonly number[]): readonly (readonly [number, number])[] =>
  xs.flatMap((x) => ys.map((y) => [x, y] as const))

/** `coords()` and `coords(limited=True)`. */
export const COORDS = grid([1, 2, 3, 4], [1, 2, 3, 4])
export const LIMITED_COORDS: readonly (readonly [number, number])[] = [[1, 1], [2, 2], [3, 3], [4, 4], [2, 4], [4, 2]]
/** `minimal_coords(ones=False)`. */
export const MINIMAL_COORDS: readonly (readonly [number, number])[] = [[2, 2], [3, 3], [4, 2], [4, 4]]
/** `riser_coords()` and `riser_coords(limited=True)`. */
export const RISER_COORDS = grid([1, 2, 3, 4], [1, 2, 3, 4]).flatMap(([x, y]) =>
  [1, 2, 3, 4].map((z) => [x, y, z] as const),
)
export const LIMITED_RISER_COORDS = LIMITED_COORDS.flatMap(([x, y]) => [1, 2, 3, 4].map((z) => [x, y, z] as const))

/** `riser_names(z)`. */
export const RISER_NAMES: Readonly<Record<number, string>> = { 1: 'platform', 2: 'low', 3: 'medium', 4: 'high' }

/* ------------------------------------------------------------------ sweeps */

/** Which `bases.py` driver a sweep runs, and therefore how its filename is spelled. */
export type SweepKind = 'square' | 'large-curved' | 'radial' | 'inverted' | 'hex-corner' | 'riser'

export interface Sweep {
  /** The `.scad` entry point, bare, as `../engine/args.ts` requires. */
  readonly entry: string
  /** The `shape` argument — the filename's morphology after `base+`. */
  readonly shape: string
  readonly kind: SweepKind
  readonly connections: readonly ConnectionRow[]
  /** `flip=True`, which turns on trap 2's second file at any size. */
  readonly flip?: boolean
  /** The sweep's starting `**kwargs`, before any row's `kv` accumulates into it. */
  readonly kwargs?: Readonly<Record<string, SweepValue>>
  /** `[x, y]`, `[x, y, z]`, or the radial/inverted tuples. */
  readonly coords: readonly (readonly number[])[]
}

/**
 * Every `generate_*()` call in `bases.py`, in source order.
 *
 * The whole of `generate_bases()` is `#`-commented upstream — the corpus was
 * swept by earlier revisions of this file — so this is the current tables
 * replayed, not a log of what ran. `resolve.ts` measures the difference against
 * the archive rather than assuming it away.
 */
export const SWEEPS: readonly Sweep[] = [
  { entry: 'bases-square.scad', shape: 'square', kind: 'square', connections: CONNECTIONS, coords: COORDS },
  { entry: 'bases-square.scad', shape: 'square', kind: 'square', connections: CONNECTIONS, coords: [[3, 3]], flip: true, kwargs: { notch: 'true', notch_x: 2, notch_y: 2 } },
  { entry: 'bases-square.scad', shape: 'square', kind: 'square', connections: CONNECTIONS, coords: [[4, 4]], flip: true, kwargs: { notch: 'true', notch_x: 2, notch_y: 2 } },
  { entry: 'bases-square.scad', shape: 'square,grid', kind: 'square', connections: CONNECTIONS, coords: [[6, 4], [6, 6], [8, 8]], kwargs: { center: 'grid' } },
  { entry: 'bases-square-wall.scad', shape: 'square+s2w+wall', kind: 'square', connections: WALL_LOCK_CONNECTIONS, coords: MINIMAL_COORDS, kwargs: { wall_locks: 'true' } },
  { entry: 'bases-square-wall.scad', shape: 'square+s2w+wall', kind: 'square', connections: CONNECTIONS, coords: MINIMAL_COORDS },
  { entry: 'bases-square-corner.scad', shape: 'square+s2w+corner', kind: 'square', connections: WALL_LOCK_CONNECTIONS, coords: MINIMAL_COORDS, kwargs: { wall_locks: 'true' } },
  { entry: 'bases-square-corner.scad', shape: 'square+s2w+corner', kind: 'square', connections: CONNECTIONS, coords: MINIMAL_COORDS },
  { entry: 'bases-square-internal_corner.scad', shape: 'square+s2w+internal_corner', kind: 'square', connections: CONNECTIONS, coords: [[2, 2]] },
  { entry: 'bases-diagonal.scad', shape: 'angled', kind: 'square', connections: CONNECTIONS, coords: LIMITED_COORDS },
  { entry: 'bases-hex-corner.scad', shape: 'hex+corner', kind: 'hex-corner', connections: CONNECTIONS, coords: [[60], [120], [240], [300]] },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'square', connections: CURVED_CONNECTIONS, coords: [[2, 2]] },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'square', connections: CURVED_CONNECTIONS, coords: [[4, 4]], kwargs: { curved_magnets: 'true' } },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'square', connections: CURVED_CONNECTIONS, coords: [[4, 4]], kwargs: { curved_magnets: 'true', notch: 'true', notch_x: 2, notch_y: 2 } },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'square', connections: CURVED_CONNECTIONS, coords: [[6, 6]], kwargs: { curved_magnets: 'true' } },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'square', connections: CURVED_CONNECTIONS, coords: [[6, 6]], kwargs: { curved_magnets: 'true', notch: 'true', notch_x: 3, notch_y: 3 } },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'large-curved', connections: CURVED_CONNECTIONS, coords: [[6, 6]], flip: true, kwargs: { large: 'a' } },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'large-curved', connections: CURVED_CONNECTIONS, coords: [[8, 8]], kwargs: { large: 'a' } },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'large-curved', connections: CURVED_CONNECTIONS, coords: [[6, 6], [8, 8]], kwargs: { large: 'b' } },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'large-curved', connections: CURVED_CONNECTIONS, coords: [[6, 6]], flip: true, kwargs: { large: 'c' } },
  { entry: 'bases-curved.scad', shape: 'curved', kind: 'large-curved', connections: CURVED_CONNECTIONS, coords: [[8, 8]], kwargs: { large: 'c' } },
  // [x, cut, angle, id, od, id_magnets, od_magnets]. Two rows collide on the
  // filename `4r90°` — (4,0,90,0,3) and (4,2,90,3,3) — so the archive holds one
  // file for two tuples and the later sweep is the one that survived on disk.
  { entry: 'bases-curved-radial.scad', shape: 'curved+radial', kind: 'radial', connections: CURVED_CONNECTIONS, coords: [[2, 0, 90, 0, 3, 0, 0], [4, 0, 90, 0, 3, 0, 1]] },
  { entry: 'bases-curved-radial.scad', shape: 'curved+radial', kind: 'radial', connections: CURVED_CONNECTIONS, coords: [[4, 2, 90, 3, 3, 0, 1], [4, 2, 45, 1, 1, 0, 1], [4, 2, 22.5, 0, 0, 0, 1]] },
  { entry: 'bases-curved-radial.scad', shape: 'curved+radial', kind: 'radial', connections: CURVED_CONNECTIONS, coords: [[6, 4, 90, 3, 3, 1, 1], [6, 4, 45, 3, 3, 1, 1], [6, 4, 22.5, 1, 1, 1, 1], [6, 4, 11.25, 0, 0, 1, 1]] },
  // [x, cut, id_radial_connectors].
  { entry: 'bases-curved-inverted.scad', shape: 'curved,inverted', kind: 'inverted', connections: CURVED_CONNECTIONS, coords: [[3, 2, 3], [5, 4, 3]] },
  { entry: 'bases-curved-inverted.scad', shape: 'curved,inverted', kind: 'inverted', connections: CURVED_CONNECTIONS, coords: [[7, 6, 3]], kwargs: { large: 'abc' } },
  { entry: 'risers_square.scad', shape: 'square', kind: 'riser', connections: [], coords: RISER_COORDS },
  { entry: 'risers_curved.scad', shape: 'curved', kind: 'riser', connections: [], coords: LIMITED_RISER_COORDS },
]

/* ------------------------------------------------------------------ replay */

/** One archived file as the sweep produced it: its name, and the argv behind it. */
export interface SweptBase {
  /** The filename `bases.py` wrote, without its directory. */
  readonly file: string
  readonly entry: string
  /** The full `-D` set, exactly as `run_openscad_*` assembled it. */
  readonly parameters: Readonly<Record<string, SweepValue>>
  /** The folder, which is the canonical spelling of the connector options. */
  readonly dirname: string
  /** `"lock"` or `"magnets"`, or `null` for a riser, which is passed neither. */
  readonly priority: string | null
  /** True when this row came from a table entry commented out upstream. */
  readonly historical: boolean
}

/** `set_options(connectors, options)`. */
function setOptions(connectors: readonly string[], options: Readonly<Record<string, string>>): string {
  return connectors.map((connector) => (connector in options ? `${connector}+${options[connector] ?? ''}` : connector)).join(',')
}

/**
 * Trap 4, in one function: the sweep's kwargs plus this row's `kv`, and nothing
 * carried over from the row before.
 *
 * A fresh object per row, which is *not* what `bases.py` does today — see the
 * module note for the two measurements that say the archive was swept before it
 * started doing it. Kept as a named function with this docblock rather than
 * inlined as a spread, because the inline version reads like a detail and this
 * is a decision.
 */
export function rowKwargs(
  sweep: Readonly<Record<string, SweepValue>>,
  kv: Readonly<Record<string, SweepValue>>,
): Record<string, SweepValue> {
  return { ...sweep, ...kv }
}

/** `_connector_setting` and `_magnet_setting`, plus the kwargs `-D` pass-through. */
function connectorArgs(
  connection: ConnectionRow,
  priority: string,
  live: Readonly<Record<string, SweepValue>>,
  kind: SweepKind,
): Record<string, SweepValue> {
  const out: Record<string, SweepValue> = { SQUARE_BASIS: 'inch' }
  out.LOCK = connection.lock ?? 'none'
  if (connection.magnets === null) {
    out.MAGNETS = 'none'
    out.MAGNET_HOLE = 0
    out.PRIORITY = 'lock'
  } else {
    out.MAGNETS = connection.magnets
    out.MAGNET_HOLE = 6
    out.PRIORITY = priority
  }
  // `run_openscad` forwards eight optional kwargs; the narrower drivers forward
  // only `supports` and `topless`. Passing `-D NOTCH` to `run_openscad_large_curved`
  // would be inventing an argument it never builds.
  const forwarded: readonly (readonly [string, string])[] =
    kind === 'square'
      ? [['supports', 'SUPPORTS'], ['topless', 'TOPLESS'], ['notch', 'NOTCH'], ['notch_x', 'NOTCH_X'], ['notch_y', 'NOTCH_Y'], ['curved_magnets', 'CURVED_MAGNETS'], ['wall_locks', 'WALL_LOCKS'], ['center', 'CENTER']]
      : [['supports', 'SUPPORTS'], ['topless', 'TOPLESS']]
  for (const [key, define] of forwarded) {
    const value = live[key]
    if (value !== undefined) out[define] = value
  }
  return out
}

/** Replay one sweep. Yields every file it writes, with the argv behind each. */
function replayOne(sweep: Sweep, emit: (base: SweptBase) => void): void {
  if (sweep.kind === 'riser') {
    for (const connection of RISER_CONNECTIONS) {
      for (const [x, y, z] of sweep.coords as readonly (readonly [number, number, number])[]) {
        emit({
          file: `plain#riser+${sweep.shape},${RISER_NAMES[z] ?? String(z)}.${String(x)}x${String(y)}.${connection.title}.stl`,
          entry: sweep.entry,
          parameters: { x, y, z, LOCK: connection.lock },
          dirname: connection.title,
          priority: null,
          historical: false,
        })
      }
    }
    return
  }

  for (const connection of sweep.connections) {
    const live = rowKwargs(sweep.kwargs ?? {}, connection.kv)
    for (const coord of sweep.coords) {
      const stems = stemsFor(sweep, coord, live)
      for (const { stem, extra } of stems) {
        const run = (connectors: readonly string[], priority: string) => {
          emit({
            file: `${stem}.${setOptions(connectors, connection.options)}.stl`,
            entry: sweep.entry,
            parameters: { ...connectorArgs(connection, priority, live, sweep.kind), ...extra },
            dirname: connection.dirname,
            priority,
            historical: !connection.active,
          })
        }
        const paired = pairsPriorities(sweep, coord, connection)
        if (paired === null) run(connection.connectors, soloPriority(sweep))
        else {
          run(connection.connectors, paired[0])
          run([...connection.connectors].reverse(), paired[1])
        }
      }
    }
  }
}

/** The filename stem and the coordinate `-D`s, which differ per driver. */
function stemsFor(
  sweep: Sweep,
  coord: readonly number[],
  live: Readonly<Record<string, SweepValue>>,
): readonly { stem: string; extra: Record<string, SweepValue> }[] {
  const [first = 0, second = 0] = coord
  switch (sweep.kind) {
    case 'square': {
      let shape = sweep.shape
      let size = `${String(first)}x${String(second)}`
      if (live.large !== undefined) size += `+${String(live.large)}`
      if (live.notch !== undefined) size += '+notch'
      if (live.wall_locks !== undefined) shape += ',wall_locks'
      return [{ stem: `plain#base+${shape}.${size}`, extra: { x: first, y: second } }]
    }
    case 'large-curved': {
      const large = String(live.large ?? 'a')
      return [
        {
          stem: `plain#base+${sweep.shape}.${String(first)}x${String(second)}+${large}`,
          extra: { x: first, y: second, CURVED_LARGE: large },
        },
      ]
    }
    case 'radial': {
      const [x = 0, cut = 0, angle = 0, id = 0, od = 0, idMagnets = 0, odMagnets = 0] = coord
      return [
        {
          stem: `plain#base+${sweep.shape}.${String(x)}r${String(angle)}°`,
          extra: {
            x,
            cut,
            angle,
            id_radial_connectors: id,
            ID_MAGNETS: idMagnets === 1 ? 'true' : 'false',
            od_radial_connectors: od,
            OD_MAGNETS: odMagnets === 1 ? 'true' : 'false',
          },
        },
      ]
    }
    case 'inverted': {
      const [x = 0, cut = 0, id = 0] = coord
      const size = `${String(x)}x${String(x)}+${String(cut)}r`
      const extra = { x, cut, id_radial_connectors: id }
      if (live.large === undefined) return [{ stem: `plain#base+${sweep.shape}.${size}`, extra }]
      // `large=True` emits one file per part, and the part letter goes in the
      // *shape* here rather than the size — `curved,inverted,a` — which is the
      // one place the two curved drivers spell the same idea differently.
      return ['a', 'b', 'c'].map((part) => ({
        stem: `plain#base+${sweep.shape},${part}.${size}`,
        extra: { ...extra, CURVED_LARGE: part },
      }))
    }
    case 'hex-corner':
      return [{ stem: `plain#base+${sweep.shape}.${String(first)}°`, extra: { ANGLE: first } }]
    case 'riser':
      return []
  }
}

/**
 * Trap 2's table. `null` means one file; a pair means two, in that order.
 *
 * `hex_corner_generate` pairs unconditionally, `curved_inverted_generate` and
 * `curved_radial_generate` never pair, and `generate()` pairs only when a
 * dimension is 1 or the sweep passed `flip=True`.
 */
function pairsPriorities(
  sweep: Sweep,
  coord: readonly number[],
  connection: ConnectionRow,
): readonly [string, string] | null {
  if (connection.connectors.length < 2) return null
  const [x = 0, y = 0] = coord
  switch (sweep.kind) {
    case 'square':
    case 'large-curved':
      return x === 1 || y === 1 || sweep.flip === true ? ['lock', 'magnets'] : null
    case 'hex-corner':
      return ['lock', 'magnets']
    case 'radial':
    case 'inverted':
    case 'riser':
      return null
  }
}

/** The `magnet_priority` a driver passes when it emits a single file. */
function soloPriority(sweep: Sweep): string {
  switch (sweep.kind) {
    case 'square':
    case 'large-curved':
    case 'radial':
      return 'magnets'
    case 'hex-corner':
    case 'inverted':
      return 'lock'
    case 'riser':
      return 'lock'
  }
}

/** Replay every sweep. Deterministic, and cheap enough to do at module scope. */
export function replaySweeps(sweeps: readonly Sweep[] = SWEEPS): readonly SweptBase[] {
  const out: SweptBase[] = []
  for (const sweep of sweeps) replayOne(sweep, (base) => out.push(base))
  return out
}
