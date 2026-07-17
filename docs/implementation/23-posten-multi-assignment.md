# Mehrere Posten pro MA (Multi-Assignment) + UX für blockierende Limits

_Status: 📋 Design & Implementierungsplan_
_Datum: 2026-07-17_
_Betrifft: `models/membership.py`, `models/milestone.py`, `models/billing.py`, `services/planning.py`, `services/milestones.py`, `services/rebalancing.py`, `services/importer.py`, `services/invoices.py`, `routers/projects.py`, `routers/milestones.py`, `routers/imports.py`, `frontend/src/pages/ProjectDetailPage.tsx`, Alembic_
_Baut auf: [21-project-line-items.md](21-project-line-items.md)_

---

## 1. Ziel

Ein Mitarbeiter (MA) soll im **Posten-Modus** auf **mehrere Projektposten** buchbar/planbar sein — jeder Posten mit **eigenem Stundensatz** und **eigenem Budget**. Damit wird derselbe MA je nach Posten unterschiedlich verrechnet.

Motivation aus der Praxis (Nutzer, 2026-07-17):
- **Ist-Daten erzwingen es bereits.** Beim Sage-Import buchen MA real auf verschiedene Projektebenen → verschiedene Posten. Dieser Zustand muss abgebildet werden.
- **Asymmetrische Vertragsgrenzen.** Jeder Posten hat ein (meist vertraglich fixes) Budget. Posten mit **hohem** Satz dürfen i. d. R. **nicht überschritten** werden; Posten mit **niedrigem** Satz **schon** — man rechnet lieber mehr günstige statt teure Stunden ab. Dadurch wandert ein MA ggf. auf einen anderen Posten.
- **Mismatch-Sichtbarkeit.** Bucht ein MA auf einen ihm nicht zugewiesenen Posten, oder wird eine Projektebene bei aktiven Posten nicht erkannt, soll das geflaggt werden.

Verknüpft: **Punkt 3 „UX für blockierende Limits"** (§7) wird in denselben Umbau integriert, weil die Diagnose „warum wurde gekappt?" erst mit Posten-Granularität sauber möglich ist.

## 2. Ist-Stand & das Kernproblem

| Ebene | Granularität heute |
|---|---|
| **Ist** (`TimeBooking`) | **pro (MA, Projekt, Ebene/Posten, Tag)** — `billing_position_id` je Buchung (`models/timebooking.py:82`). Bildet Multi-Posten schon ab. |
| **Plan** (`ProjectMembership`) | **pro (MA, Projekt)**, trägt **max. 1** Posten (`billing_position_id`, nullable, `models/membership.py:26`). |
| **Plan-Split** (`MilestonePersonBudget`) | **genau 1 Zeile pro (Meilenstein, Person)** — `UniqueConstraint(milestone_id, person_id)` (`models/milestone.py:51`). |

**Der Bruch:** Ist ist Posten-granular, Plan ist person-granular. Die Rechen-Engine ist durchgängig auf `person_id` gebaut:
- `_person_available_hours` / `capacity_hours` lösen **eine** Membership via `.first()` auf (`planning.py:198`).
- `build_rate_map` / `effective_rate` keyen Sätze per `person_id` (`milestones.py:497,84`).
- `distribute_over_positions` gruppiert `{m.person_id … if billing_position_id == pos_id}` und `memb_by_pid = {m.person_id: m}` (`milestones.py:569–572`) → jede Person landet in **genau einem** Posten-Topf.

**Naive Freigabe = Doppelzählung:** Käme dieselbe Person in zwei Posten-Töpfen vor, ginge ihr *voller* Monats-Kapazitätspool in *beide* Töpfe → Verplanung auf bis zu das Doppelte der realen Stunden. Deshalb ist die Lösung nicht „Constraint entfernen", sondern „Verteil-Schlüssel und Kapazitäts-Wächter neu definieren".

## 3. Optionen (mit Bewertung)

### Option A — Zuweisungseinheit = (MA, Posten)  ✅ GEWÄHLT
Mehrere `ProjectMembership`-Zeilen pro (MA, Projekt), **jede mit genau einem** Posten, eigener `weekly_capacity_hours`, eigener `priority`, eigenem Zeitfenster. `MilestonePersonBudget` wird auf `(milestone, membership)` bzw. `(milestone, person, billing_position)` umgeschlüsselt.
- **Pro:** Plan-Granularität = Ist-Granularität → Plan-vs-Ist, Posten-Prognose und Mismatch-Flag natürlich; Satz/Kapazität/Priorität sauber *pro Posten* ausdrückbar (Voraussetzung für die asymmetrischen Überschreitungsregeln).
- **Contra:** Re-Keying zieht sich durch Engine, Rebalancing, Invoicing, Frontend; neuer **Kapazitäts-Wächter** nötig (Σ Kapazität eines MA ≤ reale Verfügbarkeit).
- **Risiko:** mittel-hoch. **Komplexität:** hoch.

### Option B — eine Membership + prozentualer Split (verworfen)
Eine Membership pro (MA, Projekt) + Join-Tabelle `MembershipPositionAllocation(membership_id, billing_position_id, share%)`; der Monats-Pool wird nach `share` zerlegt.
- **Contra:** Der Split ist eine **Planungsannahme**, matcht die real gebuchte Verteilung nicht → Plan-vs-Ist bleibt unscharf; Kapazität/Priorität bleiben *gemeinsam* (keine posten-spezifische Priorität). `MilestonePersonBudget` muss **trotzdem** pro Posten aufgeschlüsselt werden → die schwierigste Migration fällt genauso an. B spart nur genau die Teile, die A korrekt machen.
- **Risiko:** mittel. **Komplexität:** mittel. **Verworfen** (Nutzer: „ungenau/hingemogelt" — bestätigt).

### Option C — manuelle Posten-Stunden für geteilte MA (verworfen)
Auto-Verteilung bleibt „1 Posten pro MA"; für geteilte MA werden Posten-Stunden manuell je Monat gesetzt.
- **Contra:** löst den Automatik-Wunsch nur halb; laufende Handarbeit. **Verworfen.**

**Entscheidung:** **Option A** — „Aufwand ist kein Faktor, gewünscht ist eine saubere & stabile Lösung" (Nutzer), und die Ist-Daten sind bereits Posten-granular.

## 4. Betroffene bestehende Logik

**Angefasst:**
- Membership-Uniqueness + defensiver 409-Dedup (`routers/projects.py:446`) → Uniqueness = (person, project, billing_position_id).
- `MilestonePersonBudget`-Schema (`models/milestone.py:51`) → Re-Key + Migration; Invariante `Σ MPB.current_hours == Milestone.current_hours` bleibt gültig (nur mehr Zeilen).
- Kapazität (`planning.py:198` `.first()`, `milestones.py:228`) → pro Zuweisung; **neuer Σ-Kapazitäts-Wächter**.
- Verteilung (`distribute_budget`/`distribute_over_positions`, `milestones.py:335,552`) → Keying person→Zuweisung.
- Satz-Auflösung (`build_rate_map`/`effective_rate`, `milestones.py:497,84`).
- Posten-Restbudget (`_remaining_position_euro_budget`, `milestones.py:504`) → + asymmetrische Überschreitung (§6).
- Rebalancing/Preview (`rebalancing.py:106,147`).
- Import (`importer.py`) → + Mismatch-Check (§6).
- Frontend (`ProjectDetailPage.tsx`) → MA erscheint je Posten; Zuweisungs-Formulare; Plan-vs-Ist.

**Nicht betroffen (Stabilitätsanker):**
- **Simple-Modus (`position_mode = false`) bleibt vollständig unverändert.** Der Multi-Posten-Pfad lebt ausschließlich im Posten-Modus; die Änderung ist dort additiv.
- Abwesenheits-/Feiertags-/Netto-Kapazitätsberechnung pro MA (`net_hours`) — unverändert; nur ihre *Aufteilung auf Zuweisungen* ist neu.
- Σ-Budget-Invarianten der Posten (`line_items.py`) — unverändert.
- Rechnungsstellung ist bereits Posten-basiert (`invoices.py:151`) — profitiert.

## 5. Kapazitäts-Wächter (Korrektheits-Kern)

Da ein MA nun mehrere Kapazitäts-Zeilen hat, muss geprüft werden:

> Σ `weekly_capacity_hours` aller Zuweisungen eines MA (pro Zeitfenster, über alle Projekte) ≤ reale Verfügbarkeit (aus `default_weekly_hours`/`work_week_pattern` abzüglich Abwesenheiten/Feiertage).

Bei Überschreitung: **Flag/Warnung** (kein harter Block, da kurzfristige Über-100 %-Planung fachlich vorkommen kann), sichtbar in Team-Ansicht und Meilenstein-Diagnose.

## 6. Asymmetrische Posten-Überschreitung (Evolution von P4)

Doc 21 **P4** legt heute fest: Posten-Budget = **harte** Teil-Obergrenze; Verschiebung zwischen Posten nur **manuell**. Neu:

- Pro Posten ein Flag `cap_mode` (bzw. `overrunnable: bool`): **hart** (teuer, nie überschreiten) | **überschreitbar** (günstig, darf über Budget).
- Verteil-Logik: Läuft ein harter (teurer) Posten voll und hat der MA noch Kapazität, wird der Rest auf einen **überschreitbaren** (günstigeren) Posten desselben MA umgelenkt, statt still auf 0 h zu kappen.
- **Mismatch-Flagging (Import):**
  - *Unbekannte Projektebene bei aktiven Posten* → existiert bereits als harter `UnresolvedPositionsError` (`importer.py:395`); optional zu „Flag statt Abbruch" aufweichen.
  - *MA auf nicht-zugewiesenem Posten gebucht* → **neu**: Nachlauf-Check `TimeBooking.billing_position_id` vs. Zuweisungs-Set des MA; Treffer werden geflaggt.

## 7. UX für blockierende Limits (Punkt 3, integriert)

**Befund:** `distribute_budget`/`distribute_over_positions` liefern nur Zahlen und **verwerfen den Grund** der Kappung (Kapazität vs. Projektbudget vs. Posten-Budget). Einzige Warnung feuert nur, wenn der **ganze Monat** 0 h ist (`milestones.py:321–334`). Szenario „Posten aktiv, MA hat Zeit, aber sein Posten-Topf leer → still 0 h" bleibt unsichtbar.

**Lösung (in denselben Umbau):**
1. **Bindende Randbedingung pro Slot mitführen** — Verteil-Funktionen geben zusätzlich zurück, *was* gekappt hat (`capacity` | `project_budget` | `position_budget`). Pro Zuweilung im Klartext: „0 h — Posten ‚X' aufgebraucht, obwohl N h Kapazität frei".
2. **Posten-Ampel** in Team-/Meilenstein-Blick: Posten mit Rest(€) ≈ 0 rot + „bindet N MA auf 0 h".
3. **Neuberechnungs-Zusammenfassung** statt nur Änderungs-Zähler (`ResyncResultOut`): „X MA wegen Posten-Budget, Y wegen Projektbudget, Z wegen Kapazität gekappt".

API-Erweiterung: `MilestonePersonDetailOut` (`milestones.py:55`) um ein Grund-Feld; `MilestoneDetailOut.warnings` / `ResyncResultOut` um strukturierte Gründe.

## 8. Arbeitspakete (phasenweise, je 1 Sub-Issue)

- **WP1 — Datenmodell + Migration.** Mehrere Memberships pro (MA, Projekt); Uniqueness (person, project, posten); `MilestonePersonBudget` Re-Key auf (milestone, membership/posten) + Alembic-Migration; 409-Dedup anpassen.
- **WP2 — Engine Re-Keying + Kapazitäts-Wächter.** `capacity`, `distribute_*`, `rate_map`, Rebalancing/Preview auf Zuweisungs-Keying; Σ-Kapazitäts-Wächter (§5).
- **WP3 — Asymmetrische Posten-Überschreitung.** `cap_mode` je Posten; Umverteilung teuer→günstig in `distribute_over_positions` (§6).
- **WP4 — Import-Mismatch-Flagging.** MA↔Posten-Check; Behandlung unbekannter Ebenen (§6).
- **WP5 — Frontend.** MA je Posten in Team-Ansicht; Zuweisungs-Formulare; Plan-vs-Ist je Posten; Kapazitäts-/Mismatch-Warnungen.
- **WP6 — UX-Diagnose blockierende Limits (Punkt 3).** Grund pro Slot durchreichen; Klartext, Posten-Ampel, Neuberechnungs-Zusammenfassung (§7).

Reihenfolge: WP1 → WP2 → (WP3 ∥ WP4 ∥ WP6) → WP5. Simple-Modus bleibt in jeder Phase unberührt.
