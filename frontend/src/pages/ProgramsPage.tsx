import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { programs, type Program } from '../api'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import Modal from '../components/Modal'

function ProgramForm({ onSave, onCancel }: {
  onSave: (d: Omit<Program, 'id'>) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({ program_number: '', name: '', customer: '' })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Programmnummer</label>
        <input required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.program_number}
          onChange={(e) => setForm({ ...form, program_number: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Kunde</label>
        <input required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.customer}
          onChange={(e) => setForm({ ...form, customer: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
        <button type="submit"
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
      </div>
    </form>
  )
}

export default function ProgramsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data = [], isLoading } = useQuery({ queryKey: ['programs'], queryFn: programs.list })

  const create = useMutation({
    mutationFn: programs.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programs'] }); setShowCreate(false) },
  })

  const remove = useMutation({
    mutationFn: programs.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs'] }),
  })

  const columns = [
    { key: 'program_number', header: 'Nummer' },
    { key: 'name', header: 'Name' },
    { key: 'customer', header: 'Kunde' },
    {
      key: 'actions', header: '',
      render: (p: Program) => (
        <button onClick={(e) => { e.stopPropagation(); remove.mutate(p.id) }}
          className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Programme" subtitle={`${data.length} Programme`}
        actions={
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            <Plus size={14} /> Neu
          </button>
        }
      />
      <div className="p-6">
        {isLoading ? <p className="text-sm text-gray-400">Lade…</p> : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <Table columns={columns} rows={data} keyFn={(p) => p.id} />
          </div>
        )}
      </div>
      {showCreate && (
        <Modal title="Neues Programm" onClose={() => setShowCreate(false)}>
          <ProgramForm onSave={(d) => create.mutate(d)} onCancel={() => setShowCreate(false)} />
        </Modal>
      )}
    </div>
  )
}
