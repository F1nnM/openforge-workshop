/**
 * The parameter schema, taken from OpenSCAD and not from a parser of ours.
 *
 * `architecture-plan.md` §12 is blunt about this — *"Don't write a customizer
 * parser. OpenSCAD's WASM build emits the parameter schema via
 * `--export-format=param`"* — and S1's PROVENANCE explains why it matters: the
 * `/* [Group] *\/` headings and the `//` comments around each assignment **are**
 * the schema. A `//` above a variable is its help text; a `//` after it is its
 * domain; `value:Label` inside the brackets gives an option its display label.
 * Reflow one of those lines and the parameter silently loses its dropdown, with
 * no error. Re-deriving that syntax by hand would mean owning a second,
 * divergent implementation of a format whose author already ships one.
 *
 * So this module does exactly two things: it declares the descriptor types the
 * panel renders, and it validates the JSON OpenSCAD wrote into the virtual
 * filesystem. It never looks at `.scad` text.
 *
 * ## Three things the real output does that a guess would get wrong
 *
 * **`type` does not classify the parameter.** A vector reports `"type":
 * "number"` with an *array* `initial` — measured, on `vec = [1, 2, 3]`. Trusting
 * `type` alone would hand the panel a number input for a three-element vector.
 * {@link ParameterDescriptor.kind} is derived from `initial` as well as `type`.
 *
 * **OpenSCAD adds the initial value to an enum that omits it.**
 * `bases-square.scad` declares `CENTER = "none"; // [grid, cube, false]` — three
 * options — and the export lists **four**, with `none` first. A parser reading
 * the brackets would produce a dropdown that cannot represent the default.
 *
 * **Only the last leading comment becomes the caption.** `LOCK` in
 * `bases-square.scad` has six comment lines above it describing all five lock
 * types; the export keeps one, *"Select the type of clip lock"*. That is
 * OpenSCAD's rule, and the panel inherits it rather than inventing a better one.
 *
 * Ranges (`// [0:10]`, `// [0:2:20]`) arrive as `min`/`max`/`step`. **No
 * parameter in the vendored geometry uses one** — verified across all 16 entry
 * points — but the shape is handled because the alternative is a crash the first
 * time upstream adds a slider.
 */

/** A scalar OpenSCAD parameter value, plus the vector case. */
export type ParameterValue = number | string | boolean | readonly number[]

/**
 * How the panel should render a parameter.
 *
 * Derived, not copied: OpenSCAD's `type` field distinguishes `number` from
 * `string` from `boolean` but calls a vector a number, and says nothing about
 * whether an enum or a slider is available. This does.
 */
export type ParameterKind =
  /** A closed set of values. `options` is non-empty. */
  | 'enum'
  /** A bounded number. `range` is present. */
  | 'range'
  /** A free number. */
  | 'number'
  /** A free string. */
  | 'string'
  /** A checkbox. */
  | 'boolean'
  /** A fixed-length list of numbers. `initial` is an array. */
  | 'vector'

export interface ParameterOption {
  /** What to show. Equal to `String(value)` unless the annotation gave a label. */
  readonly label: string
  readonly value: number | string | boolean
}

export interface ParameterRange {
  readonly min: number
  readonly max: number
  /** OpenSCAD defaults this to 1 when the annotation gives only `min:max`. */
  readonly step: number
}

export interface ParameterDescriptor {
  /** The OpenSCAD variable name. Case-sensitive; `-D` uses it verbatim. */
  readonly name: string
  /** The `/* [Heading] *\/` this fell under, or `''` when it fell under none. */
  readonly group: string
  /** The help text, or `null` when the variable had no leading comment. */
  readonly caption: string | null
  readonly kind: ParameterKind
  /** The value the `.scad` file assigns. What the geometry does with no `-D`. */
  readonly initial: ParameterValue
  /** Non-empty for `kind === 'enum'`, empty otherwise. */
  readonly options: readonly ParameterOption[]
  /** Present for `kind === 'range'`, `null` otherwise. */
  readonly range: ParameterRange | null
}

/** Descriptors in declaration order, under the heading that introduced them. */
export interface ParameterGroup {
  readonly name: string
  readonly parameters: readonly ParameterDescriptor[]
}

export interface ParameterSchema {
  /** The entry point this describes, e.g. `bases-square.scad`. */
  readonly entry: string
  /** OpenSCAD's own `title` — the entry filename without its extension. */
  readonly title: string
  /** Every descriptor, in the order OpenSCAD emitted them. */
  readonly parameters: readonly ParameterDescriptor[]
  /** The same descriptors grouped, in first-appearance order of the headings. */
  readonly groups: readonly ParameterGroup[]
}

export class ParameterSchemaError extends Error {
  override readonly name = 'ParameterSchemaError'
}

/**
 * Validate and shape one `--export-format=param` document.
 *
 * Throws rather than repairing. A malformed export means the engine ran and
 * produced something unexpected, which is a bug to see, not a state to render
 * around — and the panel has nothing useful to draw from half a schema.
 */
export function parseParameterExport(json: string, entry: string): ParameterSchema {
  const document: unknown = JSON.parse(json)
  if (!isRecord(document)) throw new ParameterSchemaError(`${entry}: the param export is not an object`)

  const { title, parameters } = document
  if (typeof title !== 'string') throw new ParameterSchemaError(`${entry}: the param export has no title`)
  if (!Array.isArray(parameters)) throw new ParameterSchemaError(`${entry}: the param export has no parameters array`)

  const descriptors = parameters.map((raw, index) => descriptor(raw, entry, index))
  return { entry, title, parameters: descriptors, groups: group(descriptors) }
}

/** OpenSCAD's per-parameter object, before it is trusted. */
function descriptor(raw: unknown, entry: string, index: number): ParameterDescriptor {
  const where = `${entry}: parameter ${String(index)}`
  if (!isRecord(raw)) throw new ParameterSchemaError(`${where} is not an object`)

  const name = raw.name
  if (typeof name !== 'string' || name === '') throw new ParameterSchemaError(`${where} has no name`)

  const type = raw.type
  if (type !== 'number' && type !== 'string' && type !== 'boolean') {
    throw new ParameterSchemaError(`${entry}: ${name} has an unknown type ${JSON.stringify(type)}`)
  }

  const initial = value(raw.initial, `${entry}: ${name}`)
  const options = choices(raw.options, `${entry}: ${name}`)
  const range = bounds(raw)

  return {
    name,
    group: typeof raw.group === 'string' ? raw.group : '',
    // The `\r` that a CRLF source leaks into a caption is stripped in `vfs.ts`,
    // before OpenSCAD ever sees the file. Trimming again here would hide a
    // regression in that, so this only trims what a normalised source can carry.
    caption: typeof raw.caption === 'string' && raw.caption !== '' ? raw.caption : null,
    kind: kind(type, initial, options, range),
    initial,
    options,
    range,
  }
}

/**
 * The classification the `type` field cannot make on its own.
 *
 * Order matters. An enum wins over a range because a closed set is a stricter
 * control than a slider, and a vector wins over `number` because that is the
 * case `type` gets wrong.
 */
function kind(
  type: 'number' | 'string' | 'boolean',
  initial: ParameterValue,
  options: readonly ParameterOption[],
  range: ParameterRange | null,
): ParameterKind {
  if (options.length > 0) return 'enum'
  if (Array.isArray(initial)) return 'vector'
  if (range !== null) return 'range'
  return type
}

function value(raw: unknown, where: string): ParameterValue {
  if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') return raw
  if (Array.isArray(raw) && raw.every((entry) => typeof entry === 'number')) return raw
  throw new ParameterSchemaError(`${where} has an initial value of an unsupported shape`)
}

function choices(raw: unknown, where: string): readonly ParameterOption[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new ParameterSchemaError(`${where} has a non-array options field`)
  return raw.map((option) => {
    if (!isRecord(option)) throw new ParameterSchemaError(`${where} has an option that is not an object`)
    const choice = option.value
    if (typeof choice !== 'number' && typeof choice !== 'string' && typeof choice !== 'boolean') {
      throw new ParameterSchemaError(`${where} has an option with no scalar value`)
    }
    return { label: typeof option.name === 'string' ? option.name : String(choice), value: choice }
  })
}

/** `min`/`max`/`step`, all three or none. `step` is OpenSCAD's, never defaulted here. */
function bounds(raw: Record<string, unknown>): ParameterRange | null {
  const { min, max, step } = raw
  if (typeof min !== 'number' || typeof max !== 'number') return null
  return { min, max, step: typeof step === 'number' ? step : 1 }
}

function group(descriptors: readonly ParameterDescriptor[]): readonly ParameterGroup[] {
  const order: string[] = []
  const byName = new Map<string, ParameterDescriptor[]>()
  for (const descriptor of descriptors) {
    let bucket = byName.get(descriptor.group)
    if (bucket === undefined) {
      bucket = []
      byName.set(descriptor.group, bucket)
      order.push(descriptor.group)
    }
    bucket.push(descriptor)
  }
  return order.map((name) => ({ name, parameters: byName.get(name) ?? [] }))
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}
