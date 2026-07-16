// Shared holiday-region constants used by SettingsPage (global region) and the
// person forms (per-person override).

/** German states — codes are the feiertage-api subdivision codes. */
export const GERMAN_STATES: [string, string][] = [
  ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'],
  ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'],
  ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen'],
]

export const STATE_LABEL: Record<string, string> = Object.fromEntries(GERMAN_STATES)

/** Optional local holidays — keys must match EXTRA_HOLIDAY_CATALOG in the backend. */
export const EXTRA_HOLIDAYS: [string, string][] = [
  ['mariae_himmelfahrt', 'Mariä Himmelfahrt (15.8.)'],
  ['augsburger_friedensfest', 'Augsburger Friedensfest (8.8.)'],
  ['reformationstag', 'Reformationstag (31.10.)'],
]

/** Stable key for a region (country/state) pair. */
export function regionKey(country: string, state: string): string {
  return `${country}-${state}`
}

/** Human label for a region key like "DE-BY". */
export function regionLabel(key: string): string {
  const state = key.split('-')[1] ?? key
  return STATE_LABEL[state] ?? state
}

// Warm, similar-but-distinct shades so holidays of different regions read as
// holidays yet stay distinguishable at a glance.
export const REGION_SHADES = ['bg-red-100', 'bg-rose-100', 'bg-orange-100', 'bg-amber-100', 'bg-pink-100']

export function regionShade(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i)) % REGION_SHADES.length
  return REGION_SHADES[h]
}
