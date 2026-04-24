import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, CheckCircle, AlertCircle, FileText, RefreshCw } from 'lucide-react'
import { projects, mappings, type ImportBatch } from '../api'
import PageHeader from '../components/PageHeader'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportResultOut {
  batch_ids: number[]
  inserted: number
  skipped: number
}

interface ParseErrorRow {
  row: number
  column: string | null
  message: string
}

interface ImportError422 {
  unresolved_projects?: string[]
  unmatched_persons?: string[]
  detail?: string
  parse_errors?: ParseErrorRow[]
}

type PageState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'unresolved'; names: string[]; file: File | string }
  | { kind: 'unmatched'; names: string[]; file: File | string }
  | { kind: 'parse_error'; message: string; errors: ParseErrorRow[] }
  | { kind: 'success'; result: ImportResultOut }
  | { kind: 'error'; message: string }

// ─── Upload helper ────────────────────────────────────────────────────────────

async function postImport(source: File | string): Promise<{ ok: true; result: ImportResultOut } | { ok: false; error: ImportError422 }> {
  const form = new FormData()
  if (typeof source === 'string') {
    form.append('file', new Blob([source], { type: 'text/csv' }), 'paste.csv')
  } else {
    form.append('file', source)
  }
  const res = await fetch(`${BASE}/imports`, { method: 'POST', body: form })
  if (res.status === 201) {
    return { ok: true, result: await res.json() as ImportResultOut }
  }
  if (res.status === 422) {
    const body = await res.json() as { detail: ImportError422 | string }
    const detail = typeof body.detail === 'object' ? body.detail : {}
    return { ok: false, error: detail }
  }
  const text = await res.text()
  throw new Error(`Import fehlgeschlagen (${res.status}): ${text}`)
}

// ─── Import history ───────────────────────────────────────────────────────────

function ImportHistory({ batches }: { batches: ImportBatch[] }) {
  if (batches.length === 0) return <p className="text-sm text-gray-500">Noch keine Importe.</p>

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {['Importiert am', 'Datei', 'Letztes Buchungsdatum'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {batches.map((b) => (
            <tr key={b.id}>
              <td className="px-4 py-3 text-sm text-gray-700">
                {new Date(b.imported_at).toLocaleString('de-DE')}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                {b.source_filename ?? <span className="italic text-gray-400">eingefügt</span>}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">{b.last_booking_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Mapping resolver ─────────────────────────────────────────────────────────

function MappingResolver({
  unresolvedNames,
  onResolved,
  onCancel,
}: {
  unresolvedNames: string[]
  onResolved: () => void
  onCancel: () => void
}) {
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projects.list })
  const qc = useQueryClient()
  const [selections, setSelections] = useState<Record<string, number>>(() =>
    Object.fromEntries(unresolvedNames.map((n) => [n, 0]))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allMapped = Object.values(selections).every((v) => v > 0)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      for (const [sageName, projectId] of Object.entries(selections)) {
        if (projectId === 0) continue
        await mappings.create({ sage_project_name: sageName, project_id: projectId })
      }
      qc.invalidateQueries({ queryKey: ['mappings'] })
      onResolved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
      <div className="flex items-start gap-2 mb-3">
        <AlertCircle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-yellow-800">Unbekannte Sage-Projektnamen</p>
          <p className="text-xs text-yellow-700 mt-0.5">
            Bitte jedem Sage-Projektnamen ein internes Projekt zuordnen, dann erneut importieren.
          </p>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {unresolvedNames.map((name) => (
          <div key={name} className="flex items-center gap-3">
            <span className="text-sm font-mono text-gray-700 min-w-[16rem] truncate">{name}</span>
            <span className="text-gray-400">→</span>
            <select
              className="flex-1 border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selections[name]}
              onChange={(e) => setSelections((s) => ({ ...s, [name]: parseInt(e.target.value) }))}
            >
              <option value={0} disabled>— bitte wählen —</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} – {p.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
        >
          Abbrechen
        </button>
        <button
          type="button"
          disabled={!allMapped || saving}
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          Mappings speichern &amp; erneut importieren
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pasteText, setPasteText] = useState('')
  const [activeTab, setActiveTab] = useState<'file' | 'paste'>('file')
  const [state, setState] = useState<PageState>({ kind: 'idle' })

  const { data: batches = [], refetch: refetchBatches } = useQuery<ImportBatch[]>({
    queryKey: ['imports'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/imports`)
      return res.json()
    },
  })

  async function runImport(source: File | string) {
    setState({ kind: 'uploading' })
    try {
      const outcome = await postImport(source)
      if (outcome.ok) {
        setState({ kind: 'success', result: outcome.result })
        void refetchBatches()
      } else {
        const { error } = outcome
        if (error.parse_errors?.length) {
          setState({ kind: 'parse_error', message: error.detail ?? 'Fehlerhafte Zeilen.', errors: error.parse_errors })
        } else if (error.unresolved_projects?.length) {
          setState({ kind: 'unresolved', names: error.unresolved_projects, file: source })
        } else if (error.unmatched_persons?.length) {
          setState({ kind: 'unmatched', names: error.unmatched_persons, file: source })
        } else {
          setState({ kind: 'error', message: error.detail ?? 'Unbekannter Fehler.' })
        }
      }
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message })
    }
  }

  function handleSubmit() {
    if (activeTab === 'file') {
      const file = fileRef.current?.files?.[0]
      if (!file) return
      void runImport(file)
    } else {
      if (!pasteText.trim()) return
      void runImport(pasteText)
    }
  }

  const canSubmit = state.kind === 'idle' || state.kind === 'success' || state.kind === 'error' || state.kind === 'parse_error'
  const busy = state.kind === 'uploading'

  return (
    <div>
      <PageHeader
        title="Sage-Import"
        subtitle="Buchungsdaten aus Sage ERP importieren"
      />

      <div className="p-6 space-y-6 max-w-3xl">

        {/* Upload panel */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            {(['file', 'paste'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setActiveTab(t); setState({ kind: 'idle' }) }}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'file' ? 'Datei hochladen' : 'Text einfügen'}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-4">
            {activeTab === 'file' ? (
              <div
                className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg p-8 cursor-pointer hover:border-blue-400 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={24} className="text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">CSV-Datei auswählen oder hierher ziehen</p>
                <p className="text-xs text-gray-500 mt-1">Encoding: UTF-8, Trennzeichen: Semikolon oder Tab</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={() => setState({ kind: 'idle' })}
                />
                {fileRef.current?.files?.[0] && (
                  <p className="mt-2 text-xs text-blue-600 flex items-center gap-1">
                    <FileText size={12} /> {fileRef.current.files[0].name}
                  </p>
                )}
              </div>
            ) : (
              <textarea
                rows={8}
                className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                placeholder={`Datum;Mitarbeiter;Projektname;Projektebene 1;Dauer;Bemerkung\n02.03.2026;Mustermann, Max;PRJ-001 Analytics 2026;Qlik/Python;1:30h;`}
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setState({ kind: 'idle' }) }}
              />
            )}

            {/* Status: CSV parse errors */}
            {state.kind === 'parse_error' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start gap-2 mb-3">
                  <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">CSV konnte nicht geparst werden</p>
                    <p className="text-xs text-red-700 mt-0.5">{state.message}</p>
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-red-700 font-medium">
                      <th className="text-left pb-1 pr-3">Zeile</th>
                      <th className="text-left pb-1 pr-3">Spalte</th>
                      <th className="text-left pb-1">Fehler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.errors.map((e, i) => (
                      <tr key={i} className="text-red-700 border-t border-red-100">
                        <td className="py-0.5 pr-3 font-mono">{e.row}</td>
                        <td className="py-0.5 pr-3">{e.column ?? '–'}</td>
                        <td className="py-0.5 font-mono">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-red-600 mt-3">
                  Erwartet: <code className="bg-red-100 px-1 rounded">Datum;Mitarbeiter;Projektname;Projektebene 1;Dauer;Bemerkung</code>
                </p>
              </div>
            )}

            {/* Status: unresolved mappings */}
            {state.kind === 'unresolved' && (
              <MappingResolver
                unresolvedNames={state.names}
                onResolved={() => void runImport(state.file)}
                onCancel={() => setState({ kind: 'idle' })}
              />
            )}

            {/* Status: unmatched persons */}
            {state.kind === 'unmatched' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Personen konnten nicht zugeordnet werden</p>
                    <p className="text-xs text-red-700 mt-1">
                      Bitte in der Personenverwaltung den Sage-Mitarbeiternamen angleichen:
                    </p>
                    <ul className="mt-2 space-y-0.5">
                      {state.names.map((n) => (
                        <li key={n} className="text-xs font-mono text-red-700">• {n}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Status: generic error */}
            {state.kind === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                {state.message}
              </div>
            )}

            {/* Status: success */}
            {state.kind === 'success' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-2">
                <CheckCircle size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">Import erfolgreich</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    {state.result.inserted} Buchungen importiert · {state.result.skipped} bereits vorhanden (übersprungen)
                  </p>
                </div>
              </div>
            )}

            {/* Submit */}
            {(canSubmit || state.kind === 'unmatched') && (
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSubmit}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy
                    ? <><RefreshCw size={14} className="animate-spin" /> Importiere…</>
                    : <><Upload size={14} /> Importieren</>}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Import history */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Importverlauf</h3>
          <ImportHistory batches={[...batches].reverse()} />
        </div>
      </div>
    </div>
  )
}
