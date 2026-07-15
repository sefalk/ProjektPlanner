import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PageIntro from '../PageIntro'
import HelpDrawer from '../HelpDrawer'
import HelpPopover from '../HelpPopover'

describe('PageIntro', () => {
  it('renders the intro text', () => {
    render(<PageIntro text="Kurzbeschreibung des Bereichs" />)
    expect(screen.getByText('Kurzbeschreibung des Bereichs')).toBeInTheDocument()
  })

  it('shows no help trigger when no helpContent is given', () => {
    render(<PageIntro text="Nur Text" />)
    expect(screen.queryByRole('button', { name: /hilfe/i })).not.toBeInTheDocument()
  })

  it('opens the help drawer with content on click', async () => {
    render(
      <PageIntro text="Mit Hilfe" helpTitle="Hilfetitel" helpContent={<p>Ausführliche Erklärung</p>} />
    )
    expect(screen.queryByText('Ausführliche Erklärung')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /hilfe/i }))
    expect(screen.getByText('Hilfetitel')).toBeInTheDocument()
    expect(screen.getByText('Ausführliche Erklärung')).toBeInTheDocument()
  })
})

describe('HelpDrawer', () => {
  it('renders title and content and closes via the X button', async () => {
    const onClose = vi.fn()
    render(
      <HelpDrawer title="Drawer-Titel" onClose={onClose}>
        <p>Drawer-Inhalt</p>
      </HelpDrawer>
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Drawer-Inhalt')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /schließen/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('HelpPopover', () => {
  it('toggles the explanation on click', async () => {
    render(<HelpPopover>Kurzformel hier</HelpPopover>)
    expect(screen.queryByText('Kurzformel hier')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /erklärung/i }))
    expect(screen.getByText('Kurzformel hier')).toBeInTheDocument()
  })
})
