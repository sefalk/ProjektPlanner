# v0.3 — Sage Import Rework

_Status: ✅ implemented on dev_
_Source: Review v0.1.0 (23.04.2026) — IV_

## Context

The current import parser handles a legacy CSV format. The review specifies a new ("echtes") Sage format:

```
Datum;Mitarbeiter;Projektname;Projektebene 1;Dauer;Bemerkung
02.03.2026;Mustermann, Max;"PRJ-001 Analytics 2026";Qlik/Python;1:30h;
```

Key differences:
- New column names: `Datum`, `Mitarbeiter`, `Projektname`, `Projektebene 1`, `Dauer`, `Bemerkung`
- Duration encoded as `h:mm` with trailing `h` (e.g. `1:30h` = 1.5 h)
- Separator is `;` but tabs should also be accepted
- Error messages currently give no detail on which row or column failed

## Changes

### 1. New column mapping + `h:mm` duration parser
**File:** `backend/app/services/import_service.py`

- Map columns: `Datum` → date, `Mitarbeiter` → employee name, `Projektname` → sage project name, `Dauer` → net_hours
- Duration parse: strip trailing `h`, split on `:` → `int(parts[0]) + int(parts[1]) / 60`
- Old column names (`Buchungsdatum`, `Stunden`, …) can be removed — only new format is supported

### 2. Auto-detect separator
**File:** `backend/app/services/import_service.py`

- Try `;` first, then `\t`, then `,`
- Use first-line probe: count occurrences of each candidate separator

### 3. Structured error responses
**File:** `backend/app/routers/imports.py`

- Wrap parsing in try/except per row
- Return HTTP 422 with body: `{ "error": "parse_error", "details": [{ "row": 3, "column": "Dauer", "value": "...", "message": "..." }] }`

**File:** `frontend/src/pages/ImportPage.tsx`

- Detect structured error response (array under `details`)
- Render per-row error table below the import button

## Review items addressed

- IV.1 — Bessere Fehlerausgabe bei falschem CSV-Format
- IV.1 — Verschiedene Trennzeichen erlauben (Semikolon + Tab)
- IV.1 — Echtes Sage-Format mit `h:mm` Dauer unterstützen

## Verification

1. Import the review sample file → 1.5 h booked for Mustermann, Max
2. Same file with tab-separated → same result
3. File with wrong column names → error response names the missing column and row
