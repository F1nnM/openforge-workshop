/**
 * The app's one button.
 *
 * Three rows had asked for this by the time it was written. `.of-action` in
 * `../../screens/landing/landing.css` and `.of-lib-action` in
 * `../../screens/library/library.css` had arrived independently as
 * near-identical 45-line blocks — same radius, same accent fill, same outlined
 * secondary, same `filter: brightness(1.12)` hover, same "one pixel less padding
 * on the outlined tone so the border does not make it taller" trick — and the
 * builder's toolbar wanted four more of them. The library's own stylesheet said
 * out loud that extracting this was `ui/primitives/`'s call to make; this is that
 * call.
 *
 * ## Two tones and three sizes, and nothing else
 *
 * The tones are the contract's: a filled accent primary and an outlined
 * secondary. The sizes are the three the design actually uses — `lg` is the
 * landing hero's, `md` the library head's and the bill panel's download action,
 * `sm` the builder toolbar's. Adding a fourth means finding it in
 * design-contract.md first.
 *
 * ## Why a `buttonProps()` helper exists beside the component
 *
 * Half the buttons in this app are not `<button>` elements, and correctly so:
 *
 *   - the landing hero's two actions and the library's "Open in builder" are
 *     router `Link`s, because they navigate and middle-click, cmd-click and
 *     "copy link address" all have to work;
 *   - the library's "Import JSON" is a `<label>` wrapping a clipped file input,
 *     because a file picker cannot be opened from a `<button>` without one.
 *
 * A polymorphic `as`/`render` prop would have to thread three element types'
 * props through a generic, and TanStack's `Link` props are not assignable to
 * `ComponentProps<'a'>` anyway. So the styling is published separately from the
 * element: `<Button>` for real buttons, `{...buttonProps({ tone: 'primary' })}`
 * for everything else. One set of declarations either way.
 *
 * ## The legacy class names still resolve
 *
 * `.of-action` and `.of-lib-action` are listed beside `.of-button` in
 * `primitives.css`, so the landing and library screens' stylesheets keep no
 * button declarations at all — only where a button sits in their layouts. Their
 * *markup* belongs to rows 16 and 14, which is why the class names survive the
 * extraction; when either screen's components are next opened, swapping the class
 * for this component is one line per call site and deletes both aliases.
 */
import type { ButtonHTMLAttributes } from 'react'

import './primitives.css'

/** Filled accent, or outlined accent. `primary` is one per screen region. */
export type ButtonTone = 'primary' | 'secondary'

/**
 * How large.
 *
 *   - `lg` — the landing hero. 15px, 24px of horizontal padding.
 *   - `md` — the default. The library head, the bill panel's download action.
 *   - `sm` — dense chrome: the builder's floating toolbar.
 */
export type ButtonSize = 'lg' | 'md' | 'sm'

export interface ButtonStyleProps {
  /* `| undefined` throughout, because `exactOptionalPropertyTypes` is on and
     `Button` forwards its own optional props to `buttonProps` — without it,
     "absent" and "explicitly undefined" are different types and the forward does
     not compile. */
  tone?: ButtonTone | undefined
  size?: ButtonSize | undefined
  /**
   * Stretch to the width of the container and centre the label.
   *
   * design-contract.md §2.4's "⬇ Download tile pack" is full-width in a 302px
   * panel; so is the library's empty-state action at narrow widths.
   */
  full?: boolean | undefined
  className?: string | undefined
}

/**
 * The attributes that make an element look like a button.
 *
 * Spread onto a `Link`, a `<label>`, or anything else that is not a
 * `<button>`. Returns `data-*` attributes rather than a bag of composed class
 * names so the CSS stays one block with attribute selectors, which is what keeps
 * a tone and a size from being spellable in two ways.
 */
export function buttonProps({ tone = 'secondary', size = 'md', full, className }: ButtonStyleProps = {}): {
  className: string
  'data-tone': ButtonTone
  'data-size': ButtonSize
  'data-full'?: ''
} {
  return {
    className: ['of-button', className].filter(Boolean).join(' '),
    'data-tone': tone,
    'data-size': size,
    ...(full === true ? { 'data-full': '' as const } : {}),
  }
}

export type ButtonProps = ButtonStyleProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

/**
 * A `<button>`.
 *
 * `type="button"` by default, because the HTML default is `submit` and a button
 * inside a form that meant to filter a list should not post it. Pass
 * `type="submit"` explicitly where that is the intent.
 */
export function Button({ tone, size, full, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} {...buttonProps({ tone, size, full, className })} {...rest} />
}
