import { useMemo, useState } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, ChevronDown, Search, ArrowUpRight } from 'lucide-react'
import { persons, calendar, programs, projects as projectsApi, type Person, type YearCalendarPerson } from '../api'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import YearCalendar from '../components/absence/YearCalendar'
import AbsenceQuickCreateModal from '../components/absence/AbsenceQuickCreateModal'
import { personColor, TYPE_LABELS, TYPE_SHORT } from '../lib/absenceColors'
import { regionKey, regionLabel, regionShade } from '../lib/holidayRegions'
import RegionOverrideSelect from '../components/absence/RegionOverrideSelect'

type AbsenceType = 'vacation' | 'sick' | 'training' | 'other'
const ALL_TYPES: AbsenceType[] = ['vacation', 'training', 'sick', 'other']

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
    holiday_country: initial?.holiday_country ?? null as string | null,
    holiday_state: initial?.holiday_state ?? null as string | null,
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
      <RegionOverrideSelect
        country={form.holiday_country}
        state={form.holiday_state}
        onChange={(c, s) => setForm({ ...form, holiday_country: c, holiday_state: s })}
      />
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

  const [quickCreate, setQuickCreate] = useState<{ personId: number | null; start: string; end: string } | null>(null)

  // Vertical scroll spans several years; the calendar centres on the current month.
  const currentYear = new Date().getFullYear()
  const YEARS = useMemo(() => [-1, 0, 1, 2, 3].map((o) => currentYear + o), [currentYear])

  // Selection & filters. deselected = ids explicitly hidden; empty ⇒ all selected (default).
  const [deselected, setDeselected] = useState<Set<number>>(new Set())
  const [typeFilter, setTypeFilter] = useState<Set<AbsenceType>>(new Set(ALL_TYPES))
  const [search, setSearch] = useState('')
  const [tableCollapsed, setTableCollapsed] = useState(false)
  const [selProgram, setSelProgram] = useState<number | null>(null)
  const [selProject, setSelProject] = useState<number | null>(null)
  const [regionFilter, setRegionFilter] = useState<string | null>(null) // null = auto (union of shown MA)

  const { data = [], isLoading } = useQuery({
    queryKey: ['persons-with-projects'],
    queryFn: persons.withProjects,
  })

  const yearQueries = useQueries({
    queries: YEARS.map((y) => ({ queryKey: ['calendar-year', y], queryFn: () => calendar.year(y) })),
  })
  const calLoading = yearQueries.some((q) => q.isPending)
  const dataSig = yearQueries.map((q) => q.dataUpdatedAt ?? 0).join(',')

  const holidaysByYear = useMemo(() => {
    const m: Record<number, import('../api').YearHoliday[]> = {}
    YEARS.forEach((y, i) => { m[y] = yearQueries[i].data?.holidays ?? [] })
    return m
  }, [dataSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merge persons across the fetched years (absences deduped by id).
  const mergedPersons = useMemo(() => {
    const map = new Map<number, YearCalendarPerson>()
    YEARS.forEach((_, i) => {
      for (const p of yearQueries[i].data?.persons ?? []) {
        const ex = map.get(p.id)
        if (!ex) { map.set(p.id, { ...p, absences: [...p.absences] }); continue }
        const seen = new Set(ex.absences.map((a) => a.id))
        for (const a of p.absences) if (!seen.has(a.id)) ex.absences.push(a)
      }
    })
    return [...map.values()]
  }, [dataSig]) // eslint-disable-line react-hooks/exhaustive-deps

  const firstData = yearQueries.find((q) => q.data)?.data
  const globalRegion = firstData ? regionKey(firstData.country, firstData.state) : 'DE-BY'

  const { data: programList = [] } = useQuery({ queryKey: ['programs'], queryFn: programs.list })
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list })

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

  const allIds = useMemo(() => data.map((p) => p.id), [data])
  const isSelected = (id: number) => !deselected.has(id)
  const selectedCount = allIds.filter(isSelected).length

  // Persons for the calendar: selected only, absences filtered by type.
  const calendarPersons = useMemo(() => {
    return mergedPersons
      .filter((p) => isSelected(p.id))
      .map((p) => ({ ...p, absences: p.absences.filter((a) => typeFilter.has(a.absence_type)) }))
  }, [mergedPersons, deselected, typeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Holiday regions. Auto = union of the shown persons' regions; a manual pick overrides.
  const regionOptions = useMemo(() => {
    const set = new Set<string>([globalRegion])
    for (const p of mergedPersons) set.add(regionKey(p.holiday_country, p.holiday_state))
    return [...set]
  }, [mergedPersons, globalRegion])
  const displayedRegions = useMemo(() => {
    if (regionFilter) return new Set([regionFilter])
    const s = new Set(calendarPersons.map((p) => regionKey(p.holiday_country, p.holiday_state)))
    if (s.size === 0) s.add(globalRegion)
    return s
  }, [regionFilter, calendarPersons, globalRegion])

  // Project/program quick-select works off the project numbers shown in the
  // table (all-time membership) so selecting a project picks exactly the people
  // whose row shows that project chip — regardless of the viewed year.
  const membersOfProjects = (projectIds: number[]): Set<number> => {
    const numbers = new Set(
      projectIds
        .map((id) => projectList.find((p) => p.id === id)?.project_number)
        .filter((n): n is string => !!n),
    )
    const set = new Set<number>()
    for (const p of data) {
      if ((p.project_numbers ?? []).some((n) => numbers.has(n))) set.add(p.id)
    }
    return set
  }

  const selectOnly = (ids: Set<number>) => setDeselected(new Set(allIds.filter((id) => !ids.has(id))))
  const toggle = (id: number) =>
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectAll = () => { setDeselected(new Set()); setSelProgram(null); setSelProject(null) }
  const selectNone = () => setDeselected(new Set(allIds))
  const selectWithAbsence = () => {
    const withAbs = new Set<number>(mergedPersons.filter((p) => p.absences.length > 0).map((p) => p.id))
    selectOnly(withAbs)
  }
  const applyProgram = (progId: number | null) => {
    setSelProgram(progId); setSelProject(null)
    if (progId == null) { selectAll(); return }
    const projectIds = projectList.filter((p) => p.program_id === progId).map((p) => p.id)
    selectOnly(membersOfProjects(projectIds))
  }
  const applyProject = (projId: number | null) => {
    setSelProject(projId); setSelProgram(null)
    if (projId == null) { selectAll(); return }
    selectOnly(membersOfProjects([projId]))
  }
  const toggleType = (t: AbsenceType) =>
    setTypeFilter((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data
    return data.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sage_employee_name.toLowerCase().includes(q),
    )
  }, [data, search])

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
      <div className="p-6 flex flex-col gap-6">
        {/* Year calendar for absences */}
        <section className="order-2">
          <div className="flex items-baseline gap-2 mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Jahreskalender – Abwesenheiten</h2>
            <span className="text-xs text-gray-400">Zeitraum ziehen für neue Abwesenheit · vertikal scrollen für weitere Monate</span>
          </div>

          {/* Filter bar */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select
              aria-label="Nach Hauptprojekt filtern"
              className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={selProgram ?? ''}
              onChange={(e) => applyProgram(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Alle Hauptprojekte</option>
              {programList.map((p) => <option key={p.id} value={p.id}>{p.program_number} – {p.name}</option>)}
            </select>
            <select
              aria-label="Nach Projekt filtern"
              className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={selProject ?? ''}
              onChange={(e) => applyProject(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Alle Projekte</option>
              {projectList.map((p) => <option key={p.id} value={p.id}>{p.project_number} – {p.name}</option>)}
            </select>

            <div className="w-px h-4 bg-gray-200 mx-1" />

            {ALL_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`px-2 py-1 rounded-full text-xs font-medium border transition-opacity ${
                  typeFilter.has(t) ? 'opacity-100 border-gray-300 bg-gray-50' : 'opacity-40 border-gray-200'
                }`}
                aria-pressed={typeFilter.has(t)}
                title={`${TYPE_LABELS[t]} ein-/ausblenden`}
              >
                {TYPE_SHORT[t]} · {TYPE_LABELS[t]}
              </button>
            ))}

            {regionOptions.length > 1 && (
              <>
                <div className="w-px h-4 bg-gray-200 mx-1" />
                <select
                  aria-label="Feiertagsregion anzeigen"
                  className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={regionFilter ?? ''}
                  onChange={(e) => setRegionFilter(e.target.value || null)}
                  title="Welche Feiertagsregion angezeigt wird"
                >
                  <option value="">Feiertage: Auto</option>
                  {regionOptions.map((r) => <option key={r} value={r}>Feiertage: {regionLabel(r)}</option>)}
                </select>
              </>
            )}

            <div className="w-px h-4 bg-gray-200 mx-1" />

            <button onClick={selectAll} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Alle</button>
            <button onClick={selectNone} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Keine</button>
            <button onClick={selectWithAbsence} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Nur mit Abwesenheit</button>
            <span className="text-xs text-gray-400 ml-auto">{selectedCount} / {allIds.length} MA</span>
          </div>

          {calLoading ? (
            <p className="text-sm text-gray-400">Lade Kalender…</p>
          ) : (
            <YearCalendar
              years={YEARS}
              holidaysByYear={holidaysByYear}
              persons={calendarPersons}
              displayedRegions={displayedRegions}
              onRangeSelect={(personId, start, end) => setQuickCreate({ personId, start, end })}
            />
          )}
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600" aria-label="Legende">
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-gray-100 border border-gray-200" /> Wochenende</span>
            {[...displayedRegions].map((r) => (
              <span key={r} className="flex items-center gap-1.5">
                <span className={`inline-block w-4 h-4 rounded border border-gray-200 ${regionShade(r)}`} />
                Feiertag {regionOptions.length > 1 ? regionLabel(r) : ''}
              </span>
            ))}
          </div>
        </section>

        {/* Person list — selection is shared with the calendar */}
        <section className="order-1">
          <div className="flex items-center justify-between mb-2 gap-2">
            <button
              onClick={() => setTableCollapsed((v) => !v)}
              className="flex items-center gap-1 text-sm font-semibold text-gray-700"
              aria-expanded={!tableCollapsed}
            >
              <ChevronDown size={14} className={`transition-transform ${tableCollapsed ? '-rotate-90' : ''}`} />
              Personen ({data.length})
            </button>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="MA suchen…"
                aria-label="Mitarbeiter suchen"
                className="pl-7 pr-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>

          {!tableCollapsed && (
            isLoading ? (
              <p className="text-sm text-gray-400">Lade…</p>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-8 px-3 py-2" />
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Sage-Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Wochenstunden</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Projekte</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {filteredRows.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Keine MA gefunden.</td></tr>
                    )}
                    {filteredRows.map((p) => {
                      const sel = isSelected(p.id)
                      const c = personColor(p.id)
                      return (
                        <tr
                          key={p.id}
                          onClick={() => toggle(p.id)}
                          className={`cursor-pointer transition-colors ${sel ? 'hover:bg-gray-50' : 'bg-gray-50/40 hover:bg-gray-50'}`}
                          title={sel ? 'Abwählen' : 'Auswählen'}
                        >
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={() => toggle(p.id)}
                              className="accent-blue-600"
                              aria-label={`${p.name} an-/abwählen`}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-sm font-medium ${sel ? `${c.rowBg} ${c.text}` : 'text-gray-400'}`}>
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${sel ? c.dot : 'bg-gray-300'}`} />
                              {p.name}
                            </span>
                          </td>
                          <td className={`px-4 py-2 text-sm ${sel ? 'text-gray-700' : 'text-gray-400'}`}>{p.sage_employee_name}</td>
                          <td className={`px-4 py-2 text-sm ${sel ? 'text-gray-700' : 'text-gray-400'}`}>{p.default_weekly_hours} h</td>
                          <td className="px-4 py-2">
                            {(!p.project_numbers || p.project_numbers.length === 0)
                              ? <span className="text-xs text-gray-400">–</span>
                              : (
                                <div className="flex flex-wrap gap-1">
                                  {p.project_numbers.map((n) => (
                                    <span key={n} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">{n}</span>
                                  ))}
                                </div>
                              )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                              <button aria-label={`${p.name} öffnen`} onClick={() => navigate(`/persons/${p.id}`)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors"><ArrowUpRight size={14} /></button>
                              <button aria-label={`${p.name} bearbeiten`} onClick={() => { setEditPerson(p); setError(null) }} className="p-1 text-gray-400 hover:text-blue-600 transition-colors"><Pencil size={13} /></button>
                              <button aria-label={`${p.name} löschen`} onClick={() => setConfirmDelete(p)} className="p-1 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </section>
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

      {quickCreate && (
        <AbsenceQuickCreateModal
          persons={(mergedPersons.length ? mergedPersons : data).map((p) => ({ id: p.id, name: p.name }))}
          initialPersonId={quickCreate.personId}
          startDate={quickCreate.start}
          endDate={quickCreate.end}
          onClose={() => setQuickCreate(null)}
          onCreated={() => setQuickCreate(null)}
        />
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
