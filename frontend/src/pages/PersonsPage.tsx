import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { persons, calendar, type Person, type PersonWithProjects } from '../api'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import Modal from '../components/Modal'
import YearCalendar from '../components/absence/YearCalendar'

const WORK_WEEK_PRESETS = [
  { label: '40 h (5×8)', value: '8,8,8,8,8' },
  { label: '32 h (4×8, Fr frei)', value: '8,8,8,8,0' },
  { label: '32 h (4×8 + 4 Fr)', value: '7,7,7,7,4' },
  { label: 'Benutzerdefiniert', value: 'custom' },
]

function PersonForm({ initial, onSave, onCancel }: {
  initial?: Partial<Person>
  onSave: (d: Omit<Person, 'id'>) => void
  onCancel: () => void
}) {
  const presetValues = WORK_WEEK_PRESETS.map((p) => p.value).filter((v) => v !== 'custom')
  const initPattern = initial?.work_week_pattern ?? null
  const initPreset = initPattern && presetValues.includes(initPattern) ? initPattern : (initPattern ? 'custom' : '')
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    sage_employee_name: initial?.sage_employee_name ?? '',
    default_weekly_hours: initial?.default_weekly_hours ?? 40,
    work_week_pattern: initPattern as string | null,
    default_billing_rate: initial?.default_billing_rate ?? null as number | null,
  })
  const [patternPreset, setPatternPreset] = useState(initPreset)

  const handlePatternPreset = (val: string) => {
    setPatternPreset(val)
    if (val !== 'custom' && val !== '') {
      setForm((f) => ({ ...f, work_week_pattern: val }))
    } else if (val === '') {
      setForm((f) => ({ ...f, work_week_pattern: null }))
    }
  }

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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="person-hours" className="block text-xs font-medium text-gray-600 mb-1">Wochenstunden (Standard)</label>
          <input id="person-hours"
            required type="number" min={0} max={60} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.default_weekly_hours}
            onChange={(e) => setForm({ ...form, default_weekly_hours: parseFloat(e.target.value) })}
          />
        </div>
        <div>
          <label htmlFor="person-rate" className="block text-xs font-medium text-gray-600 mb-1">Verrechnungssatz (€/h) <span className="font-normal text-gray-400">optional</span></label>
          <input id="person-rate"
            type="number" min={0} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.default_billing_rate ?? ''}
            onChange={(e) => setForm({ ...form, default_billing_rate: e.target.value ? parseFloat(e.target.value) : null })}
          />
        </div>
      </div>
      <div>
        <label htmlFor="person-pattern" className="block text-xs font-medium text-gray-600 mb-1">Arbeitswochenmuster <span className="font-normal text-gray-400">optional</span></label>
        <select id="person-pattern"
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={patternPreset}
          onChange={(e) => handlePatternPreset(e.target.value)}
        >
          <option value="">– Standard (gleichmäßig) –</option>
          {WORK_WEEK_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {patternPreset === 'custom' && (
          <input
            className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="z.B. 8,8,8,8,4"
            value={form.work_week_pattern ?? ''}
            onChange={(e) => setForm({ ...form, work_week_pattern: e.target.value || null })}
          />
        )}
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
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [editPerson, setEditPerson] = useState<Person | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Person | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [calYear, setCalYear] = useState(new Date().getFullYear())

  const { data = [], isLoading } = useQuery({
    queryKey: ['persons-with-projects'],
    queryFn: persons.withProjects,
  })

  const { data: yearCal, isLoading: calLoading } = useQuery({
    queryKey: ['calendar-year', calYear],
    queryFn: () => calendar.year(calYear),
  })

  const create = useMutation({
    mutationFn: persons.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons-with-projects'] })
      qc.invalidateQueries({ queryKey: ['persons'] })
      setShowCreate(false)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Person, 'id'> }) => persons.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons-with-projects'] })
      qc.invalidateQueries({ queryKey: ['persons'] })
      setEditPerson(null)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: number) => persons.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons-with-projects'] })
      qc.invalidateQueries({ queryKey: ['persons'] })
      setConfirmDelete(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'sage_employee_name', header: 'Sage-Name' },
    {
      key: 'default_weekly_hours', header: 'Wochenstunden',
      render: (p: PersonWithProjects) => `${p.default_weekly_hours} h`,
    },
    {
      key: 'projects', header: 'Projekte',
      render: (p: PersonWithProjects) => {
        if (!p.project_numbers || p.project_numbers.length === 0) {
          return <span className="text-xs text-gray-400">–</span>
        }
        return (
          <div className="flex flex-wrap gap-1">
            {p.project_numbers.map((num) => (
              <span key={num} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                {num}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      key: 'actions', header: '',
      render: (p: PersonWithProjects) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            aria-label={`${p.name} bearbeiten`}
            onClick={() => { setEditPerson(p); setError(null) }}
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

  return (
    <div>
      <PageHeader
        title="Personen"
        subtitle={`${data.length} Mitarbeiter · Kapazitäten, Abwesenheiten und Projektzuordnungen`}
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
      <div className="p-6 space-y-6">
        {/* Year calendar for absences */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Jahreskalender – Abwesenheiten</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCalYear((y) => y - 1)}
                aria-label="Vorheriges Jahr"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-medium text-gray-700 min-w-[3.5rem] text-center">{calYear}</span>
              <button
                onClick={() => setCalYear((y) => y + 1)}
                aria-label="Nächstes Jahr"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          {calLoading ? (
            <p className="text-sm text-gray-400">Lade Kalender…</p>
          ) : (
            <YearCalendar year={calYear} holidays={yearCal?.holidays ?? []} persons={yearCal?.persons ?? []} />
          )}
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600" aria-label="Legende">
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-gray-100 border border-gray-200" /> Wochenende</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-red-100 border border-red-200" /> Feiertag</span>
          </div>
        </section>

        {/* Person list */}
        {isLoading ? (
          <p className="text-sm text-gray-400">Lade…</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <Table columns={columns} rows={data} keyFn={(p) => p.id} onRowClick={(p) => navigate(`/persons/${p.id}`)} />
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="Neue Person" onClose={() => { setShowCreate(false); setError(null) }}>
          <PersonForm onSave={(d) => create.mutate(d)} onCancel={() => { setShowCreate(false); setError(null) }} />
        </Modal>
      )}

      {editPerson && (
        <Modal title="Person bearbeiten" onClose={() => { setEditPerson(null); setError(null) }}>
          <PersonForm
            initial={editPerson}
            onSave={(d) => update.mutate({ id: editPerson.id, data: d })}
            onCancel={() => { setEditPerson(null); setError(null) }}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Person löschen" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-gray-700 mb-4">
            Person <strong>{confirmDelete.name}</strong> wirklich löschen?
            Alle zugehörigen Abwesenheiten und Urlaubskontingente werden ebenfalls entfernt.
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
