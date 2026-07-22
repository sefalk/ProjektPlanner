import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projects as projectsApi, type VacationContingent, type PersonMembershipDetail, type ProjectMembership } from '../../api'

// Small building-block forms shared by the person detail view and the PersonSettings
// modal, so both edit paths behave identically.

// ─── Vacation contingent form ─────────────────────────────────────────────────

export function ContingentForm({ initial, onSave, onCancel }: {
  initial?: Partial<VacationContingent>
  onSave: (d: { year: number; total_days: number }) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    year: initial?.year ?? new Date().getFullYear(),
    total_days: initial?.total_days ?? 30,
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cont-year" className="block text-xs font-medium text-gray-600 mb-1">Jahr</label>
          <input id="cont-year" required type="number" min={2000} max={2100}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.year}
            onChange={(e) => setForm((f) => ({ ...f, year: parseInt(e.target.value) }))} />
        </div>
        <div>
          <label htmlFor="cont-days" className="block text-xs font-medium text-gray-600 mb-1">Urlaubstage</label>
          <input id="cont-days" required type="number" min={0} max={365} step={0.5}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.total_days}
            onChange={(e) => setForm((f) => ({ ...f, total_days: parseFloat(e.target.value) }))} />
        </div>
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

// ─── Membership add form (choose project + set dates/capacity/rate) ─────────────

export function MembershipForm({ personId, defaultBillingRate, onSave, onCancel }: {
  personId: number
  defaultBillingRate: number | null
  onSave: (d: Omit<ProjectMembership, 'id' | 'project_id'>) => void
  onCancel: () => void
}) {
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list })
  const [form, setForm] = useState({
    person_id: personId,
    from_date: '',
    to_date: '',
    weekly_capacity_hours: 40,
    billing_rate_per_hour: defaultBillingRate ?? 0,
    priority: 0,
    vacation_days_taken: 0,
    billing_position_id: null as number | null,
    project_id: 0,
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div>
        <label htmlFor="ms-project" className="block text-xs font-medium text-gray-600 mb-1">Projekt</label>
        <select id="ms-project" required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.project_id || ''}
          onChange={(e) => setForm((f) => ({ ...f, project_id: parseInt(e.target.value) }))}>
          <option value="">— Projekt wählen —</option>
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>{p.project_number} – {p.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ms-from" className="block text-xs font-medium text-gray-600 mb-1">Von</label>
          <input id="ms-from" required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.from_date}
            onChange={(e) => setForm((f) => ({ ...f, from_date: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="ms-to" className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
          <input id="ms-to" required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.to_date}
            onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ms-hours" className="block text-xs font-medium text-gray-600 mb-1">Kapazität (h/Woche)</label>
          <input id="ms-hours" required type="number" min={0} max={60} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.weekly_capacity_hours}
            onChange={(e) => setForm((f) => ({ ...f, weekly_capacity_hours: parseFloat(e.target.value) }))} />
        </div>
        <div>
          <label htmlFor="ms-rate" className="block text-xs font-medium text-gray-600 mb-1">Verrechnungssatz (€/h)</label>
          <input id="ms-rate" required type="number" min={0} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.billing_rate_per_hour}
            onChange={(e) => setForm((f) => ({ ...f, billing_rate_per_hour: parseFloat(e.target.value) }))} />
        </div>
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

// ─── Membership edit form (from the person view) ───────────────────────────────
// Edits the assignment's dates / capacity / rate. priority, vacation_days_taken and
// billing_position_id are carried through unchanged so an edit here doesn't reset the
// priority (feeds the milestone engine) or unassign the Posten.

export type MembershipEditPayload = {
  from_date: string
  to_date: string
  weekly_capacity_hours: number
  billing_rate_per_hour: number
  priority: number
  vacation_days_taken: number
  billing_position_id: number | null
}

export function MembershipEditForm({ initial, onSave, onCancel }: {
  initial: PersonMembershipDetail
  onSave: (d: MembershipEditPayload) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    from_date: initial.from_date,
    to_date: initial.to_date,
    weekly_capacity_hours: initial.weekly_capacity_hours,
    billing_rate_per_hour: initial.billing_rate_per_hour,
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave({
          ...form,
          priority: initial.priority,
          vacation_days_taken: initial.vacation_days_taken,
          billing_position_id: initial.billing_position_id,
        })
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="me-from" className="block text-xs font-medium text-gray-600 mb-1">Von</label>
          <input id="me-from" required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.from_date}
            onChange={(e) => setForm((f) => ({ ...f, from_date: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="me-to" className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
          <input id="me-to" required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.to_date}
            onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="me-hours" className="block text-xs font-medium text-gray-600 mb-1">Kapazität (h/Woche)</label>
          <input id="me-hours" required type="number" min={0.01} max={60} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.weekly_capacity_hours}
            onChange={(e) => setForm((f) => ({ ...f, weekly_capacity_hours: parseFloat(e.target.value) }))} />
        </div>
        <div>
          <label htmlFor="me-rate" className="block text-xs font-medium text-gray-600 mb-1">Verrechnungssatz (€/h)</label>
          <input id="me-rate" required type="number" min={0} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.billing_rate_per_hour}
            onChange={(e) => setForm((f) => ({ ...f, billing_rate_per_hour: parseFloat(e.target.value) }))} />
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Priorität und Posten-Zuweisung werden im Projekt selbst gepflegt und bleiben hier unverändert.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
        <button type="submit"
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
      </div>
    </form>
  )
}
