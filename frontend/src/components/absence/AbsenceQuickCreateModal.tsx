import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { persons as personsApi, type PersonAbsence } from '../../api'
import Modal from '../Modal'
import { TYPE_LABELS, STATUS_LABELS } from '../../lib/absenceColors'

type AbsenceType = 'vacation' | 'sick' | 'training' | 'other'
type AbsenceStatus = 'planned' | 'confirmed' | 'ongoing'
type DaySegment = 'full' | 'morning' | 'afternoon'

const TYPES: AbsenceType[] = ['vacation', 'training', 'sick', 'other']
const SEGMENTS: [DaySegment, string][] = [
  ['full', 'Voller Tag'],
  ['morning', 'Vormittag (½)'],
  ['afternoon', 'Nachmittag (½)'],
]

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
  editAbsence,
  onClose,
  onCreated,
}: {
  persons: { id: number; name: string }[]
  initialPersonId: number | null
  startDate: string
  endDate: string
  /** When set, the modal edits this existing absence instead of creating one. */
  editAbsence?: PersonAbsence | null
  onClose: () => void
  onCreated: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!editAbsence
  const [personId, setPersonId] = useState<number | null>(editAbsence?.person_id ?? initialPersonId)
  const [type, setType] = useState<AbsenceType>(editAbsence?.absence_type ?? 'vacation')
  const [status, setStatus] = useState<AbsenceStatus>(editAbsence?.status ?? 'confirmed')
  const [start, setStart] = useState(editAbsence?.start_date ?? startDate)
  const [end, setEnd] = useState(editAbsence?.end_date ?? endDate)
  const [note, setNote] = useState(editAbsence?.note ?? '')
  const [startSegment, setStartSegment] = useState<DaySegment>(editAbsence?.start_segment ?? 'full')
  const [endSegment, setEndSegment] = useState<DaySegment>(editAbsence?.end_segment ?? 'full')
  const [error, setError] = useState<string | null>(null)

  const isOngoing = type === 'sick' && status === 'ongoing'
  // Single-day (or ongoing) uses one segment; multi-day uses a start- and end-day segment.
  const singleDay = isOngoing || start === end

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['calendar-year'] })
    qc.invalidateQueries({ queryKey: ['absence-summary'] })
    qc.invalidateQueries({ queryKey: ['absence-summary-batch'] })
    qc.invalidateQueries({ queryKey: ['absences', personId] })
    qc.invalidateQueries({ queryKey: ['persons', personId, 'absences'] })
  }

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        start_date: start,
        end_date: isOngoing ? null : end,
        absence_type: type,
        status,
        note,
        start_segment: startSegment,
        // On a single-day/ongoing absence only the start segment is meaningful.
        end_segment: singleDay ? 'full' as DaySegment : endSegment,
      }
      return isEdit
        ? personsApi.updateAbsence(editAbsence!.person_id, editAbsence!.id, payload)
        : personsApi.addAbsence(personId as number, payload)
    },
    onSuccess: () => { invalidate(); onCreated() },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: () => personsApi.deleteAbsence(editAbsence!.person_id, editAbsence!.id),
    onSuccess: () => { invalidate(); onCreated() },
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
    <Modal title={isEdit ? 'Abwesenheit bearbeiten' : 'Neue Abwesenheit'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="qc-person" className="block text-xs font-medium text-gray-600 mb-1">Mitarbeiter</label>
          <select id="qc-person" required disabled={isEdit}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
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

        {/* Half-day segments. One dropdown for a single day (or ongoing), two for a range. */}
        {singleDay ? (
          <div>
            <label htmlFor="qc-seg" className="block text-xs font-medium text-gray-600 mb-1">
              Tag <span className="font-normal text-gray-400">— voller oder halber Tag</span>
            </label>
            <select id="qc-seg"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={startSegment}
              onChange={(e) => setStartSegment(e.target.value as DaySegment)}
            >
              {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="qc-seg-start" className="block text-xs font-medium text-gray-600 mb-1">Erster Tag</label>
              <select id="qc-seg-start"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={startSegment}
                onChange={(e) => setStartSegment(e.target.value as DaySegment)}
              >
                {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="qc-seg-end" className="block text-xs font-medium text-gray-600 mb-1">Letzter Tag</label>
              <select id="qc-seg-end"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={endSegment}
                onChange={(e) => setEndSegment(e.target.value as DaySegment)}
              >
                {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="qc-note" className="block text-xs font-medium text-gray-600 mb-1">Notiz <span className="font-normal text-gray-400">optional</span></label>
          <input id="qc-note"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {isEdit && status === 'planned' && (end || start) < new Date().toISOString().slice(0, 10) && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            Dieser geplante Zeitraum liegt in der Vergangenheit — bitte auf „Bestätigt" umstellen, falls er tatsächlich stattgefunden hat.
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-2">
          {isEdit && (
            <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-50" aria-label="Abwesenheit löschen">
              <Trash2 size={14} /> Löschen
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button type="submit" disabled={create.isPending}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              Speichern
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
