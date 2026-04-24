import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settings } from '../api'
import PageHeader from '../components/PageHeader'

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
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
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
        subtitle="Globale Standardwerte für neue Einträge"
      />
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">{error}</div>
      )}
      <div className="p-6">
        {isLoading ? (
          <p className="text-sm text-gray-400">Lade…</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 px-6">
            {data && Object.entries(data).map(([key, value]) => {
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
      </div>
    </div>
  )
}
