import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Database, AlertTriangle, CheckCircle, RefreshCw, FolderOpen, CalendarDays } from 'lucide-react'
import { settings, type DbPathInfo } from '../api'
import PageHeader from '../components/PageHeader'
import { GERMAN_STATES, EXTRA_HOLIDAYS } from '../lib/holidayRegions'

const HOLIDAY_KEYS = ['holiday_country', 'holiday_state', 'holiday_extra']

// ─── Generic key/value setting row ───────────────────────────────────────────

function SettingRow({ label, description, settingKey, value, onSave }: {
  label: string
  description: string
  settingKey: string
  value: string
  onSave: (key: string, value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const handleSave = () => {
    onSave(settingKey, draft)
    setEditing(false)
  }

  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 ml-6">
        {editing ? (
          <>
            <input
              autoFocus
              type="number" min={0} step={1}
              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
            />
            <button onClick={handleSave}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
              Speichern
            </button>
            <button onClick={() => { setDraft(value); setEditing(false) }}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">
              Abbrechen
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-gray-700 font-mono">{value}</span>
            <button onClick={() => { setDraft(value); setEditing(true) }}
              className="px-3 py-1 text-xs text-gray-500 border border-gray-300 rounded hover:bg-gray-50">
              Bearbeiten
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Holiday region section ───────────────────────────────────────────────────

function RegionSection({ country, state, extra, onSave }: {
  country: string
  state: string
  extra: string
  onSave: (key: string, value: string) => void
}) {
  const [draftState, setDraftState] = useState(state)
  const [draftExtra, setDraftExtra] = useState<Set<string>>(
    new Set(extra.split(',').map((s) => s.trim()).filter(Boolean)),
  )
  const dirty = draftState !== state ||
    [...draftExtra].sort().join(',') !== extra.split(',').map((s) => s.trim()).filter(Boolean).sort().join(',')

  const toggleExtra = (key: string) =>
    setDraftExtra((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const save = () => {
    if (draftState !== state) onSave('holiday_state', draftState)
    onSave('holiday_extra', [...draftExtra].join(','))
    if (!country) onSave('holiday_country', 'DE')
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <CalendarDays size={15} className="text-gray-400" />
        Feiertage / Region
      </h2>
      <div className="bg-white rounded-lg border border-gray-200 px-6 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="hr-country" className="block text-xs font-medium text-gray-600 mb-1">Land</label>
            <select id="hr-country" disabled value={country || 'DE'}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-gray-50 text-gray-500">
              <option value="DE">Deutschland (DE)</option>
            </select>
          </div>
          <div>
            <label htmlFor="hr-state" className="block text-xs font-medium text-gray-600 mb-1">Bundesland</label>
            <select id="hr-state" value={draftState}
              onChange={(e) => setDraftState(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {GERMAN_STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
            </select>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-600 mb-1.5">Optionale lokale Feiertage</p>
          <div className="space-y-1.5">
            {EXTRA_HOLIDAYS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={draftExtra.has(key)} onChange={() => toggleExtra(key)} className="accent-blue-600" />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Zusätzliche regionale Feiertage, die die Feiertags-API nicht flächendeckend liefert. Werden im Jahreskalender angezeigt.
          </p>
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={!dirty}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            Speichern
          </button>
        </div>
      </div>
    </section>
  )
}

// ─── Database path section ────────────────────────────────────────────────────

function DbPathSection() {
  const qc = useQueryClient()
  const [newDir, setNewDir] = useState('')
  const [restartBanner, setRestartBanner] = useState(false)
  const [lastResult, setLastResult] = useState<{ new_path: string; cloud_warning: boolean } | null>(null)

  const { data: info, isLoading } = useQuery<DbPathInfo>({
    queryKey: ['db-path'],
    queryFn: settings.getDbPath,
  })

  const { mutate: changePath, isPending, error } = useMutation({
    mutationFn: () => settings.setDbPath(newDir.trim()),
    onSuccess: (result) => {
      setLastResult(result)
      setRestartBanner(true)
      setNewDir('')
      qc.invalidateQueries({ queryKey: ['db-path'] })
    },
  })

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Database size={15} className="text-gray-400" />
        Datenbankpfad
      </h2>

      <div className="bg-white rounded-lg border border-gray-200 px-6 py-4 space-y-4">

        {/* Current path */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Aktueller Speicherort</p>
          {isLoading ? (
            <p className="text-sm text-gray-400">Lade…</p>
          ) : info ? (
            <div className="space-y-1">
              <p className="text-sm font-mono text-gray-800 break-all">{info.path}</p>
              <p className="text-xs text-gray-400">
                Quelle: {info.config_source === 'data_config.json' ? 'Benutzerdefiniert (data_config.json)' : 'Standardpfad (Umgebungsvariable)'}
              </p>
              {info.cloud_warning && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
                  <AlertTriangle size={12} className="flex-shrink-0" />
                  Dieser Pfad liegt in einem Cloud-Sync-Ordner. SQLite und Cloud-Sync können zu
                  Datenbankfehlern führen, wenn Dateien gleichzeitig synchronisiert werden.
                  Für mehrere gleichzeitige Nutzer bitte PostgreSQL verwenden.
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Restart banner */}
        {restartBanner && lastResult && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded px-3 py-3">
            <CheckCircle size={15} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-blue-800">Datenbankpfad geändert</p>
              <p className="text-blue-700 text-xs mt-0.5">
                Datenbank kopiert nach <span className="font-mono">{lastResult.new_path}</span>
              </p>
              <p className="text-blue-700 text-xs mt-1 font-medium">
                Bitte das Backend neu starten, damit die Änderung wirksam wird.
              </p>
              {lastResult.cloud_warning && (
                <p className="text-amber-700 text-xs mt-1">
                  Hinweis: Zielordner liegt in einem Cloud-Sync-Verzeichnis — siehe Warnung oben.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Change path form */}
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Neues Verzeichnis</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FolderOpen size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                className="w-full border border-gray-300 rounded pl-8 pr-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={info?.path ? info.path.replace(/[^/\\]+$/, '') : 'C:\\Pfad\\zum\\Verzeichnis'}
                value={newDir}
                onChange={e => { setNewDir(e.target.value); setRestartBanner(false) }}
              />
            </div>
            <button
              disabled={!newDir.trim() || isPending}
              onClick={() => changePath()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              {isPending ? <RefreshCw size={13} className="animate-spin" /> : null}
              Übernehmen &amp; kopieren
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Die aktuelle Datenbankdatei wird in das neue Verzeichnis kopiert.
            Danach ist ein Neustart des Backends erforderlich.
          </p>
          {error && (
            <p className="text-xs text-red-600 mt-2">{(error as Error).message}</p>
          )}
        </div>

      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settings.get,
  })

  const update = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => settings.update(key, value),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setError(null) },
    onError: (e: Error) => setError(e.message),
  })

  const SETTING_META: Record<string, { label: string; description: string }> = {
    default_vacation_days: {
      label: 'Standard-Urlaubstage (Tage/Jahr)',
      description: 'Wird beim Anlegen einer neuen Person automatisch als Urlaubskontingent für das aktuelle Jahr übernommen.',
    },
  }

  return (
    <div>
      <PageHeader
        title="Einstellungen"
        subtitle="Globale Standardwerte und Anwendungskonfiguration"
      />
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">{error}</div>
      )}
      <div className="p-6 space-y-8 max-w-3xl">

        {/* General settings (key/value store) */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Allgemein</h2>
          {isLoading ? (
            <p className="text-sm text-gray-400">Lade…</p>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 px-6">
              {data && Object.entries(data).filter(([key]) => !HOLIDAY_KEYS.includes(key)).map(([key, value]) => {
                const meta = SETTING_META[key]
                return (
                  <SettingRow
                    key={key}
                    settingKey={key}
                    label={meta?.label ?? key}
                    description={meta?.description ?? ''}
                    value={value}
                    onSave={(k, v) => update.mutate({ key: k, value: v })}
                  />
                )
              })}
            </div>
          )}
        </section>

        {/* Holiday region */}
        {!isLoading && data && (
          <RegionSection
            country={data.holiday_country ?? 'DE'}
            state={data.holiday_state ?? 'BY'}
            extra={data.holiday_extra ?? ''}
            onSave={(k, v) => update.mutate({ key: k, value: v })}
          />
        )}

        {/* Database path */}
        <DbPathSection />

      </div>
    </div>
  )
}
