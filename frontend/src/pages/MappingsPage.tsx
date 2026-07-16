import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { mappings, positionMappings, projects, type SageProjectMapping } from '../api'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import Modal from '../components/Modal'

function MappingForm({ initial, onSave, onCancel }: {
  initial?: SageProjectMapping
  onSave: (d: { sage_project_name: string; project_id: number }) => void
  onCancel: () => void
}) {
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projects.list })
  const [form, setForm] = useState({
    sage_project_name: initial?.sage_project_name ?? '',
    project_id: initial?.project_id ?? 0,
  })
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

/** Level → line item mapping per project (§21 P6). Only projects with priced positions
 *  (position mode) need these; the section guides the user to configure them. */
function PositionMappingsSection() {
  const qc = useQueryClient()
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projects.list })
  const [projectId, setProjectId] = useState<number>(0)
  const [level, setLevel] = useState('')
  const [posId, setPosId] = useState<number>(0)

  const { data: positions = [] } = useQuery({
    queryKey: ['billingPositions', projectId],
    queryFn: () => projects.billingPositions(projectId),
    enabled: projectId > 0,
  })
  const { data: mapList = [] } = useQuery({
    queryKey: ['positionMappings', projectId],
    queryFn: () => positionMappings.list(projectId),
    enabled: projectId > 0,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['positionMappings', projectId] })
  const create = useMutation({
    mutationFn: () => positionMappings.create({ project_id: projectId, sage_project_level: level.trim(), billing_position_id: posId }),
    onSuccess: () => { setLevel(''); setPosId(0); invalidate() },
  })
  const remove = useMutation({
    mutationFn: (id: number) => positionMappings.delete(id),
    onSuccess: invalidate,
  })

  const posLabel = (id: number) => {
    const p = positions.find((x) => x.id === id)
    return p ? `${p.position_number}${p.description ? ` – ${p.description}` : ''}` : String(id)
  }
  const priced = positions.filter((p) => p.billing_rate_per_hour > 0)

  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-gray-700 mb-1">Posten-Zuordnung (Projektebene 1 → Posten)</h3>
      <p className="text-xs text-gray-400 mb-3 max-w-2xl">
        Nur für Projekte im Posten-Modus (mit bepreisten Posten). Ordnet die Sage-„Projektebene 1"
        einem Projektposten zu, damit Buchungen beim Import dem richtigen Posten zugeordnet werden.
      </p>
      <div className="max-w-md mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Projekt</label>
        <select className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
          value={projectId} onChange={(e) => { setProjectId(parseInt(e.target.value) || 0); setPosId(0); setLevel('') }}>
          <option value={0}>— Projekt wählen —</option>
          {projectList.map((p) => <option key={p.id} value={p.id}>{p.project_number} – {p.name}</option>)}
        </select>
      </div>

      {projectId > 0 && (
        priced.length === 0 ? (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 max-w-md">
            Dieses Projekt hat keine bepreisten Posten (Simple-Modus) — keine Ebenen-Zuordnung nötig.
          </p>
        ) : (
          <div className="max-w-2xl space-y-3">
            {mapList.length > 0 && (
              <div className="bg-white rounded border border-gray-200 divide-y divide-gray-100">
                {mapList.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">{m.sage_project_level}</span>
                      <span className="mx-1.5 text-gray-300">→</span>
                      <span className="text-gray-600">{posLabel(m.billing_position_id)}</span>
                    </div>
                    <button onClick={() => remove.mutate(m.id)} aria-label="Zuordnung löschen"
                      className="p-1 text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); create.mutate() }} className="flex gap-2 items-end flex-wrap">
              <div className="flex-1 min-w-[10rem]">
                <label className="block text-xs text-gray-500 mb-1">Projektebene 1 (Sage)</label>
                <input required placeholder="z.B. Development"
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm"
                  value={level} onChange={(e) => setLevel(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[10rem]">
                <label className="block text-xs text-gray-500 mb-1">Posten</label>
                <select required className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm"
                  value={posId} onChange={(e) => setPosId(parseInt(e.target.value) || 0)}>
                  <option value={0} disabled>— wählen —</option>
                  {priced.map((p) => <option key={p.id} value={p.id}>{p.position_number}{p.description ? ` – ${p.description}` : ''}</option>)}
                </select>
              </div>
              <button type="submit" disabled={create.isPending || !level.trim() || !posId}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap">
                <Plus size={13} /> Zuordnen
              </button>
            </form>
          </div>
        )
      )}
    </div>
  )
}

export default function MappingsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editMapping, setEditMapping] = useState<SageProjectMapping | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SageProjectMapping | null>(null)

  const { data = [], isLoading } = useQuery({ queryKey: ['mappings'], queryFn: mappings.list })
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projects.list })
  const projectName = (id: number) => projectList.find((p) => p.id === id)?.project_number ?? String(id)

  const create = useMutation({
    mutationFn: mappings.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mappings'] }); setShowCreate(false) },
  })
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { sage_project_name: string; project_id: number } }) =>
      mappings.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mappings'] }); setEditMapping(null) },
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
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            aria-label={`Mapping ${m.sage_project_name} bearbeiten`}
            onClick={() => setEditMapping(m)}
            className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            aria-label={`Mapping ${m.sage_project_name} löschen`}
            onClick={() => setConfirmDelete(m)}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Sage-Projekt-Mapping"
        subtitle="Verknüpfung von Sage-Projektnamen mit internen Projekten"
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
        <PositionMappingsSection />
      </div>

      {showCreate && (
        <Modal title="Neues Mapping" onClose={() => setShowCreate(false)}>
          <MappingForm onSave={(d) => create.mutate(d)} onCancel={() => setShowCreate(false)} />
        </Modal>
      )}

      {editMapping && (
        <Modal title="Mapping bearbeiten" onClose={() => setEditMapping(null)}>
          <MappingForm
            initial={editMapping}
            onSave={(d) => update.mutate({ id: editMapping.id, data: d })}
            onCancel={() => setEditMapping(null)}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Mapping löschen" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Mapping <strong>{confirmDelete.sage_project_name}</strong> löschen?
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button
              onClick={() => { remove.mutate(confirmDelete.id); setConfirmDelete(null) }}
              className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">
              Löschen
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
