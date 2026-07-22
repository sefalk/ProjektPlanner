import { useState } from 'react'
import { type Person } from '../../api'
import RegionOverrideSelect from '../absence/RegionOverrideSelect'

// Shared person settings form — used both in the persons table ("Person bearbeiten")
// and the person detail view ("Personeneinstellungen"), so both expose the SAME full
// field set. Initialised once from `initial`; keeping every field in state means a save
// round-trips values it doesn't edit instead of nulling them (#47/#48).

const WORK_WEEK_PRESETS = [
  { label: '40 h (5×8)', value: '8,8,8,8,8' },
  { label: '32 h (4×8, Fr frei)', value: '8,8,8,8,0' },
  { label: '32 h (4×8 + 4 Fr)', value: '7,7,7,7,4' },
  { label: 'Benutzerdefiniert', value: 'custom' },
]

export default function PersonForm({ initial, onSave, onCancel }: {
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
