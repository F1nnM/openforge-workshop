/**
 * One control per parameter, over the descriptors OpenSCAD emitted.
 *
 * Six widget kinds and a `switch`, which is the whole of it. The reason this is
 * ~150 lines rather than a schema-form library is in §7 of
 * `docs/base-generator-integration.md`: `@rjsf/core` would need a generated
 * `uiSchema` to express "slider versus spinbox", the group tabs, and the
 * `"true"`/`"false"`-string-as-checkbox rule — the same code, written twice,
 * plus 2.18 MB and AJV.
 *
 * ## Three presentation rules the raw schema cannot state
 *
 * **A string enum whose options are exactly `{"true","false"}` is a checkbox**
 * and serialises back to the string. This geometry encodes booleans as strings
 * in eleven of the five entry points' parameters, and without this rule the form
 * is a wall of two-item dropdowns.
 *
 * **The option label is already split.** The plan warned that `SQUARE_BASIS`'s
 * `value:Label` pairs contain colons and slashes — `25mm:25mm - Dwarven
 * Forge/Hirstarts` — and told the panel to split on the first colon only.
 * OpenSCAD's own exporter does that, so the descriptor arrives with
 * `value: '25mm'` and `label: '25mm - Dwarven Forge/Hirstarts'` and there is
 * nothing here to split. Doing it again would corrupt the label.
 *
 * **An enum carries the file's default even when the brackets do not.**
 * `CENTER = "none"; // [grid, cube, false]` exports four options with `none`
 * first, because OpenSCAD injects the initial value. A control built from the
 * brackets could not select the file's own default; this one can, and
 * `recipe.test.ts` asserts that every descriptor's `initial` is among its own
 * options.
 *
 * ## There is no tessellation control, and there never will be
 *
 * S2 established that every `$fn` in the vendored geometry is a call-site
 * argument, so `-D '$fn=50'` is byte-identical to no flag at all, and S3's
 * `args.ts` throws on any `$`-prefixed name rather than accepting one. A quality
 * slider here would be a control that does nothing — which is the exact failure
 * mode this row is arranged against — so the absence is deliberate and this
 * paragraph is why.
 */
import type { ParameterDescriptor } from '../engine'

import type { RecipeValue } from './recipe'

export interface ControlProps {
  readonly descriptor: ParameterDescriptor
  readonly value: RecipeValue
  readonly onChange: (value: RecipeValue) => void
  /** Called when a continuous control settles, so the caller can dispatch early. */
  readonly onCommit?: (() => void) | undefined
  /** A refusal from the geometry's own guards. Disables nothing; explains. */
  readonly warning?: string | null | undefined
  /** True while the archive holds no file for this value. Mono note, not a block. */
  readonly note?: string | null | undefined
}

/** The `{"true","false"}` string-enum case. */
function isStringBoolean(descriptor: ParameterDescriptor): boolean {
  if (descriptor.kind !== 'enum' || descriptor.options.length !== 2) return false
  const values = descriptor.options.map((option) => String(option.value)).sort()
  return values[0] === 'false' && values[1] === 'true'
}

export function ParameterControl({ descriptor, value, onChange, onCommit, warning, note }: ControlProps) {
  const id = `of-gen-${descriptor.name}`
  const described = [warning === null || warning === undefined ? null : `${id}-warn`, note === null || note === undefined ? null : `${id}-note`]
    .filter((token): token is string => token !== null)
    .join(' ')

  return (
    <div className="of-gen-field" data-kind={descriptor.kind} data-warned={warning === null || warning === undefined ? 'false' : 'true'}>
      <label className="of-gen-label" htmlFor={id}>
        {descriptor.name}
      </label>
      {widget({ descriptor, value, onChange, onCommit }, id, described)}
      {descriptor.caption === null ? null : <p className="of-gen-help">{descriptor.caption}</p>}
      {note === null || note === undefined ? null : (
        <p className="of-gen-note" id={`${id}-note`}>
          {note}
        </p>
      )}
      {warning === null || warning === undefined ? null : (
        <p className="of-gen-warn" id={`${id}-warn`} role="note">
          {warning}
        </p>
      )}
    </div>
  )
}

function widget(
  { descriptor, value, onChange, onCommit }: Omit<ControlProps, 'warning' | 'note'>,
  id: string,
  described: string,
) {
  const describedBy = described === '' ? undefined : described

  if (isStringBoolean(descriptor)) {
    // The string round-trip is the point: `-D TOPLESS=true` is a boolean and
    // `TOPLESS="true"` is the string this geometry compares against, and the
    // two are not interchangeable inside the `.scad`.
    const truthy = String(value) === 'true'
    return (
      <input
        id={id}
        className="of-gen-check"
        type="checkbox"
        checked={truthy}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange(event.target.checked ? 'true' : 'false')
          onCommit?.()
        }}
      />
    )
  }

  switch (descriptor.kind) {
    case 'enum':
      return (
        <select
          id={id}
          className="of-gen-select"
          value={String(value)}
          aria-describedby={describedBy}
          onChange={(event) => {
            const picked = descriptor.options.find((option) => String(option.value) === event.target.value)
            onChange(picked === undefined ? event.target.value : picked.value)
            onCommit?.()
          }}
        >
          {descriptor.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      )

    case 'range':
      return (
        <input
          id={id}
          className="of-gen-range"
          type="range"
          min={descriptor.range?.min ?? 0}
          max={descriptor.range?.max ?? 1}
          step={descriptor.range?.step ?? 1}
          value={typeof value === 'number' ? value : 0}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange(Number(event.target.value))
          }}
          onPointerUp={onCommit}
          onBlur={onCommit}
        />
      )

    case 'number':
      return (
        <input
          id={id}
          className="of-gen-number"
          type="number"
          inputMode="decimal"
          value={typeof value === 'number' ? value : 0}
          aria-describedby={describedBy}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(next)
          }}
          onBlur={onCommit}
        />
      )

    case 'boolean':
      return (
        <input
          id={id}
          className="of-gen-check"
          type="checkbox"
          checked={value === true}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange(event.target.checked)
            onCommit?.()
          }}
        />
      )

    case 'vector':
      return (
        <input
          id={id}
          className="of-gen-text"
          type="text"
          value={Array.isArray(value) ? value.join(', ') : ''}
          aria-describedby={describedBy}
          onChange={(event) => {
            const parts = event.target.value.split(',').map((part) => Number(part.trim()))
            if (parts.every((part) => Number.isFinite(part))) onChange(parts)
          }}
          onBlur={onCommit}
        />
      )

    case 'string':
      return (
        <input
          id={id}
          className="of-gen-text"
          type="text"
          value={typeof value === 'string' ? value : ''}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onBlur={onCommit}
        />
      )
  }
}
