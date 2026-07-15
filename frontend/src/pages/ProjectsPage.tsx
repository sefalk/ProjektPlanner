import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { projects, type Project, type ProjectStats } from '../api'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import Modal from '../components/Modal'

const STATUS_LABELS: Record<Project['status'], string> = {
  planned: 'Geplant',
  active: 'Aktiv',
  completed: 'Abgeschlossen',
  archived: 'Archiviert',
}

const STATUS_COLORS: Record<Project['status'], string> = {
  planned: 'bg-yellow-100 text-yellow-700',
  active: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  archived: 'bg-gray-100 text-gray-500',
}

function ProjectForm({ initial, onSave, onCancel }: {
  initial?: Partial<Project>
  onSave: (d: Omit<Project, 'id'>) => void
  onCancel: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    project_number: initial?.project_number ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    start_date: initial?.start_date ?? '',
    end_date: initial?.end_date ?? '',
    total_budget_hours: initial?.total_budget_hours ?? null as number | null,
    total_budget_euros: initial?.total_budget_euros ?? 0,
    holiday_country: initial?.holiday_country ?? 'DE',
    holiday_state: initial?.holiday_state ?? 'BY',
    status: initial?.status ?? 'active' as Project['status'],
    program_id: initial?.program_id ?? null,
    sick_days_per_year_override: initial?.sick_days_per_year_override ?? null,
    training_days_per_year_override: initial?.training_days_per_year_override ?? null,
  })

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const data = { ...form }
    if (!initial?.status && data.start_date > today) {
      data.status = 'planned'
    }
    onSave(data)
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
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
          <label htmlFor="proj-budget-euros" className="block text-xs font-medium text-gray-600 mb-1">Budget (€)</label>
          <input id="proj-budget-euros"
            required type="number" min={0} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.total_budget_euros ?? ''}
            onChange={(e) => setForm({ ...form, total_budget_euros: e.target.value ? parseFloat(e.target.value) : 0 })}
          />
        </div>
      </div>
      <div>
        <label htmlFor="proj-budget" className="block text-xs font-medium text-gray-600 mb-1">Budget (Std.) <span className="font-normal text-gray-400">optional</span></label>
        <input id="proj-budget"
          type="number" min={0} step={0.01}
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.total_budget_hours ?? ''}
          onChange={(e) => setForm({ ...form, total_budget_hours: e.target.value ? parseFloat(e.target.value) : null })}
        />
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
      <div>
        <label htmlFor="proj-status" className="block text-xs font-medium text-gray-600 mb-1">Status</label>
        <select id="proj-status"
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value as Project['status'] })}
        >
          {(Object.keys(STATUS_LABELS) as Project['status'][]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
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
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projects.list,
  })
  const { data: statsData = [] } = useQuery({
    queryKey: ['projects-stats'],
    queryFn: projects.stats,
  })
  const statsMap = Object.fromEntries(statsData.map((s: ProjectStats) => [s.project_id, s]))

  const create = useMutation({
    mutationFn: projects.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setShowCreate(false); setError(null) },
    onError: (e: Error) => setError(e.message),
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Project, 'id'> }) => projects.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setEditProject(null); setError(null) },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: number) => projects.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setConfirmDelete(null) },
    onError: (e: Error) => setError(e.message),
  })

  const columns = [
    { key: 'project_number', header: 'Nummer' },
    { key: 'start_date', header: 'Start' },
    { key: 'name', header: 'Name' },
    {
      key: 'status', header: 'Status',
      render: (p: Project) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}>
          {STATUS_LABELS[p.status]}
        </span>
      ),
    },
    { key: 'end_date', header: 'Ende' },
    {
      key: 'budget', header: 'Budget',
      render: (p: Project) => {
        const euros = p.total_budget_euros
        const hours = p.total_budget_hours
        return (
          <div className="text-xs text-gray-700 space-y-0.5">
            <div className="font-medium">{euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            {hours != null && (
              <div className="text-gray-400">{hours.toLocaleString('de-DE')} Std.</div>
            )}
          </div>
        )
      },
    },
    {
      key: 'milestones', header: 'Meilensteine',
      render: (p: Project) => {
        const s: ProjectStats | undefined = statsMap[p.id]
        if (!s || s.open_milestones === 0) return <span className="text-xs text-gray-400">–</span>
        return (
          <div className="flex items-center gap-1.5">
            {s.overdue_milestones > 0 && (
              <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                {s.overdue_milestones} überfällig
              </span>
            )}
            {s.open_milestones - s.overdue_milestones > 0 && (
              <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                {s.open_milestones - s.overdue_milestones} offen
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'actions', header: '',
      render: (p: Project) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            aria-label={`${p.name} bearbeiten`}
            onClick={() => { setEditProject(p); setError(null) }}
            className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            aria-label={`${p.name} löschen`}
            onClick={() => setConfirmDelete(p)}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ]

  const filtered = data
    .filter((p) => statusFilter === 'all' || p.status === statusFilter)
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.project_number.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <PageHeader
        title="Projekte"
        subtitle={`${data.length} Projekte · Verwalte Projektbudgets, Meilensteine und Abrechnungen`}
        actions={
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded">
              <option value="all">Alle Status</option>
              <option value="planned">Geplant</option>
              <option value="active">Aktiv</option>
              <option value="completed">Abgeschlossen</option>
              <option value="archived">Archiviert</option>
            </select>
            <input
              type="search" placeholder="Suchen…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
            />
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              <Plus size={14} /> Neues Projekt
            </button>
          </div>
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
              rows={filtered}
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

      {editProject && (
        <Modal title="Projekt bearbeiten" onClose={() => { setEditProject(null); setError(null) }}>
          <ProjectForm
            initial={editProject}
            onSave={(d) => update.mutate({ id: editProject.id, data: d })}
            onCancel={() => { setEditProject(null); setError(null) }}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Projekt löschen" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-gray-700 mb-4">
            Projekt <strong>{confirmDelete.project_number} – {confirmDelete.name}</strong> wirklich löschen?
            Alle zugehörigen Daten (Meilensteine, Mitgliedschaften) werden ebenfalls entfernt.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button onClick={() => remove.mutate(confirmDelete.id)}
              className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">Löschen</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
