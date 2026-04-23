import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { persons, type Person } from '../api'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import Modal from '../components/Modal'

function PersonForm({ initial, onSave, onCancel }: {
  initial?: Partial<Person>
  onSave: (d: Omit<Person, 'id'>) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    sage_employee_name: initial?.sage_employee_name ?? '',
    default_weekly_hours: initial?.default_weekly_hours ?? 40,
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div>
        <label htmlFor="person-name" className="block text-xs font-medium text-gray-600 mb-1">Name (Anzeige)</label>
        <input id="person-name"
          required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="person-sage" className="block text-xs font-medium text-gray-600 mb-1">Sage-Mitarbeitername</label>
        <input id="person-sage"
          required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.sage_employee_name}
          onChange={(e) => setForm({ ...form, sage_employee_name: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="person-hours" className="block text-xs font-medium text-gray-600 mb-1">Wochenstunden (Standard)</label>
        <input id="person-hours"
          required type="number" min={1} max={60} step={0.5}
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.default_weekly_hours}
          onChange={(e) => setForm({ ...form, default_weekly_hours: parseFloat(e.target.value) })}
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
        <button type="submit"
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Speichern
        </button>
      </div>
    </form>
  )
}

export default function PersonsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data = [], isLoading } = useQuery({
    queryKey: ['persons'],
    queryFn: persons.list,
  })

  const create = useMutation({
    mutationFn: persons.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['persons'] }); setShowCreate(false) },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: persons.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persons'] }),
  })

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'sage_employee_name', header: 'Sage-Name' },
    {
      key: 'default_weekly_hours', header: 'Wochenstunden',
      render: (p: Person) => `${p.default_weekly_hours} h`,
    },
    {
      key: 'actions', header: '',
      render: (p: Person) => (
        <button
          aria-label={`${p.name} löschen`}
          onClick={(e) => { e.stopPropagation(); remove.mutate(p.id) }}
          className="text-gray-400 hover:text-red-500 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Personen"
        subtitle={`${data.length} Mitarbeiter`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={14} /> Neu
          </button>
        }
      />
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">{error}</div>
      )}
      <div className="p-6">
        {isLoading ? (
          <p className="text-sm text-gray-400">Lade…</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <Table columns={columns} rows={data} keyFn={(p) => p.id} />
          </div>
        )}
      </div>
      {showCreate && (
        <Modal title="Neue Person" onClose={() => { setShowCreate(false); setError(null) }}>
          <PersonForm onSave={(d) => create.mutate(d)} onCancel={() => setShowCreate(false)} />
        </Modal>
      )}
    </div>
  )
}
