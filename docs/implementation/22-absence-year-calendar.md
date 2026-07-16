# Jahreskalender für Personenabwesenheiten

_Status: 📋 Design & Implementierungsplan_
_Datum: 2026-07-16_
_Betrifft: `models/person.py`, `models/setting.py`, `services/holiday.py`, `routers/calendar.py`, `routers/persons.py`, `routers/settings.py`, `app/db.py`, `frontend/src/pages/PersonsPage.tsx`, `frontend/src/pages/PersonDetailPage.tsx`, `frontend/src/pages/SettingsPage.tsx`, neu `frontend/src/components/absence/*`, neu `frontend/src/lib/absenceColors.ts`_

_Tracking: Epic-Issue + 6 Phasen-Issues (`sefalk/ProjektPlanner`)_

---

## 1. Ziel

Die UX für Personenabwesenheiten ist heute umständlich: `Personen → MA → Abwesenheiten → Neue Abwesenheit` mit **zwei separaten Datepickern** für Start und Ende. Die Abwesenheitstabelle bleibt, wird aber um einen **Jahreskalender** ergänzt, der

- Abwesenheiten **visuell ansprechend** über ein ganzes Jahr darstellt (Monate = Zeilen, Tage = Spalten), und
- **direkten Input per Bereichsselektion** erlaubt (Ziehen über Tage → neue Abwesenheit).

Der Kalender lebt **unter dem Reiter „Personen"**, zusätzlich zur Personenliste (nicht als eigener Nav-Punkt).

## 2. Ist-Stand (Kurz)

- **Abwesenheiten:** `PersonAbsence(person_id, start_date, end_date?, absence_type, status, note)`; `absence_type ∈ {vacation, training, sick}` (Enum `models/enums.py`). **Kein Projekt-FK** → Projektfilter läuft indirekt über `ProjectMembership`.
- **Monatskalender existiert bereits** (`/calendar`, `CalendarPage.tsx` + `routers/calendar.py`): `GET /calendar?year=&month=&country=DE&state=BY` liefert `CalendarResponse{ holidays[], persons[]{absences[], memberships[]}, milestones[] }`, mit Wochenend-/Feiertags-Shading, Absence-Overlays, Projektfilter. Die Jahresansicht ist im Kern ein Re-Layout derselben Daten über 12 Monate.
- **Feiertage:** `models/holiday.py` + `services/holiday.py` (`ensure_holidays(year, country, state)`, `get_holidays_in_range`), Fetch-&-Cache gegen feiertage-api.de (Fallback openholidaysapi.org), pro (Datum, country, state). Region heute **hart DE/BY** im Calendar-Endpoint bzw. per-Projekt-Feld ohne UI.
- **Settings:** generischer Key/Value-Store (`Setting.key`/`.value`), Seeding in `db.py:seed_default_settings()`, `GET /settings` / `PUT /settings/{key}`. Frontend `SettingsPage.tsx` mit hartkodierter `SETTING_META` und **nur Number-Input** (`SettingRow`). Keine globale Region-Einstellung.
- **Farben:** kein per-MA-Farbschema. Deterministisches Muster existiert (`CalendarPage.tsx: PROJECT_PALETTE`, `projectColor(id)=PALETTE[id%len]`). Absence-Label-/Farb-Maps **doppelt** in `PersonDetailPage.tsx` und `CalendarPage.tsx`.

## 3. Grundregeln & Entscheidungen (verbindlich)

- **C1 — Platzierung.** Jahreskalender auf der Personen-Seite, unter/neben der Personentabelle. Tabelle bleibt erhalten, ein-/ausklappbar.
- **C2 — Default-Selektion.** Beim ersten Öffnen sind **alle MA** selektiert (Nutzerentscheidung).
- **C3 — Filter (alle vier).** (a) Projekt-/Programm-Filter (indirekte MA-Selektion über `ProjectMembership`), (b) Einzel-MA mit Suchfeld, (c) Abwesenheitstyp-Toggles (Urlaub/Krank/Fortbildung), (d) Schnellaktionen (Alle/Keine, nur-MA-mit-Abwesenheit, Jahr vor/zurück). Filter leicht zugänglich, schnelle Selektion.
- **C4 — Farb-Harmonisierung.** Jeder MA hat **eine eigene Farbe** (`personColor(id)`), die in Kalenderbalken **und** Personentabelle identisch ist. Deselektierte MA: ausgegraut, keine Farbhinterlegung. Tabellen-Selektion ↔ Kalender-Selektion synchron (Klick = Toggle).
- **C5 — Feiertags-Region.** Global konfigurierbar unter Einstellungen: Land + Bundesland + **Checkliste optionaler lokaler Feiertage** (z. B. Mariä Himmelfahrt). **Forward-looking:** Region ist zusätzlich **pro MA überschreibbar** (Nearshoring, ausländische MA) — NULL erbt global.
- **C6 — Bestehendes Verhalten unangetastet.** Monatskalender `/calendar`, Abwesenheitstabelle/-formular auf `PersonDetailPage` bleiben funktional. Doppelte Farb-/Label-Maps werden in ein geteiltes Modul (`lib/absenceColors.ts`) zusammengeführt, bevor der dritte Konsument (Jahresansicht) dazukommt.

## 4. Kalender-Layout & Interaktion

- **Raster:** 12 Zeilen (Monate) × Tagesspalten (bis 31). Fehlende Tage (z. B. 30./31. in kurzen Monaten) als leere/gesperrte Zellen.
- **Scroll & Fokus:** vertikal scrollbar, initial **zentriert auf den aktuellen Monat** (aktueller Monat als Mittelpunkt).
- **Wochenende:** Sa/So farblich leicht von Werktagen abgesetzt.
- **Feiertage:** angezeigt; bei mehreren Regionen (per-MA) farblich **ähnlich, aber abgesetzt** (gleicher Farbwinkel, variierte Schattierung/Muster) → auf einen Blick als Feiertag erkennbar und dennoch regional unterscheidbar.
- **Abwesenheitsbalken:** Balken mit **leicht transparentem Body** über die Tage Start→Ende.
  - **Monatsumbruch:** läuft ein Balken über die Monatsgrenze (Zeilenende), wird der Umbruch durch eine **offene Umrahmung** an der Umbruchkante visualisiert (rechts offen in Monat _n_, links offen in Monat _n+1_).
  - **Stacking:** Balken eines Tages stapeln sich gemäß Selektion und nutzen die volle vertikale Höhe der Monatszeile aus → je mehr MA, desto dünner. **Labels werden ausgeblendet, sobald sie die Balkenhöhe überschreiten würden.**
  - **Typ-Anzeige:** Inline-Tag (Kürzel U/K/F) **plus** Hover-Tooltip mit Von/Bis (und Typ/Status).
  - **Hover-Highlight:** Beim Hovern über eine Abwesenheit eines MA werden **alle** Abwesenheiten desselben MA hervorgehoben (Rahmenfarbe ändert sich, Balken leicht vergrößert).
- **Direkt-Input:** Ziehen (drag) über einen Tagesbereich in der Zeile eines MA öffnet die bestehende `AbsenceForm` mit vorbelegtem `person_id`, `start_date`, `end_date`.

## 5. Soll — Backend

### 5.1 Jahres-Aggregation
- Range-basierte Aggregation statt Einzelmonat. Entweder `GET /calendar` um `from`/`to` (oder `year` ohne `month`) erweitern **oder** `GET /calendar/year?year=` ergänzen. Response wie `CalendarResponse`, aber Holidays/Absences/Memberships über das ganze Jahr (Range-Overlap-Logik existiert bereits).
- Feiertage: **mehrere Regionen** möglich. Endpoint ermittelt die benötigten Regionen (Union der Regionen der angefragten/sichtbaren MA bzw. explizit gefilterte Region) und ruft `ensure_holidays` je Region auf. Response-Holiday trägt `country`/`state` zur Unterscheidung.

### 5.2 Regionsauflösung (Phase 1 vorbereiten)
- Helper `resolve_holiday_region(person, settings)` → `(country, state, extra_holidays)`.
  - Phase 1–5: liefert **immer global** (Settings), Person-Override ignoriert.
  - Phase 6: Person-Override (falls gesetzt) schlägt global. So bleibt Phase 6 ein reines Attribut+UI-Add ohne Refactoring.

### 5.3 Settings (Phase 5)
- Neue Keys in `seed_default_settings()`: `holiday_country` (Default `DE`), `holiday_state` (Default `BY`), `holiday_extra` (Default `""`, CSV der aktivierten optionalen lokalen Feiertage).
- Calendar-Endpoint liest diese Settings statt hart DE/BY.

### 5.4 Person-Attribute (Phase 6)
- Alembic: `Person.holiday_country: str|None`, `Person.holiday_state: str|None`, `Person.holiday_extra: str|None` — alle nullable, NULL = erbe global.
- `AbsenceCreate`/Person-Schemas & Router entsprechend.

## 6. Soll — Frontend

- **Neues geteiltes Modul** `lib/absenceColors.ts`: `TYPE_LABELS`, `TYPE_SHORT` (U/K/F), `TYPE_COLORS`, `personColor(id)`. `PersonDetailPage` und `CalendarPage` migrieren darauf (keine Doppelung).
- **Neue Komponenten** unter `components/absence/`: `YearCalendar`, `MonthRow`, `AbsenceBar`, `CalendarFilters`, `PersonLegendTable` (o. ä.).
- **PersonsPage**: Kalender + ein-/ausklappbare Personentabelle einbetten; Selektions-State (welche MA sichtbar) zentral, an Filter + Tabelle + Kalender gebunden.
- **SettingsPage** (Phase 5): Region-Sektion mit Dropdowns (Land/Bundesland) + Checkliste; `SettingRow` um Nicht-Number-Typen erweitern (oder dedizierte Sektion).
- **PersonForm** (Phase 6): optionale Region-Override-Felder (leer = global).

## 7. Phasen (je 1 Kind-Issue / PR)

1. **Fundament + Jahresansicht** — geteiltes Farb-/Label-Modul + `personColor()`; Backend Year-Aggregation + `resolve_holiday_region` (global); Frontend 12×Tage-Raster auf Personen-Seite, scrollbar/zentriert, Wochenend- + Feiertags-Shading (globale Region).
2. **Abwesenheitsbalken + Interaktion** — transparente Balken, Monatsumbruch-Umrahmung, Stacking + dynamische Höhe + Label-Ausblendung, Inline-Tag, Hover-Tooltip, Hover-Highlight aller Abwesenheiten eines MA.
3. **Direkt-Input per Bereichsselektion** — Drag-Selektion → `AbsenceForm` vorbelegt (person/start/end).
4. **Filter + Personentabelle-Harmonisierung** — alle vier Filter, Default = alle MA; Tabelle farblich gekoppelt, deselektierte ausgegraut, ein-/ausklappbar, Selektion Tabelle ↔ Kalender synchron.
5. **Feiertags-Region global + Zusatz-Checkliste** — Settings-Keys + Region-Sektion unter Einstellungen; Endpoint liest Settings.
6. **Per-MA Feiertagsregion-Override + Multi-Region** — `Person`-Region-Attribute (Default global, überschreibbar), PersonForm-UI, Kalender zeigt Union der Regionen sichtbarer MA, Region-Filter, farblich abgesetzte Feiertage je Region.

## 8. Invarianten / Nicht-Ziele

- Bestehender Monatskalender, Abwesenheitstabelle & -formular bleiben funktional unverändert (nur Farb-/Label-Maps werden geteilt).
- Keine echten GitHub-Sub-Issues nötig: Epic mit Task-Liste + Kind-Issues mit `Teil von #Epic`.
- Keine sensiblen/personenbezogenen Daten in Code/Commits (DSGVO); Dev nur mit Pseudodaten.
