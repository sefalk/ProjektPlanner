import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PageHeader from '../PageHeader'

describe('PageHeader', () => {
  it('renders title', () => {
    render(<PageHeader title="Projektverwaltung" />)
    expect(screen.getByRole('heading', { name: 'Projektverwaltung' })).toBeInTheDocument()
  })

  it('renders subtitle when provided', () => {
    render(<PageHeader title="Projekte" subtitle="5 Projekte" />)
    expect(screen.getByText('5 Projekte')).toBeInTheDocument()
  })

  it('does not render subtitle element when omitted', () => {
    const { container } = render(<PageHeader title="Projekte" />)
    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('renders actions slot', () => {
    render(<PageHeader title="Test" actions={<button>Neu</button>} />)
    expect(screen.getByRole('button', { name: 'Neu' })).toBeInTheDocument()
  })

  it('renders back navigation slot', () => {
    render(<PageHeader title="Detail" back={<a href="/list">Zurück</a>} />)
    expect(screen.getByRole('link', { name: 'Zurück' })).toBeInTheDocument()
  })
})
