import { COUNTRIES, GERMAN_STATES } from '../../lib/holidayRegions'

const cls = 'w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

/**
 * Per-person holiday region override: pick a country (empty = inherit global),
 * and a Bundesland when the country is Germany. Foreign countries are national
 * (state = ''); Nager.Date supplies their holidays.
 */
export default function RegionOverrideSelect({
  country,
  state,
  onChange,
}: {
  country: string | null
  state: string | null
  onChange: (country: string | null, state: string | null) => void
}) {
  return (
    <div>
      <label htmlFor="region-country" className="block text-xs font-medium text-gray-600 mb-1">
        Feiertagsregion <span className="font-normal text-gray-400">optional — überschreibt global</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <select
          id="region-country"
          className={cls}
          value={country ?? ''}
          onChange={(e) => {
            const c = e.target.value || null
            if (!c) onChange(null, null)
            else if (c === 'DE') onChange('DE', state || 'BY')
            else onChange(c, '') // foreign countries are national-only
          }}
        >
          <option value="">– global (aus Einstellungen) –</option>
          {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        {country === 'DE' && (
          <select
            id="region-state"
            aria-label="Bundesland"
            className={cls}
            value={state ?? ''}
            onChange={(e) => onChange('DE', e.target.value)}
          >
            {GERMAN_STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
          </select>
        )}
      </div>
    </div>
  )
}
