import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Table from '../Table'

const columns = [
  { key: 'name', header: 'Name' },
  { key: 'value', header: 'Wert' },
]

const rows = [
  { id: 1, name: 'Alpha', value: 'A' },
  { id: 2, name: 'Beta', value: 'B' },
]

describe('Table', () => {
  it('renders column headers', () => {
    render(<Table columns={columns} rows={[]} keyFn={(r) => r.id} />)
    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /wert/i })).toBeInTheDocument()
  })

  it('renders all data rows', () => {
    render(<Table columns={columns} rows={rows} keyFn={(r) => r.id} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('shows empty state when rows is empty', () => {
    render(<Table columns={columns} rows={[]} keyFn={(r) => r.id} />)
    expect(screen.getByText(/keine einträge/i)).toBeInTheDocument()
  })

  it('shows custom empty message', () => {
    render(<Table columns={columns} rows={[]} keyFn={(r) => r.id} emptyMessage="Nichts gefunden." />)
    expect(screen.getByText('Nichts gefunden.')).toBeInTheDocument()
  })

  it('calls onRowClick when a row is clicked', async () => {
    const onRowClick = vi.fn()
    render(<Table columns={columns} rows={rows} keyFn={(r) => r.id} onRowClick={onRowClick} />)
    await userEvent.click(screen.getByText('Alpha'))
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
  })

  it('renders custom cell via render function', () => {
    const cols = [
      { key: 'name', header: 'Name', render: (r: typeof rows[0]) => <strong>{r.name}!</strong> },
    ]
    render(<Table columns={cols} rows={rows} keyFn={(r) => r.id} />)
    expect(screen.getByText('Alpha!')).toBeInTheDocument()
  })

  it('has correct ARIA roles for accessibility', () => {
    render(<Table columns={columns} rows={rows} keyFn={(r) => r.id} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(2)
    expect(screen.getAllByRole('row')).toHaveLength(3) // 1 header + 2 data rows
  })
})
