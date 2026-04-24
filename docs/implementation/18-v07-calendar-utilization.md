# Step 18 — v0.7 Calendar Utilization Improvements

_Derived from iPEP planning-tool review on 2026-04-24._

## Context

The calendar grid works but lacks utilization feedback. Compared to iPEP
(https://ipep-prd.web.app/assignments), the following gaps were identified:

| Priority | Feature | Description |
|---|---|---|
| A1 | Today indicator | Highlight today's column (blue tint + top border) |
| A2 | Utilization badge | Color-coded % per person (green / amber / red) |
| A3 | Overbooking in cells | Show overflow portion in red (remove Math.min cap) |
| A5 | %/h toggle | Chip to switch bar tooltip between hours and percent |
| A4 | Project label in bars | Show project number + % in wider bars |
| B3 | Overbooking validation | Warning when membership would cause > 100% in a month | ✅ |
| B2 | Expandable rows | Sub-rows per project per person | ✅ |
| B1 | Donut chart | SVG gauge in person column (optional, lower priority) | deferred |
| C1 | Quarter/Year view | Aggregate multi-month views | deferred |

Items A1–A5 are pure frontend changes to `CalendarPage.tsx`.
B3 requires a backend check endpoint + frontend confirmation dialog.
B1, B2, C1 are deferred for a future step.

---

## A1 — Today indicator

**File:** `frontend/src/pages/CalendarPage.tsx`

In the `<thead>` column loop and in `DayCell`:
- Compare `isoDate(year, month, day)` against `todayStr = isoDate(today.getFullYear(), today.getMonth()+1, today.getDate())`.
- Header `<th>`: add `bg-blue-50 border-t-2 border-blue-400` when `dateStr === todayStr`.
- Body `<td>`: apply `border-l border-blue-200` left-border for a subtle column highlight.

---

## A2 — Utilization badge per person

**File:** `frontend/src/pages/CalendarPage.tsx`

In the sticky person `<td>`:
- Calculate total weekly capacity for the person in the current month:
  `sum(m.weekly_capacity_hours for each membership active during the month)`.
- Divide by `person.default_weekly_hours` → `utilPct` (0.0 – 1.0+).
- Render a small colored badge next to the name:
  - `< 80%`: `bg-gray-100 text-gray-500` (underutilized)
  - `80–100%`: `bg-green-100 text-green-700` (ok)
  - `> 100%`: `bg-red-100 text-red-700` (overbooked)
- Show `Math.round(utilPct * 100) + '%'` inside the badge.

---

## A3 — Overbooking visible in cells

**File:** `frontend/src/pages/CalendarPage.tsx`

In `DayCell`, remove `Math.min(1, frac)`:
```tsx
// Before:
const frac = Math.min(1, m.weekly_capacity_hours / totalCap)
// After:
const frac = m.weekly_capacity_hours / totalCap
```
When multiple memberships sum > 100%, the bars overflow the cell height.
To show the overflow visually without breaking layout, cap the bar at 100% height
but color the last bar (or any bar > 100%) partially red:
- Split each bar into a normal portion (up to available height) and an overflow indicator.
- Simpler approach: if `sum(fracs) > 1`, tint the cell background red.

---

## A5 — %/h display toggle

**File:** `frontend/src/pages/CalendarPage.tsx`

Add a toggle chip in the filter bar:
```tsx
const [showPct, setShowPct] = useState(false)
```
`DayCell` receives `showPct` prop.
- When `showPct=true`: bar tooltip shows `${Math.round(frac*100)}%` instead of `${h} h/Woche`.
- Utilization badge also uses same format.
- The toggle chip: "h / %" in LayerChip style.

---

## A4 — Project label in bars

**File:** `frontend/src/pages/CalendarPage.tsx`

In `DayCell`, when `frac > 0.3` (bar is tall enough), render a short label inside:
```tsx
{frac > 0.3 && (
  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-gray-700 leading-none select-none">
    {m.project_number?.split('-')[0]}
  </span>
)}
```
This shows the project number prefix (e.g. "PRJ-001") in taller bars.

---

## B3 — Overbooking validation (backend + frontend)

### Backend
**File:** `backend/app/routers/memberships.py`

On `POST /memberships` and `PUT /memberships/{id}`, after saving, compute utilization:
```python
# For each month of the new membership, sum weekly_capacity_hours for this person
# If > person.default_weekly_hours: add to warnings list
```
Return `{ "membership": {...}, "warnings": ["April 2026: 120% (48/40 h)" ] }`.
HTTP 201 still — warnings are non-blocking.

### Frontend
**File:** `frontend/src/pages/ProjectDetailPage.tsx`

After creating/updating a membership, check for `warnings` in response.
If present, show a dismissable yellow alert banner below the membership table.

---

## Files changed

| File | Change |
|---|---|
| `frontend/src/pages/CalendarPage.tsx` | A1 today indicator, A2 util badge, A3 overbooking cells, A5 toggle, A4 bar labels |
| `backend/app/routers/memberships.py` | B3 utilization warnings in membership create/update response |
| `frontend/src/pages/ProjectDetailPage.tsx` | B3 show warnings after membership save |

---

## Verification

1. Navigate to current month → today's column has blue top border and light blue header.
2. Person at 120% shows red badge "120%" in sticky column; cell background has red tint.
3. Toggle "%/h" chip → tooltips switch between hours and percent.
4. Bar taller than 30% of cell shows project number label.
5. Add membership that overbooking → yellow warning appears (no block).
