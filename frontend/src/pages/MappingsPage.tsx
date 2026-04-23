import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { mappings, projects, type SageProjectMapping } from '../api'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import Modal from '../components/Modal'

function MappingForm({ onSave, onCancel }: {
  onSave: (d: { sage_project_name: string; project_id: number }) => void
  onCancel: () => void
}) {
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projects.list })
  const [form, setForm] = useState({ sage_project_name: '', project_id: 0 })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div>
        <label htmlFor="map-sage-name" className="block text-xs font-medium text-gray-600 mb-1">Sage-Projektname</label>
        <input id="map-sage-name" required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.sage_project_name}
          onChange={(e) => setForm({ ...form, sage_project_name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="map-project" className="block text-xs font-medium text-gray-600 mb-1">Intern. Projekt</label>
        <select id="map-project" required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.project_id}
          onChange={(e) => setForm({ ...form, project_id: parseInt(e.target.value) })}>
          <option value={0} disabled>— bitte wählen —</option>
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>{p.project_number} – {p.name}</option>
          ))}
        </select>
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

export default function MappingsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data = [], isLoading } = useQuery({ queryKey: ['mappings'], queryFn: mappings.list })
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projects.list })
  const projectName = (id: number) => projectList.find((p) => p.id === id)?.project_number ?? String(id)

  const create = useMutation({
    mutationFn: mappings.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mappings'] }); setShowCreate(false) },
  })
  const remove = useMutation({
    mutationFn: mappings.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mappings'] }),
  })

  const columns = [
    { key: 'sage_project_name', header: 'Sage-Projektname' },
    {
      key: 'project_id', header: 'Internes Projekt',
      render: (m: SageProjectMapping) => projectName(m.project_id),
    },
    {
      key: 'actions', header: '',
      render: (m: SageProjectMapping) => (
        <button aria-label={`Mapping ${m.sage_project_name} löschen`} onClick={(e) => { e.stopPropagation(); remove.mutate(m.id) }}
          className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Sage-Projekt-Mapping" subtitle="Verknüpfung von Sage-Namen mit internen Projekten"
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
            <Table columns={columns} rows={data} keyFn={(m) => m.id} />
          </div>
        )}
      </div>
      {showCreate && (
        <Modal title="Neues Mapping" onClose={() => setShowCreate(false)}>
          <MappingForm onSave={(d) => create.mutate(d)} onCancel={() => setShowCreate(false)} />
        </Modal>
      )}
    </div>
  )
}
