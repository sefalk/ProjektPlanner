import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Modal from '../Modal'

describe('Modal', () => {
  it('renders title and children', () => {
    render(
      <Modal title="Testmodal" onClose={vi.fn()}>
        <p>Inhalt des Modals</p>
      </Modal>
    )
    expect(screen.getByText('Testmodal')).toBeInTheDocument()
    expect(screen.getByText('Inhalt des Modals')).toBeInTheDocument()
  })

  it('calls onClose when X button is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="Test" onClose={onClose}>
        <p>content</p>
      </Modal>
    )
    await userEvent.click(screen.getByRole('button', { name: /schließen/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('has dialog role and aria-modal for accessibility', () => {
    render(
      <Modal title="Barrierefreiheit" onClose={vi.fn()}>
        <p>test</p>
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
  })

  it('title is linked via aria-labelledby', () => {
    render(
      <Modal title="Mein Titel" onClose={vi.fn()}>
        <p>x</p>
      </Modal>
    )
    expect(screen.getByText('Mein Titel')).toHaveAttribute('id', 'modal-title')
  })
})
