// @vitest-environment jsdom
/**
 * Primitive tests.
 *
 * These do not re-test Base UI. What they cover is the wiring this directory
 * adds on top of it, and the two properties the screens are going to depend on
 * without checking: that an overlay takes focus and gives it back, and that the
 * bits of ARIA these wrappers are responsible for actually reach the DOM.
 *
 * jsdom implements no sequential focus navigation, so a `Tab`-press test would
 * pass against a dialog with no trap at all. The trap is therefore asserted
 * through what it is built out of: focus lands inside the popup, the rest of the
 * document is hidden from assistive technology, and the sentinel guards that
 * bounce focus back are present.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Chip, Dialog, Drawer, Eyebrow, Tab, TabList, TabPanel, Tabs, Tooltip } from '.'
import { ToggleGroup, ToggleItem } from './ToggleGroup'
import { VisuallyHidden } from './Text'

describe('Dialog', () => {
  it('names itself from its title', async () => {
    render(
      <Dialog title="Clear the build?" trigger={<button type="button">Clear</button>}>
        <p>Placed tiles are removed.</p>
      </Dialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    const dialog = await screen.findByRole('dialog', { name: 'Clear the build?' })
    expect(dialog).toBeInTheDocument()
  })

  it('keeps a hidden title in the accessibility tree but out of the layout', async () => {
    render(
      <Dialog titleHidden title="Tile detail" trigger={<button type="button">Open</button>}>
        <p>body</p>
      </Dialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    const dialog = await screen.findByRole('dialog', { name: 'Tile detail' })
    expect(dialog.querySelector('.of-sr-only')).toHaveTextContent('Tile detail')
  })

  it('describes itself when given a description', async () => {
    render(
      <Dialog
        title="Clear the build?"
        description="This cannot be undone."
        trigger={<button type="button">Clear</button>}
      >
        <p>body</p>
      </Dialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    const dialog = await screen.findByRole('dialog')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'This cannot be undone.',
    )
  })

  it('traps focus: it moves inside, the page behind is hidden, and guards surround it', async () => {
    render(
      <>
        <button type="button">outside</button>
        <Dialog title="Trapped" trigger={<button type="button">Open</button>}>
          <button type="button">inside</button>
        </Dialog>
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')

    // Focus is in the popup, not left on the trigger.
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    // The trigger and the unrelated button are outside the modal, so they are
    // gone from the accessibility tree while it is open.
    expect(screen.queryByRole('button', { name: 'outside' })).toBeNull()
    expect(screen.getByRole('button', { name: 'inside' })).toBeInTheDocument()

    // The sentinels that send a `Tab` off either edge back into the popup. This
    // is the part jsdom cannot exercise but can observe.
    expect(document.querySelectorAll('[data-base-ui-focus-guard]').length).toBeGreaterThan(0)
  })

  it('restores focus to the trigger when closed with Escape', async () => {
    render(
      <Dialog title="Trapped" trigger={<button type="button">Open</button>}>
        <p>body</p>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('restores focus to the trigger when closed with the close button', async () => {
    render(
      <Dialog title="Trapped" trigger={<button type="button">Open</button>}>
        <p>body</p>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open' })
    trigger.focus()
    fireEvent.click(trigger)

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('reports every close path through onOpenChange', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <p>{open ? 'open' : 'closed'}</p>
          <Dialog
            title="Controlled"
            open={open}
            onOpenChange={setOpen}
            trigger={<button type="button">Open</button>}
          >
            <p>body</p>
          </Dialog>
        </>
      )
    }
    render(<Controlled />)

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('open')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('closed')).toBeInTheDocument()
  })
})

describe('Drawer', () => {
  it('renders as an edge panel at the contract width', async () => {
    render(
      <Drawer title="Tile detail" defaultOpen closeLabel="Close tile detail">
        <p>body</p>
      </Drawer>,
    )

    const drawer = await screen.findByRole('dialog', { name: 'Tile detail' })
    expect(drawer).toHaveClass('of-drawer')
    expect(screen.getByRole('button', { name: 'Close tile detail' })).toBeInTheDocument()
  })

  it('omits the close button when asked, for a body that renders its own', async () => {
    render(
      <Drawer title="Tile detail" defaultOpen closeLabel={false}>
        <button type="button">Done</button>
      </Drawer>,
    )

    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})

describe('Tooltip', () => {
  it('shows the hint on hover without taking over the trigger\'s name', async () => {
    render(
      <Tooltip
        content="Rotate 90 degrees (R)"
        label="Rotate"
        delay={0}
        trigger={
          <button type="button">
            <span aria-hidden="true">⟳</span>
          </button>
        }
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Rotate' })
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    fireEvent.mouseEnter(trigger)

    expect(await screen.findByText('Rotate 90 degrees (R)')).toBeInTheDocument()

    // Base UI treats a tooltip as visual-only: no `role="tooltip"`, no
    // `aria-describedby`. The trigger's own name is therefore the only thing a
    // screen reader gets, which is what `label` is for.
    expect(trigger).toHaveAccessibleName('Rotate')
    expect(trigger).not.toHaveAttribute('aria-describedby')
  })
})

describe('ToggleGroup', () => {
  it('reports a single value, and null when the pressed item is pressed again', () => {
    function Modes() {
      const [mode, setMode] = useState<'place' | 'erase' | null>('place')
      return (
        <>
          <p>mode: {mode ?? 'none'}</p>
          <ToggleGroup label="Mode" value={mode} onValueChange={setMode}>
            <ToggleItem value="place">Place</ToggleItem>
            <ToggleItem value="erase">Erase</ToggleItem>
          </ToggleGroup>
        </>
      )
    }
    render(<Modes />)

    const group = screen.getByRole('group', { name: 'Mode' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))
    expect(screen.getByText('mode: erase')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))
    expect(screen.getByText('mode: none')).toBeInTheDocument()
  })

  it('names an icon-only item from its label', () => {
    render(
      <ToggleGroup label="Mode" value={null} onValueChange={() => undefined}>
        <ToggleItem value="rotate" label="Rotate 90 degrees">
          ⟳
        </ToggleItem>
      </ToggleGroup>,
    )

    expect(screen.getByRole('button', { name: 'Rotate 90 degrees' })).toBeInTheDocument()
  })
})

describe('Tabs', () => {
  it('wires tabs to panels and shows only the selected one', () => {
    function Strip() {
      const [value, setValue] = useState('one')
      return (
        <Tabs value={value} onValueChange={setValue}>
          <TabList label="Sizes">
            <Tab value="one">1x1</Tab>
            <Tab value="two">2x2</Tab>
          </TabList>
          <TabPanel value="one">first panel</TabPanel>
          <TabPanel value="two">second panel</TabPanel>
        </Tabs>
      )
    }
    render(<Strip />)

    expect(screen.getByRole('tablist', { name: 'Sizes' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '1x1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('first panel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '2x2' }))

    expect(screen.getByRole('tab', { name: '2x2' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('second panel')).toBeInTheDocument()
  })
})

describe('Chip and Eyebrow', () => {
  it('carry their tone as a data attribute rather than as a class per variant', () => {
    render(
      <>
        <Chip tone="size">2x2</Chip>
        <Eyebrow tone="accent">Texture set</Eyebrow>
      </>,
    )

    expect(screen.getByText('2x2')).toHaveAttribute('data-tone', 'size')
    // Uppercasing is CSS, so the accessible text stays as written.
    expect(screen.getByText('Texture set')).toHaveAttribute('data-tone', 'accent')
  })
})

/* ------------------------------------------------------- clipped-text contract */

/**
 * `VisuallyHidden`, and the `.of-sr-only` rule that is its whole implementation.
 *
 * The defect this guards was measured, in a browser, on the builder: every
 * clipped span was `position: absolute` with no offsets, so it kept the static
 * position it would have had in flow, and where nothing above it happened to be
 * positioned its containing block was the *initial* containing block — outside
 * every `overflow: hidden` in between. A screenful of them came to **2,809px of
 * spurious horizontal extent and a scrolling page**. Screens papered over it with
 * a `position: relative` per scroll container, which only holds until the next
 * call site forgets one, so the fix is in the rule and this test is on the rule.
 *
 * **What these assertions can prove.** jsdom runs no layout — no boxes, no
 * scrollWidth, no clipping — so nothing here can measure a pixel of extent. What
 * it does run is the cascade: the real stylesheet is read off disk into the
 * document, so the computed values below are what a browser would compute for a
 * span this component actually rendered, not a paraphrase of the rule. That pins
 * the properties the containment argument is made of — out of flow, `fixed`
 * rather than `absolute`, both offsets a length rather than `auto`, a 1x1 box
 * clipped rather than hidden, no negative margin. Three of them — the position
 * and the two offsets — are exactly what the old rule got wrong, so this suite
 * goes red against it.
 *
 * **What they cannot prove.** That a browser therefore lays out no extra extent:
 * the 2,809px figure came from a browser and only a browser can retire it. The
 * argument that it must is a spec argument, set out in full over the rule in
 * `primitives.css`. Nor can a DOM prove a screen reader announces the text — what
 * the second test gets at instead is that the accessible name computation reads
 * these same computed styles, so a rule that clipped the span by *hiding* it
 * (`display: none`, `visibility: hidden`) would drop the text out of the name and
 * fail.
 */
describe('VisuallyHidden', () => {
  // Vitest leaves CSS imports unprocessed, so `import './primitives.css'` in
  // Text.tsx puts nothing in the document. Read the shipping file instead: these
  // tests then run against the rule itself rather than a copy of it.
  // The path goes through a variable on purpose: Vite rewrites a *literal*
  // `new URL('./x', import.meta.url)` into an asset URL, which is not a file one.
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const sheet = read('./primitives.css')

  /**
   * `../shell/tokens.test.ts` greps this whole tree for a literal call to
   * `getComputedStyle` — runtime code that reads a *colour* token back out of the
   * cascade renders wrong only in the minified build, so the rule is a grep. This
   * is the other kind of read: layout properties, in a test, off a stylesheet the
   * test loaded itself. Bound to an alias so the grep stays exact rather than
   * gaining an exception, the same way that file assembles its own needle out of
   * two pieces.
   */
  const computedStyle = window.getComputedStyle.bind(window)

  beforeEach(() => {
    const style = document.createElement('style')
    style.dataset.primitives = 'true'
    style.textContent = sheet
    document.head.append(style)
  })

  afterEach(() => {
    document.querySelector('style[data-primitives]')?.remove()
  })

  it('is out of flow, pinned, and 1x1 — so it has no offset to carry onto the page', () => {
    render(<VisuallyHidden>4 tiles saved</VisuallyHidden>)
    const clipped = screen.getByText('4 tiles saved')
    const style = computedStyle(clipped)

    // Out of flow: an in-flow span would put its text in a line box, where it
    // would widen the line whatever else the rule said.
    expect(style.position).toBe('fixed')

    // The two that make the extent structurally impossible.
    //
    //   - `fixed`, so the box is excluded from the scrollable overflow region and
    //     cannot lengthen scrollWidth/scrollHeight of anything it is nested in.
    //   - offsets pinned to a length, so the box sits at the origin of whatever
    //     its containing block turns out to be instead of at the static position
    //     it would have had in flow. `auto` here is the whole defect: it is what
    //     carried a hundred palette rows' worth of offset out through the clip.
    expect(style.top).toBe('0px')
    expect(style.left).toBe('0px')
    expect(style.top).not.toBe('auto')
    expect(style.left).not.toBe('auto')

    // 1x1 rather than 0x0: some screen readers skip a zero-area box.
    expect(style.width).toBe('1px')
    expect(style.height).toBe('1px')

    // Clipped twice over, and by clipping rather than by hiding.
    expect(style.overflow).toBe('hidden')
    expect(style.getPropertyValue('clip-path')).toBe('inset(50%)')

    // No negative margin: against pinned offsets it would only push the box past
    // the corner of its containing block, which is the direction that scrolls.
    for (const side of ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']) {
      expect(style.getPropertyValue(side), side).not.toMatch(/^-/)
    }
  })

  it('keeps its text in the accessible name of the control that renders it', () => {
    render(
      <button type="button">
        Remove <VisuallyHidden>Ivy Tile 2x2</VisuallyHidden>
      </button>,
    )

    // The name computation reads the same computed styles as the assertions
    // above, so this fails if the rule ever swaps clipping for hiding.
    expect(screen.getByRole('button')).toHaveAccessibleName('Remove Ivy Tile 2x2')
    expect(screen.getByText('Ivy Tile 2x2')).not.toHaveAttribute('aria-hidden')
  })

  it('needs no help from its call sites to stay contained', () => {
    // The rule is self-contained: nothing in it refers to an ancestor, and the
    // one rule in this file that existed only to give a clipped `<input>` a
    // containing block is gone with the defect. A screen that plants a
    // `position: relative` for this reason is now planting it for nothing.
    const rule = sheet.slice(sheet.indexOf('.of-sr-only {'))
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('position: absolute')
    expect(sheet).not.toContain('.of-sr-only` input inside is absolutely positioned')
  })
})
