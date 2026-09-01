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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Chip, Dialog, Drawer, Eyebrow, Tab, TabList, TabPanel, Tabs, Tooltip } from '.'
import { ToggleGroup, ToggleItem } from './ToggleGroup'

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
