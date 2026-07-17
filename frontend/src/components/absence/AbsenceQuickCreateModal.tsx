import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { persons as personsApi } from '../../api'
import Modal from '../Modal'
import { TYPE_LABELS, STATUS_LABELS } from '../../lib/absenceColors'

type AbsenceType = 'vacation' | 'sick' | 'training'
type AbsenceStatus = 'planned' | 'confirmed' | 'ongoing'

const TYPES: AbsenceType[] = ['vacation', 'training', 'sick']

function allowedStatuses(type: AbsenceType): AbsenceStatus[] {
  return type === 'sick' ? ['confirmed', 'ongoing'] : ['planned', 'confirmed']
}

/**
 * Quick "new absence" form opened from the year calendar. Dates come prefilled
 * from the drag selection; the person is preselected when the drag started on a
 * person's lane, otherwise it must be chosen here.
 */
export default function AbsenceQuickCreateModal({
  persons,
  initialPersonId,
  startDate,
  endDate,
  onClose,
  onCreated,
}: {
  persons: { id: number; name: string }[]
  initialPersonId: number | null
  startDate: string
  endDate: string
  onClose: () => void
  onCreated: () => void
}) {
  const qc = useQueryClient()
  const [personId, setPersonId] = useState<number | null>(initialPersonId)
  const [type, setType] = useState<AbsenceType>('vacation')
  const [status, setStatus] = useState<AbsenceStatus>('confirmed')
  const [start, setStart] = useState(startDate)
  const [end, setEnd] = useState(endDate)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isOngoing = type === 'sick' && status === 'ongoing'

  const create = useMutation({
    mutationFn: () =>
      personsApi.addAbsence(personId as number, {
        start_date: start,
        end_date: isOngoing ? null : end,
        absence_type: type,
        status,
        note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-year'] })
      qc.invalidateQueries({ queryKey: ['persons', personId, 'absences'] })
      onCreated()
    },
    onError: (e: Error) => setError(e.message),
  })

  function handleType(t: AbsenceType) {
    setType(t)
    if (!allowedStatuses(t).includes(status)) setStatus(allowedStatuses(t)[0])
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (personId == null) { setError('Bitte eine Person wählen.'); return }
    if (!isOngoing && end < start) { setError('Das Ende darf nicht vor dem Beginn liegen.'); return }
    create.mutate()
  }

  return (
    <Modal title="Neue Abwesenheit" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="qc-person" className="block text-xs font-medium text-gray-600 mb-1">Mitarbeiter</label>
          <select id="qc-person" required
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={personId ?? ''}
            onChange={(e) => setPersonId(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">– wählen –</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="qc-type" className="block text-xs font-medium text-gray-600 mb-1">Typ</label>
            <select id="qc-type"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={type}
              onChange={(e) => handleType(e.target.value as AbsenceType)}
            >
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="qc-status" className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select id="qc-status"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={status}
              onChange={(e) => setStatus(e.target.value as AbsenceStatus)}
            >
              {allowedStatuses(type).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="qc-start" className="block text-xs font-medium text-gray-600 mb-1">Von</label>
            <input id="qc-start" type="date" required
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="qc-end" className="block text-xs font-medium text-gray-600 mb-1">
              Bis {isOngoing && <span className="font-normal text-gray-400">(offen)</span>}
            </label>
            <input id="qc-end" type="date" required={!isOngoing} disabled={isOngoing}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
              value={isOngoing ? '' : end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="qc-note" className="block text-xs font-medium text-gray-600 mb-1">Notiz <span className="font-normal text-gray-400">optional</span></label>
          <input id="qc-note"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
          <button type="submit" disabled={create.isPending}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            Speichern
          </button>
        </div>
      </form>
    </Modal>
  )
}
