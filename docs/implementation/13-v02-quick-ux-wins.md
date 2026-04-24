# v0.2 — Quick UX Wins

_Status: ✅ implemented on dev_
_Source: Review v0.1.0 (23.04.2026) — Allgemein + I.1/2/3/5 + II.1/6 + V + VI_

## What was changed

Pure frontend work + two small backend additions. No data model changes required.

### Backend
| File | Change |
|---|---|
| `backend/app/models/enums.py` | Added `planned` to `ProjectStatus` enum |
| `backend/app/routers/programs.py` | New `GET /programs/{id}/projects` — returns linked projects for a program |
| `backend/app/routers/persons.py` | New `GET /persons/with-projects` — returns persons with their project_numbers[] |

### Frontend
| File | Change |
|---|---|
| `frontend/index.html` | Title: `"IT ProjektPlanner"` |
| `frontend/src/App.tsx` | Kalender moved to first nav position; default route → `/calendar`; "Programme" → "Hauptprojekte" |
| `frontend/src/api.ts` | Added `'planned'` to `Project.status`; `PersonWithProjects` type; `persons.withProjects()`; `programs.projects()` |
| `frontend/src/pages/ProjectsPage.tsx` | Edit + delete buttons per row (with confirm dialog); Start column; "Geplant" status badge; status selector in form |
| `frontend/src/pages/PersonsPage.tsx` | Edit + delete buttons per row (with confirm dialog); Projects column showing project numbers |
| `frontend/src/pages/MappingsPage.tsx` | Edit button per row |
| `frontend/src/pages/ProgramsPage.tsx` | Edit button; delete confirmation dialog; expandable sub-row with linked projects; page renamed "Hauptprojekte" |
| `frontend/src/pages/ProjectDetailPage.tsx` | Hauptprojekt shown in project header; reopen-invoice confirmation dialog |

## Review items addressed

- Allgemein §5 — Verlinkungen: project chips in persons table
- I.1 — Projekte editierbar + löschbar (inkl. Button in Haupttabelle)
- I.2 — Start in Tabelle
- I.3 — "Geplant"-Status für zukünftige Projekte
- I.5 — Bestätigung beim Wiedereröffnen abgeschlossener Monate
- I.7 — Hauptprojekt in Einzelprojektansicht sichtbar
- II.1 — Editierbutton in Personen-Haupttabelle
- II.6 — Projektspalte in Personentabelle
- V.1 — Programme → Hauptprojekte
- V.2 — Liste verknüpfter Projekte (aufklappbare Subtabelle)
- V.3 — Editierbutton neben Löschbutton (Programme)
- V.4 — Löschbutton mit Sicherheitsabfrage (Programme)
- VI.1 — Sage-Mapping editierbar
