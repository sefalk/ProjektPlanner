# Projektposten (Vertragsposten mit eigenem Satz & Budget)

_Status: 📋 Design & Implementierungsplan_
_Datum: 2026-07-15_
_Betrifft: `models/billing.py`, `models/membership.py`, `models/timebooking.py`, `services/milestones.py`, `services/rebalancing.py`, `services/importer.py`, `services/invoices.py`, `routers/projects.py`, `routers/imports.py`, `frontend/src/pages/ProjectDetailPage.tsx`, `SageMappingPage.tsx`_

---

## 1. Ziel

Optionale **Vertragsposten** je Projekt mit **eigenem Stundensatz** und **eigenem Budget** (wahlweise € oder Stunden — über den Satz äquivalent). Manche Verträge legen fest, wie viele Stunden je Satz vorgesehen sind; teure Sätze dürfen nicht überschritten, Stunden aber zu günstigeren Posten verschoben werden. Bisher lässt sich das nur mühsam über einzelne MA abbilden.

Aufbau auf den bestehenden **Rechnungsposten** (`BillingPosition`), die heute nur zur Abrechnungs-Zuordnung dienen und nicht in die Planung einfließen.

## 2. Grundregeln (verbindlich)

- **B1 (unverändert):** € ist primär; Stunden = € ÷ Satz. Gilt weiterhin pro Posten.
- **P1 — Posten sind optional, projektweise.** 0 Posten = heutiges Verhalten (per-MA-Satz, ein Gesamtbudget = „Simple-Modus"). ≥ 1 Posten = „Posten-Modus".
- **P2 — Satz lebt am Posten.** Im Posten-Modus wird jeder MA **genau einem** Posten zugewiesen; der effektive Satz kommt vom Posten. Im Simple-Modus gilt der per-MA-Satz (`billing_rate_per_hour`).
- **P3 — Budget-Invariante.** Ziel-Zustand: `Σ Posten-Budget(€) == Project.total_budget_euros`. **Während der Einrichtung** ist ein temporäres, nicht verteiltes **Restbudget erlaubt** (mit Warnung + Anzeige „offen: X €"), damit man mehrere Posten nacheinander anlegen kann. Neue Posten defaulten auf die offene Differenz. Ein Projekt mit Restbudget gilt als **unvollständig konfiguriert** (Hinweis); abschließend muss alles verteilt sein (`==`). Ein Überschreiten (`Σ > Gesamt`) wird blockiert.
- **P4 — Posten-Budget = harte Teil-Obergrenze.** Die automatische Verteilung reizt jedes Posten-Budget getrennt über die zugewiesenen MA aus (`Σ Stunden×Satz ≤ Posten-Budget`); sie verschiebt **nicht** selbstständig zwischen Posten. „Stunden zu günstigeren Sätzen verschieben" = Posten-Budgets manuell anpassen.
- **P5 — €/Std äquivalent.** Kanonisch wird `budget_euros` gespeichert; Std-Budget = `budget_euros ÷ Satz` (nur Eingabe/Anzeige).
- **P6 — Sage-Verknüpfung.** „Projektebene 1" (`TimeBooking.sage_project_level`) → Posten via projektbezogenem Mapping; jede Buchung trägt eine Posten-Referenz.

## 3. Ist-Stand (Kurz)

- `BillingPosition(position_number, description, budget_euros)` — nur Add/Delete, nicht editierbar, **kein Satz/Std**, **nicht in der Verteilung** (verteilt wird gegen `Project.total_budget_euros`).
- `ProjectMembership.billing_rate_per_hour` — Satz je MA.
- Verteilung: `distribute_budget(avail, rates, priorities, R)` mit einem globalen R = `total_budget_euros − abgerechnet − Overrides`.
- Import: `sage_project_level` wird gespeichert, aber **nicht ausgewertet**. `SageProjectMapping` mappt nur Projektname→Projekt.
- Abrechnung: `close_month` erzeugt **eine** `MonthlyInvoice` je (Projekt, Monat) mit einem gewählten `billing_position_id`.

## 4. Soll — Datenmodell (Alembic)

| Änderung | Feld | Zweck |
|---|---|---|
| Erweitern | `BillingPosition.billing_rate_per_hour: float` (Posten-Modus > 0) | Satz des Postens (P2) |
| Klarstellung | `BillingPosition.budget_euros` kanonisch | €-Budget; Std = €/Satz (P5) |
| Neu | `ProjectMembership.billing_position_id: int \| None` | MA → Posten (P2); null = Simple-Modus |
| Neu | `TimeBooking.billing_position_id: int \| None` | Buchung → Posten (P6), beim Import gesetzt |
| Neu | Modell `SagePositionMapping(project_id, sage_project_level, billing_position_id)` UNIQUE(project_id, sage_project_level) | Ebene→Posten je Projekt (P6) |

Invariante (Service-seitig, Posten-Modus): `Σ BillingPosition.budget_euros == Project.total_budget_euros`.

## 5. Soll — Verteilungsalgorithmus

- `distribute_budget` bleibt die reine Bucket-Funktion (unverändert).
- `initialize_milestones` / `_align_open_milestones` / Ziel-/Rebalance-Vorschau:
  - **Simple-Modus:** wie heute (ein Bucket, `Project.total_budget_euros`, per-MA-Satz).
  - **Posten-Modus:** MA je offenem Monat nach `membership.billing_position_id` gruppieren; **je Posten** verteilen mit `R_posten = posten.budget_euros − abgerechnet(posten) − Overrides(posten)` und `rate = Posten-Satz`. Locks/Overrides/geschlossene & gesperrte Monate wie gehabt.
- Effektiver Satz je MA: Helper `effective_rate(membership)` = Posten-Satz (wenn zugewiesen) sonst `billing_rate_per_hour`. Überall dort verwenden, wo heute `billing_rate_per_hour` steht (Verteilung, €-Anzeigen, close_month).

## 6. Soll — Sage-Import

- Neuer Schritt `resolve_position_mappings((project_id, sage_project_level)…)` analog `resolve_project_mappings`; unbekannte (Projekt, Ebene) → `UnresolvedPositionsError` (+ Mapping-UI, analog Projekt-Mapping).
- `TimeBooking.billing_position_id` beim Import setzen (nur Posten-Modus; sonst null).
- Simple-Modus-Projekte: kein Level-Mapping nötig (null).

## 7. Soll — Abrechnung (Monatsabschluss)

- Posten-Modus: je Monat **eine Invoice pro Posten** (Ist-Stunden/Beträge aus Buchungen mit diesem Posten). `R_posten` zieht die abgerechneten Beträge des Postens ab.
- Simple-Modus: unverändert (eine Invoice, gewählter Posten).
- Betrifft `close_month`, `reopen_month`, Rechnungen-Tab, Prognose/Ist-Logik → eigenes WP (WP6), inkl. Migration bestehender Invoices.

## 8. Soll — UI

- **Projekteinstellungen:** Posten **editierbar** (Satz, Budget €/Std-Umschalter), Bearbeiten/Löschen; Add mit Default = offene Differenz; Live-Konsistenzcheck `Σ == Gesamtbudget` (Warnung/Block bei Abweichung). Löschen nur ohne Zuweisungen/Abrechnungen.
- **Mitglieder-Tab:** MA → Posten-Auswahl (Posten-Modus); Satzspalte read-only (vom Posten).
- **Sage-Mapping-Seite:** Ebene→Posten je Projekt pflegen.
- **Meilenstein-Gesamt (Aufwand):** primär **nach Posten** aufschlüsseln; **aufklappbar** die bisherige per-MA-Sicht. €-Gesamt optional je Posten (Budget/Prognose/Rest).

## 9. Arbeitspakete

1. ✅ **WP1 — Datenmodell & Migrationen** (BillingPosition.rate, Membership.billing_position_id, TimeBooking.billing_position_id, SagePositionMapping) + `effective_rate`-Helper. Migration `d4a8c1f60e29`. Tests.
2. ✅ **WP2 — Posten-CRUD & Budget-Konsistenz** (`services/line_items.py`; Router PUT/DELETE/budget-state, Σ-Invariante, Default-Restdifferenz, Lösch-Guard) + Settings-UI (`BillingPositionsSection`, Konsistenz-Banner).
3. ✅ **WP3 — Verteilung je Posten** (`distribute_over_positions` in initialize/resync/preview; effektiver Satz überall inkl. Ziel-Budget/Meilenstein-Detail). Property-Tests: `Σ(Std×Satz) ≤ Posten-Budget` je Posten.
4. ✅ **WP4 — MA→Posten-Zuweisung** (`_validate_membership_position`: Pflicht im Posten-Modus = Projekt hat bepreisten Posten) + Mitglieder-UI (Posten-Spalte, PositionSelect, Satz read-only vom Posten).
5. ✅ **WP5 — Import Level→Posten** (`resolve_position_mappings`, `UnresolvedPositionsError`, TimeBooking-Verknüpfung; CRUD `/sage-position-mappings`) + Sage-Mapping-UI.
6. ✅ **WP6 — Abrechnung je Posten** (forward-only): `close_month` erzeugt im Posten-Modus **eine Rechnung je Posten** (Buchungen nach `TimeBooking.billing_position_id` gesplittet, Satz vom Posten; nicht zugeordnete Buchungen → Standard-Posten). `reopen_month` löscht **alle** Rechnungen des Monats. Bestehende Rechnungen bleiben unangetastet (Entscheidung 2026-07-16). Frontend: Abschluss-Dialog erklärt den Split; Meilenstein-Totals aggregieren mehrere Rechnungen je Monat.
7. ✅ **WP7 — Meilenstein-Aufschlüsselung nach Posten** (Panel „Aufwand nach Posten", aufklappbar MA; €/Std/Rest).
8. ✅ **WP8 — Expliziter Modus-Schalter** (`Project.position_mode`, Migration `e5b9d2c73a41`). Einziger Trigger für Verteilung/Validierung/Import/Abrechnung. Aktivierung geführt via `can_enable_position_mode` (bepreister Posten, Σ==Gesamt, alle aktiven MA zugewiesen). Umstieg für Bestandsprojekte = Schalter aktivieren. _Offen: Anwenderdoku/Hilfetexte._

Jeder WP schließt mit Unit-/Property-Tests ab; harte Invarianten (B1, P3, P4) dürfen nie brechen.

### Modus-Trigger (Stand WP8 — vereinheitlicht)

Einziger Auslöser für den Posten-Modus ist das explizite Flag **`Project.position_mode`** (§21 WP8). `is_position_mode(project)` liest es; Verteilung, MA-Validierung, Import-Ebenen-Mapping und Abrechnung richten sich danach. Aktivierung ist geführt (`can_enable_position_mode`): bepreister Posten vorhanden, Σ Posten-Budget == Gesamtbudget, jeder aktive MA einem Posten zugewiesen. Deaktivieren ist jederzeit möglich. Damit entfällt die frühere Migrations-Kante (nicht zugewiesene MA), da der Modus erst aktivierbar ist, wenn alle MA zugewiesen sind.

**Forward-only-Abrechnung (WP6):** Historisch im Simple-Modus abgeschlossene Monate behalten ihre Rechnung; deren Ist-Beträge sind nicht auf die neuen Posten aufgeteilt. Das Posten-Panel kann dadurch für Bestandsprojekte eine Posten-Überschreitung anzeigen (z. B. „Senior" über Teilbudget), obwohl das Projektbudget gesamt eingehalten ist — bewusst als ehrliches Signal, keine Rück-Migration alter Rechnungen.

## 10. Offene Punkte / Risiken

- **Bestandsprojekte:** Umstieg Simple→Posten bei vorhandener Historie/Abrechnung — Migrationspfad (WP8). Rückwärtskompatibilität nicht zwingend (Altdaten dürfen brechen, analog Doc 20 §1) — Entscheidung offen.
- **Abrechnung:** heutiges „ein Invoice, ein Posten"-Modell muss auf per-Posten umgestellt werden; bestehende Invoices migrieren.
- **Σ Posten < Gesamtbudget?** Entscheidung: `==` erzwingen (Default-Restdifferenz erleichtert das). Alternativ „nicht zugeordnetes Restbudget" erlauben — zu klären.
- **Dedup-Constraint** `TimeBooking` enthält bereits `sage_project_level`; `billing_position_id` ist davon abgeleitet (kein neuer Constraint nötig).
- **`total_budget_hours`** (vestigial) ggf. in diesem Zug entfernen.
