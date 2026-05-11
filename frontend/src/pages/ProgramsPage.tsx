import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { programs, type Program, type Project } from '../api'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'

function ProgramForm({ initial, onSave, onCancel }: {
  initial?: Program
  onSave: (d: Omit<Program, 'id'>) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    program_number: initial?.program_number ?? '',
    name: initial?.name ?? '',
    customer: initial?.customer ?? '',
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div>
        <label htmlFor="prog-number" className="block text-xs font-medium text-gray-600 mb-1">Programmnummer</label>
        <input id="prog-number" required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.program_number}
          onChange={(e) => setForm({ ...form, program_number: e.target.value })} />
      </div>
      <div>
        <label htmlFor="prog-name" className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input id="prog-name" required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="prog-customer" className="block text-xs font-medium text-gray-600 mb-1">Kunde</label>
        <input id="prog-customer" required
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

function ProgramRow({ program, onEdit, onDelete }: {
  program: Program
  onEdit: (p: Program) => void
  onDelete: (p: Program) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const { data: linkedProjects = [], isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ['program-projects', program.id],
    queryFn: () => programs.projects(program.id),
    enabled: expanded,
  })

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
        <td className="px-4 py-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-gray-400 hover:text-gray-700 transition-colors"
            aria-label={expanded ? 'Projekte ausblenden' : 'Projekte anzeigen'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="px-4 py-3 text-sm font-medium text-gray-700">{program.program_number}</td>
        <td className="px-4 py-3 text-sm text-gray-700">{program.name}</td>
        <td className="px-4 py-3 text-sm text-gray-600">{program.customer}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              aria-label={`${program.name} bearbeiten`}
              onClick={() => onEdit(program)}
              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
            >
              <Pencil size={13} />
            </button>
            <button
              aria-label={`${program.name} löschen`}
              onClick={() => onDelete(program)}
              className="p-1 text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-0 py-0 bg-slate-50">
            <div className="pl-12 pr-4 py-2 border-b border-slate-200">
              {loadingProjects ? (
                <p className="text-xs text-gray-400 py-1">Lade Projekte…</p>
              ) : linkedProjects.length === 0 ? (
                <p className="text-xs text-gray-400 py-1">Keine Projekte verknüpft.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left pb-1 font-medium">Nummer</th>
                      <th className="text-left pb-1 font-medium">Name</th>
                      <th className="text-left pb-1 font-medium">Start</th>
                      <th className="text-left pb-1 font-medium">Ende</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedProjects.map((p) => (
                      <tr key={p.id} className="text-gray-600">
                        <td className="py-0.5 pr-4">{p.project_number}</td>
                        <td className="py-0.5 pr-4">{p.name}</td>
                        <td className="py-0.5 pr-4">{p.start_date}</td>
                        <td className="py-0.5">{p.end_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function ProgramsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editProgram, setEditProgram] = useState<Program | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Program | null>(null)

  const { data = [], isLoading } = useQuery({ queryKey: ['programs'], queryFn: programs.list })

  const create = useMutation({
    mutationFn: programs.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programs'] }); setShowCreate(false) },
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Program, 'id'> }) => programs.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programs'] }); setEditProgram(null) },
  })

  const remove = useMutation({
    mutationFn: (id: number) => programs.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programs'] }); setConfirmDelete(null) },
  })

  return (
    <div>
      <PageHeader
        title="Hauptprojekte"
        subtitle={`${data.length} Hauptprojekte · Übergeordnete Programmstruktur mit verknüpften Projekten`}
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
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 w-8" />
                  {['Nummer', 'Name', 'Kunde', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                      Noch keine Hauptprojekte angelegt.
                    </td>
                  </tr>
                )}
                {data.map((p) => (
                  <ProgramRow
                    key={p.id}
                    program={p}
                    onEdit={(prog) => setEditProgram(prog)}
                    onDelete={(prog) => setConfirmDelete(prog)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="Neues Hauptprojekt" onClose={() => setShowCreate(false)}>
          <ProgramForm onSave={(d) => create.mutate(d)} onCancel={() => setShowCreate(false)} />
        </Modal>
      )}

      {editProgram && (
        <Modal title="Hauptprojekt bearbeiten" onClose={() => setEditProgram(null)}>
          <ProgramForm
            initial={editProgram}
            onSave={(d) => update.mutate({ id: editProgram.id, data: d })}
            onCancel={() => setEditProgram(null)}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Hauptprojekt löschen" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-gray-700 mb-4">
            Hauptprojekt <strong>{confirmDelete.program_number} – {confirmDelete.name}</strong> wirklich löschen?
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
