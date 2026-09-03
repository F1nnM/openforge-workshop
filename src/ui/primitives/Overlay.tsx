/**
 * Dialog and Drawer — the app's two modal surfaces.
 *
 * Both are the same Base UI `Dialog` with different geometry, which is the point
 * of putting them in one file: there is one focus model in the app, not two. The
 * behaviour that matters comes from Base UI and is not reimplemented here —
 * focus is trapped while open, `Escape` and a backdrop press close, the page
 * behind is inert and cannot scroll, and focus returns to whatever opened the
 * overlay when it closes.
 *
 * ## Why not Base UI's `Drawer`
 *
 * Base UI 1.7 ships a real `Drawer` with swipe-to-dismiss, snap points and a
 * bleed offset so an over-swipe does not show the page behind. It was not used.
 * design-contract.md §2.5 asks for a 442px right-hand panel that closes on a
 * backdrop press or `Escape` — no snap points, no handle, no swipe — and §2.4's
 * builder is an explicitly fixed three-column desktop layout, so the gesture
 * would go unused on the one screen the drawer opens over. What it would cost is
 * `Drawer.Viewport` plus roughly forty lines of `--drawer-swipe-*` and `--bleed`
 * arithmetic, and a second focus model to keep in step with this one. If a touch
 * layout ever arrives, swapping the implementation behind {@link Drawer} is a
 * change to this file and nothing else.
 *
 * ## The shape of the API
 *
 * `title` is required and is not optional-with-a-fallback, because a modal
 * without an accessible name is the single most common dialog defect. Where the
 * design shows no visible heading — §2.5's drawer opens on a mono eyebrow, not
 * an `<h2>` — pass `titleHidden` and the name stays in the accessibility tree
 * while leaving the visible layout to the screen.
 */
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ReactElement, ReactNode, RefObject } from 'react'

import './primitives.css'

export interface DialogProps {
  /**
   * Accessible name, and the visible heading unless `titleHidden` is set.
   *
   * Required: Base UI wires `aria-labelledby` from `Dialog.Title`, and a dialog
   * with no name is announced as an unlabelled group.
   */
  title: ReactNode
  /** Keep the name in the accessibility tree but out of the layout. */
  titleHidden?: boolean
  /** Optional supporting line. Wired to `aria-describedby` when present. */
  description?: ReactNode
  /**
   * The element that opens the overlay.
   *
   * Composed via Base UI's `render` prop, so the child keeps its own styling and
   * gains the trigger's ARIA wiring and ref. Omit it for an overlay whose open
   * state comes from somewhere else — row 15's drawer opens from `?tile=` in the
   * URL, and its "trigger" is a card that has already been clicked.
   */
  trigger?: ReactElement
  /** Controlled open state. Pair with {@link DialogProps.onOpenChange}. */
  open?: boolean
  /** Uncontrolled initial state. Ignored when `open` is set. */
  defaultOpen?: boolean
  /**
   * Called with the requested state for every close path — trigger, close
   * button, backdrop press, `Escape`.
   */
  onOpenChange?: (open: boolean) => void
  /**
   * Label for the close button in the head. Set `false` to omit the button.
   *
   * Omitting it is a deliberate accessibility trade: a touch screen-reader user
   * inside a modal has no gesture for `Escape` and no backdrop to press, so the
   * button is their only way out. Drop it only when the body renders its own.
   */
  closeLabel?: string | false
  /** Focus this instead of the first tabbable element when the overlay opens. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Added to the popup, for the width and padding overrides a screen needs. */
  className?: string
  children: ReactNode
}

/** Everything except the geometry, shared by both surfaces. */
function Overlay({
  variant,
  title,
  titleHidden = false,
  description,
  trigger,
  open,
  defaultOpen,
  onOpenChange,
  closeLabel = 'Close',
  initialFocus,
  className,
  children,
}: DialogProps & { variant: 'dialog' | 'drawer' }) {
  const popupClass = [variant === 'drawer' ? 'of-drawer' : 'of-dialog', className]
    .filter(Boolean)
    .join(' ')

  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => onOpenChange?.(next)}
    >
      {trigger ? <BaseDialog.Trigger render={trigger} /> : null}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="of-backdrop" />
        <BaseDialog.Popup className={popupClass} initialFocus={initialFocus}>
          <div className="of-overlay-head">
            <div className="of-overlay-heading">
              <BaseDialog.Title className={titleHidden ? 'of-sr-only' : 'of-overlay-title'}>
                {title}
              </BaseDialog.Title>
              {description === undefined ? null : (
                <BaseDialog.Description className="of-overlay-description">
                  {description}
                </BaseDialog.Description>
              )}
            </div>
            {closeLabel === false ? null : (
              <BaseDialog.Close className="of-overlay-close" aria-label={closeLabel}>
                <span aria-hidden="true">✕</span>
              </BaseDialog.Close>
            )}
          </div>
          <div className="of-overlay-body">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/**
 * A centred modal.
 *
 * Width comes from `--of-dialog-width` (420px), so a wider one is
 * `style={{ '--of-dialog-width': '560px' }}` rather than a new class.
 */
export function Dialog(props: DialogProps) {
  return <Overlay variant="dialog" {...props} />
}

/**
 * A right-hand edge panel — design-contract.md §2.5's tile detail drawer.
 *
 * 442px wide via `--of-drawer-width`, full height, scrolls internally with
 * `overscroll-behavior: contain` so a scroll to the end of the drawer does not
 * start scrolling the catalog behind it.
 */
export function Drawer(props: DialogProps) {
  return <Overlay variant="drawer" {...props} />
}
