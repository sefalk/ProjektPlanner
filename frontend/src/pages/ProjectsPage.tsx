import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { projects, type Project } from '../api'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import Modal from '../components/Modal'

const STATUS_LABELS: Record<Project['status'], string> = {
  active: 'Aktiv',
  completed: 'Abgeschlossen',
  archived: 'Archiviert',
}

const STATUS_COLORS: Record<Project['status'], string> = {
  active: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  archived: 'bg-gray-100 text-gray-500',
}

function ProjectForm({ initial, onSave, onCancel }: {
  initial?: Partial<Project>
  onSave: (d: Omit<Project, 'id'>) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    project_number: initial?.project_number ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    start_date: initial?.start_date ?? '',
    end_date: initial?.end_date ?? '',
    total_budget_hours: initial?.total_budget_hours ?? 100,
    holiday_country: initial?.holiday_country ?? 'DE',
    holiday_state: initial?.holiday_state ?? 'BY',
    status: initial?.status ?? 'active' as Project['status'],
    program_id: initial?.program_id ?? null,
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(form) }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="proj-number" className="block text-xs font-medium text-gray-600 mb-1">Projektnummer</label>
          <input id="proj-number"
            required
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.project_number}
            onChange={(e) => setForm({ ...form, project_number: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="proj-budget" className="block text-xs font-medium text-gray-600 mb-1">Budget (Std.)</label>
          <input id="proj-budget"
            required type="number" min={0.5} step={0.5}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.total_budget_hours}
            onChange={(e) => setForm({ ...form, total_budget_hours: parseFloat(e.target.value) })}
          />
        </div>
      </div>
      <div>
        <label htmlFor="proj-name" className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input id="proj-name"
          required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="proj-start" className="block text-xs font-medium text-gray-600 mb-1">Start</label>
          <input id="proj-start"
            required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="proj-end" className="block text-xs font-medium text-gray-600 mb-1">Ende</label>
          <input id="proj-end"
            required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
        <button type="submit"
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
          Speichern
        </button>
      </div>
    </form>
  )
}

export default function ProjectsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projects.list,
  })

  const create = useMutation({
    mutationFn: projects.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setShowCreate(false) },
    onError: (e: Error) => setError(e.message),
  })

  const columns = [
    { key: 'project_number', header: 'Nummer' },
    { key: 'name', header: 'Name' },
    {
      key: 'status', header: 'Status',
      render: (p: Project) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}>
          {STATUS_LABELS[p.status]}
        </span>
      ),
    },
    { key: 'start_date', header: 'Start' },
    { key: 'end_date', header: 'Ende' },
    {
      key: 'total_budget_hours', header: 'Budget (Std.)',
      render: (p: Project) => p.total_budget_hours.toLocaleString('de-DE'),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Projekte"
        subtitle={`${data.length} Projekte`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} /> Neu
          </button>
        }
      />

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
          {error}
        </div>
      )}

      <div className="p-6">
        {isLoading ? (
          <p className="text-sm text-gray-400">Lade…</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <Table
              columns={columns}
              rows={data}
              keyFn={(p) => p.id}
              onRowClick={(p) => navigate(`/projects/${p.id}`)}
            />
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="Neues Projekt" onClose={() => { setShowCreate(false); setError(null) }}>
          <ProjectForm
            onSave={(d) => create.mutate(d)}
            onCancel={() => { setShowCreate(false); setError(null) }}
          />
        </Modal>
      )}
    </div>
  )
}
