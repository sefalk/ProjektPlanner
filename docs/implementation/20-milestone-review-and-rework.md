# Review & Rework: Meilenstein-Planung

_Status: 📋 Analyse & Implementierungsplan_
_Datum: 01.07.2026_
_Autor: Analyse auf Basis des Code-Stands (PoC, Juni 2026)_
_Betrifft: `backend/app/services/milestones.py`, `backend/app/services/rebalancing.py`, `backend/app/services/planning.py`, `backend/app/routers/milestones.py`, `backend/app/routers/projects.py`, `frontend/src/pages/ProjectDetailPage.tsx`_

---

## 1. Ziel dieses Dokuments

Die Meilenstein-Rubrik in der Projektansicht (Planung, Anpassung, Rebalancing) ist im aktuellen PoC-Zustand nicht funktional bzw. konzeptionell inkonsistent. Dieses Dokument

1. beschreibt das **Ist-Verhalten** entlang der relevanten User-Stories,
2. listet die **konkreten Bugs und konzeptionellen Lücken** auf,
3. formuliert ein **Soll-Konzept** samt eigener Vorschläge, das als **Implementierungsgrundlage** dient.

Es ersetzt keine der bestehenden Docs, sondern korrigiert/präzisiert v.a. `16-v05-milestone-enhancements.md`.

> **Grundsatz Rückwärtskompatibilität (entschieden):** Kompatibilität mit Altdatensätzen ist **nicht** erforderlich. Bestehende Meilenstein-/Budgetdaten dürfen im Zuge der Umstellung ungültig werden. Bevorzugt wird ein **sauberer neuer Build/Version** mit frischem Schema statt aufwändiger Datenmigrationen. Das vereinfacht mehrere Arbeitspakete (kein Migrations-Fallback, kein Bestandsschutz außer für fachlich noch relevante gesperrte/abgerechnete Monate — und selbst die nur, wenn fachlich gewünscht).

---

## 2. Fachliche Grundregeln (Soll)

Aus Projektbeschreibung und Review v0.1.0 (Punkt I.6 und I.8) ergeben sich die maßgeblichen Regeln. Diese sind die Messlatte für die gesamte Analyse:

- **B1 — Budget ist zentral, nicht die Stunden.** Das €-Budget darf **niemals überschritten** werden. Es darf unterschritten werden; idealerweise wird es genau ausgereizt. Stunden ergeben sich aus den vereinbarten Stundensätzen, nicht umgekehrt.
- **B2 — Projekt-Wochenstunden der Person haben Priorität.** Die im Projekt für eine Person hinterlegten geplanten Wochenstunden (`ProjectMembership.weekly_capacity_hours`) sind eine **harte Obergrenze**. Sie dürfen nicht überschritten werden — auch dann nicht, wenn dadurch das Budget nicht voll ausgereizt wird.
- **B3 — Verfügbarkeit korrekt abbilden.** Die planbare Kapazität berücksichtigt: Arbeitszeitmodell (`work_week_pattern`), Feiertage (global), geplante Abwesenheiten (Urlaub/Fortbildung), ungeplante Abwesenheiten (nicht verplanter Resturlaub gleichverteilt; pauschale Krankheits-/Fortbildungstage aus zentraler Konfiguration).
- **B4 — Empfehlungen statt Zwang (projektübergreifende Restkapazität).** Maßgeblich sind die **allgemeinen** verfügbaren Wochenstunden der Person aus ihrem Arbeitsmodell (`Person.default_weekly_hours`). Bleibt nach Abzug **aller** über **alle** Projekte verplanten Wochenstunden (Σ `ProjectMembership.weekly_capacity_hours` im überlappenden Zeitraum) noch Kapazität übrig, soll ein **Hinweis/Empfehlung** erscheinen, dass die im jeweiligen Projekt festgelegten Projekt-Wochenstunden **erhöht** werden könnten — **sofern das €-Budget dadurch nicht überschritten wird (B1)**. Rein informativ, keine automatische Verplanung. (Es geht also **nicht** um freie Reste *innerhalb* der bereits festgelegten Projekt-Wochenstunden, sondern um noch gar nicht auf Projekte verteilte allgemeine Kapazität.)
- **B5 — Konsistenz über die Zeit.** Abgeschlossene (gesperrte) Monate sind fix; bereits verbrauchtes Budget/Stunden dieser Monate müssen bei jeder Neuberechnung/Verteilung über die offenen Monate abgezogen werden.
- **B6 — MA-Priorität bei der Budgetverteilung (optional, projektspezifisch).** Reicht das Budget nicht für die volle Kapazität aller MA, kann je Projekt eine **Prioritätenreihenfolge** der MA gesetzt werden. Höher priorisierte MA werden **zuerst** bis zu ihrer Kapazität mit Budget versorgt; niedriger priorisierte erhalten den Rest. **Gleichpriorisierung** ist erlaubt (mehrere MA auf gleicher Stufe → Aufteilung untereinander proportional). Ohne gesetzte Prioritäten sind alle MA gleichrangig (Default = rein proportional, B1/B2 unberührt).

### 2.1 Begriffsdefinitionen (verbindlich)

Diese Begriffe werden im gesamten Dokument und im Code einheitlich verwendet:

| Begriff | Feld/Quelle | Bedeutung |
|---|---|---|
| **Verfügbar** (`avail`) | `_person_available_hours` | Netto planbare Kapazität einer Person je Monat: Bruttostunden aus `weekly_capacity_hours` × Arbeitsmuster, minus Feiertage/Abwesenheiten/Rest-Urlaubs-/Krank-/Fortbildungsschätzung. **Immer ≤ Wochenstunden-Äquivalent** (deshalb ist `avail` der einzige bindende Personendeckel, siehe §6.2). |
| **Plan / Baseline** | `MilestonePersonBudget.initial_hours` | Die **einmal bei Anlage** der Budgetzeile festgeschriebene Planstunde. Historische Referenz, wird durch Resync/Rebalancing **nicht** verändert. Basis für Drift. |
| **Aktuell** | `MilestonePersonBudget.current_hours` | Der **lebende** Planwert nach manuellen Anpassungen, Resync und Rebalancing. |
| **Gebucht** | `TimeBooking.net_hours` (nicht exkludiert) | Aus Sage importierte Ist-Stunden. |
| **Restbudget** (`R`) | abgeleitet | `total_budget_euros − Σ(abgerechnete Beträge gesperrter Monate)`. Das über die offenen Monate verteilbare €-Budget (B5). |
| **Prognose** | abgeleitet | Erwarteter Endverbrauch = abgerechnet (gesperrt) + `current`-Kosten offener Monate. Für die Budget-Ampel im Kalender-Chart (Review III.7). |
| **Drift** | abgeleitet | `Σ Gebucht − Σ Plan(Baseline)` je Person (Ist vs. ursprünglicher Plan). |

---

## 3. Ist-Architektur (Kurzüberblick)

**Datenmodell**
- `Milestone` = ein Kalendermonat eines Projekts, mit `initial_hours`, `current_hours`, `status` (open/closed), `is_locked`.
- `MilestonePersonBudget` = Stundenanteil einer Person je Meilenstein (`initial_hours`, `current_hours`).
- Invariante (Service-seitig): `SUM(MilestonePersonBudget.current_hours) == Milestone.current_hours`.

**Zentrale Funktionen**
- `initialize_milestones(project_id, force)` — legt Meilensteine + Personen-Budgets an; verteilt Budget/Stunden.
- `_person_available_hours(...)` — verfügbare Kapazität einer Person je Monat (feiertags-, abwesenheits-, muster-bewusst).
- `update_person_budget(...)` — manuelle Anpassung eines Personen-Budgets, synchronisiert Milestone-Summe.
- `suggest_rebalancing / apply_rebalancing` — verteilt `current_hours` je Meilenstein proportional zur **rohen** Kapazität um.
- `close_month / reopen_month` — sperrt/entsperrt den Meilenstein beim Monatsabschluss.

**Frontend** (`ProjectDetailPage.tsx`)
- Tab „Meilensteine": Tabelle je Monat mit Plan(Std./€), Aktuell(Std./€, Fortschrittsbalken gebucht/geplant), Status, Abschließen/Öffnen; expandierbare Personen-Zeilen mit Verfügbarkeit, Plan, Aktuell, Gebucht, Eff. PWS, Δ PWS, Arbeits-/Abwesenheits-/Feiertage; Inline-Edit (Bleistift); Summenzeile.
- Tab „Rebalancing": Drift-Tabelle (Ist vs. Plan) + Verteilungsvorschlag + „Anwenden".

---

## 4. User-Story-Analyse (Ist-Verhalten & Befunde)

### US-A: Meilensteine anlegen — **ohne** MA im Projekt
- **Ist:** `initialize_milestones` legt pro Monat einen Meilenstein mit `initial_hours = current_hours = 0` an (keine Memberships → keine Budgets). Frontend blockt „Initialisieren" korrekt, wenn `memberships.length === 0` (zeigt Fehler „Bitte zuerst Mitglieder anlegen").
- **Befund:** Funktioniert grundsätzlich. Kleiner Widerspruch: Der Service erlaubt 0-Stunden-Meilensteine, das UI verbietet den Einstieg. **Entschieden (s. §8.1):** Nullmeilensteine ohne Personal sind **nicht** zulässig — der Guard gehört ins **Backend** (`initialize_milestones` wirft, wenn keine aktive Membership existiert), nicht nur ins UI.

### US-B: Meilensteine anlegen — **mit** MA im Projekt
- **Ist:** Pro Monat und aktivem `ProjectMembership` wird ein `MilestonePersonBudget` erzeugt. `initial_hours` = verfügbare Kapazität (`_person_available_hours`) **× Budget-Skalierung** (`month_scale`).
- **Budget-Skalierung (€-Pfad):**
  `plan_euros(Monat) = total_budget_euros × (Kalender-Arbeitstage Monat / Σ Kalender-Arbeitstage aller neuen Monate)`, dann
  `scale = plan_euros / available_cost`, wobei `available_cost = Σ(Kapazität × Stundensatz)`.
- **Befunde (gravierend):**
  - **BUG-1 (verletzt B1/B2): `scale` kann > 1 werden.** Reicht die vorhandene Kapazität nicht, um den zugewiesenen €-Anteil zu verbrauchen, werden die Personenstunden **über die verfügbare Kapazität hinaus hochskaliert** (das UI markiert das sogar als „Überbucht"). Das widerspricht direkt B2 (Wochenstunden = harte Obergrenze) und dem Grundgedanken B1 (Stunden folgen Budget, nicht umgekehrt: hier wird fiktiv Stundenmenge erfunden, um das Budget rechnerisch zu treffen).
  - **BUG-2 (verletzt B5): Gesperrte Monate werden bei der Budgetverteilung ignoriert.** `total_budget_euros` wird bei `force=false` nur über die **neuen** Monate verteilt; bereits existierende/abgeschlossene Monate und deren verbrauchtes Budget werden nicht abgezogen. Nach Teil-Abschlüssen + erneuter Initialisierung wird das **Gesamtbudget mehrfach verplant** → Budgetüberschreitung.
  - **BUG-3: Monate mit Kapazität 0, aber positiven Kalender-Arbeitstagen** bekommen `plan_euros > 0`, aber `available_cost = 0 → scale = 0`. Das für diesen Monat reservierte Budget „verschwindet" (wird keinem anderen Monat zugeschlagen) → systematische **Budget-Unterausnutzung** und Fehlverteilung.
  - **Konzept:** Budget wird nach **Kalender-Arbeitstagen** verteilt, die tatsächliche Verteilung skaliert aber nach **personenspezifischen Kosten**. Beides passt nicht zusammen (unterschiedliche Bezugsgrößen), was die Verteilung schwer nachvollziehbar macht.

### US-C: Meilensteine anpassen — **neuer MA kommt hinzu**
- **Ist:** Das Anlegen einer Membership (`POST .../memberships`) **stößt keine Meilenstein-Aktualisierung an**. Erst ein erneutes „Initialisieren" (force=false) repariert Meilensteine über den `repair_milestones`-Pfad und fügt fehlende Personen-Budgets hinzu.
- **Befunde:**
  - **BUG-4 (verletzt B1): Reparatur ignoriert die Budget-Skalierung.** Im Repair-Pfad wird das neue Personen-Budget mit `initial_hours = stats.hours` **ungeskaliert** eingefügt (`month_scale` wird nicht angewandt). Bestehende Personen haben geskalierte Werte, der neue MA rohe Kapazität → **inkonsistente Mischkalkulation** und der Meilenstein-Total wächst unkontrolliert → Budget kann überschritten werden.
  - **UX-Bug:** Der Nutzer muss den Zusammenhang „Membership ändern → Meilensteine neu initialisieren" selbst kennen. Es gibt keinen automatischen Trigger und keinen Hinweis, dass die Meilensteine veraltet sind.

### US-D: Meilensteine anpassen — **geplante Stunden eines MA ändern** (Membership `weekly_capacity_hours`)
- **Ist:** `PUT .../memberships/{id}` ändert nur die Membership. **Meilensteine/Budgets werden nicht angepasst.** Ein `force=false`-Reinit überspringt existierende Monate komplett (nur fehlende Personen werden ergänzt), ändert also **keine** bereits vorhandenen Personen-Budgets. Nur `force=true` rechnet neu — verwirft dabei aber **alle manuellen Anpassungen** offener Monate.
- **Befund — BUG-5 (Kernproblem der Story):** Es gibt **keinen Weg, die geänderten Wochenstunden eines bestehenden MA in bestehende offene Meilensteine zu übernehmen**, ohne entweder gar nichts zu tun (force=false) oder alles zu verwerfen (force=true). Genau der häufigste Anpassungsfall ist damit nicht bedienbar.

### US-E: Meilensteine anpassen — **manuell** (Inline-Edit)
- **Ist:** `PUT .../persons/{person_id}` bzw. `.../budgets/{budget_id}` setzt `current_hours` und synchronisiert die Milestone-Summe. Sperre wird respektiert (409 bei `is_locked`).
- **Befunde:**
  - **BUG-6 (verletzt B1/B2): Keinerlei Validierung gegen Budget oder Kapazität.** Es wird beliebig viel erlaubt (nur `>= 0`). Weder Projekt-Budget (€) noch verfügbare Kapazität noch Wochenstunden-Obergrenze werden geprüft. Der Nutzer bekommt kein hartes Limit und keine Warnung.
  - Positiv: Invariante `SUM(budget) == milestone.current` wird korrekt gehalten (durch Tests abgedeckt).

### US-F: MA aus Projekt entfernen (eigenes Szenario)
- **Ist:** `DELETE .../memberships/{id}` löscht nur die Membership. Die zugehörigen `MilestonePersonBudget`-Zeilen bleiben bestehen.
- **Befund — BUG-7 (Datenleiche):** Verwaiste Budgets werden **nicht** entfernt. Der Repair-Pfad bereinigt überzählige Personen nur, wenn ein Meilenstein ohnehin zur Reparatur markiert wird — das passiert aber nur, wenn eine Person **fehlt** (`current_person_ids - existing_person_ids` nicht leer), nicht wenn eine Person **zu viel** ist. Folge: Der gelöschte MA zählt weiterhin in `Milestone.current_hours` und in Drift/Rechnungen mit, bis zufällig ein neuer MA die Reparatur auslöst.

### US-G: Rebalancing / „Auto-rebalanced"
- **Ist:** `suggest_rebalancing` verteilt je offenem Meilenstein die **bestehende** `current_hours`-Summe proportional zur **rohen** Kapazität (`_person_hours_in_month`) um.
- **Befunde:**
  - **BUG-8 (Inkonsistenz): Zwei verschiedene Kapazitätsformeln.** Init nutzt `_person_available_hours` (feiertags-, abwesenheits-, muster-bewusst), Rebalancing nutzt `_person_hours_in_month` (roh: nur Arbeitstage × h/5, **ohne** Feiertage/Abwesenheiten/`work_week_pattern`). Vorschläge widersprechen damit systematisch dem initialen Plan; Teilzeit-/4-Tage-Personen werden **überproportional** eingeplant.
  - **BUG-9 (verletzt B1): Rebalancing verändert die Meilenstein-Summe nicht.** Es schichtet nur zwischen Personen um. Der eigentliche Review-Wunsch (I.8) — eine „Auto-rebalanced"-Spalte, die die **Differenz zum Budget** über die offenen Monate/noch nicht verbuchten Tage verteilt, um das **Budget voll auszureizen** — ist damit **nicht umgesetzt**.
  - **BUG-10: Drift wird beim Vorschlag ignoriert.** `compute_drift` (Ist vs. Plan) wird zwar berechnet und angezeigt, fließt aber **nicht** in `suggest_rebalancing` ein. Bereits gebuchte Stunden (auch aus abgeschlossenen Monaten) beeinflussen die Vorschläge für offene Monate nicht.
  - **Spec-Abweichung Frontend:** Die „Rebalanciert"-Spalte sollte laut Doc 16 **in der Meilenstein-Tabelle** stehen; tatsächlich existiert nur ein separater Rebalancing-Tab.

### US-H: Abwesenheits-/Urlaubsberücksichtigung (quer zu allen Stories)
- **Ist:** `_vacation_estimate_for_month` verteilt `contingent.total_days / 12` pauschal pro Monat, sofern in **diesem** Monat kein konkreter Urlaub liegt. Krankheit/Fortbildung analog aus Settings (`sick_days_per_year`/12, `training_days_per_year`/12).
- **Befunde:**
  - **BUG-11 (verletzt B3): Bereits genommener Urlaub wird nicht abgezogen.** Der Schätzwert basiert auf `total_days`, **nicht** auf dem Rest (`total_days − bereits genommen`). Eine Person, die ihren Jahresurlaub schon verbraucht hat, bekommt weiterhin ~2,5 Tage/Monat abgezogen → Kapazität wird zu niedrig geschätzt. (Die korrektere Logik existiert bereits in `planning.py::estimated_vacation_days`, wird von `milestones.py` aber nicht genutzt → **Code-Duplikat mit divergierender Semantik**.)
  - **Spec-Abweichung:** Doc 16 fordert Verteilung des **Rest**urlaubs über die **verbleibenden Projektmonate** unter Berücksichtigung des Projektzeitraums. Implementiert ist `/12` (bewusst gegen Über­schätzung bei Kurzprojekten geändert, aber jetzt weder „Rest" noch „Projektzeitraum" korrekt).
  - **Kleinere Punkte:** Krank-/Fortbildungs-Schätzung wird auch bei unterjährigen/teilmonatigen Memberships voll mit 1/12 angesetzt (nicht anteilig zu effektiven Tagen). Feiertags-Abruf-Fehler fällt still auf „0 Feiertage" zurück → Kapazität wird in dem Fall überschätzt.

### US-I: Auslastungs-Empfehlung (B4)
- **Ist:** Das Frontend zeigt „Eff. PWS", „Δ PWS" und färbt Plan-Unter-/Überbuchung. Das ist ein passiver Hinweis auf Projekt-*interner* Ebene. Für die projektübergreifende Sicht existiert bereits `_membership_overbooking_warnings` — allerdings nur für **Über**buchung (> 100 %), nicht für den umgekehrten Fall.
- **Befund:** Es gibt **keine aktive Empfehlung** im Sinne von B4: „MA X hat aus seinem Arbeitsmodell noch `frei` h/Woche ungenutzte allgemeine Kapazität (allgemeine Wochenstunden − Summe aller Projekt-Wochenstunden) — die Projekt-Wochenstunden in diesem Projekt könnten erhöht werden, solange das Budget es zulässt." B4 ist damit nur ansatzweise erfüllt (die Datengrundlage existiert, die Empfehlung fehlt).

---

## 5. Bug-Übersicht (priorisiert)

| # | Schweregrad | Ort | Kurzbeschreibung | Verletzt |
|---|---|---|---|---|
| BUG-1 | **Hoch** | `milestones.py` (Budget-Skalierung) | `scale > 1` überbucht Personen über verfügbare Kapazität | B1, B2 |
| BUG-2 | **Hoch** | `milestones.py` (Init €-Pfad) | Gesperrte Monate & Restbudget nicht berücksichtigt → Budget mehrfach verplant | B1, B5 |
| BUG-4 | **Hoch** | `milestones.py` (Repair-Pfad) | Neuer MA wird ungeskaliert eingefügt → Total wächst, Budget sprengbar | B1 |
| BUG-6 | **Hoch** | `milestones.py` / Router (Edit) | Manuelle Anpassung ohne Budget-/Kapazitäts-/Wochenstunden-Validierung | B1, B2 |
| BUG-9 | **Hoch** | `rebalancing.py` | „Auto-rebalance" reizt Budget nicht aus (nur Umverteilung, kein Erreichen des Budgets) | B1 (Ziel) |
| BUG-5 | **Mittel** | Router memberships + `milestones.py` | Änderung der Wochenstunden bestehender MA nicht in offene Meilensteine übernehmbar (außer destruktiv) | B2 |
| BUG-7 | **Mittel** | Router `delete_membership` | Verwaiste `MilestonePersonBudget` nach MA-Löschung | Datenintegrität |
| BUG-8 | **Mittel** | `rebalancing.py` | Andere Kapazitätsformel als Init (roh vs. netto) → widersprüchliche Vorschläge | B3 |
| BUG-11 | **Mittel** | `milestones.py` (Urlaubsschätzung) | Resturlaub nicht abgezogen; divergiert von `planning.py` | B3 |
| BUG-3 | **Mittel** | `milestones.py` (Init €-Pfad) | Monate ohne Kapazität „verlieren" ihr Budget-Segment | B1 (Ausnutzung) |
| BUG-10 | **Niedrig** | `rebalancing.py` | Drift fließt nicht in Vorschläge ein | B5 |
| — | **Niedrig** | Frontend | „Rebalanciert"-Spalte fehlt in Meilenstein-Tabelle (nur separater Tab) | Spec 16 |
| — | **Niedrig** | Frontend/Service | Kein automatischer „Meilensteine veraltet"-Hinweis nach Membership-Änderung | UX |

---

## 6. Soll-Konzept & Vorschläge (Implementierungsgrundlage)

### 6.1 Einheitliche, kapazitätsgetreue Berechnung
- **V1:** `rebalancing.py` **und** Init verwenden **dieselbe** Kapazitätsfunktion `_person_available_hours` (netto: Muster, Feiertage, Abwesenheiten, Rest-Urlaubsschätzung). `_person_hours_in_month` (roh) wird nur noch als bewusst dokumentierte Ausnahme verwendet oder entfernt. Behebt BUG-8.
- **V2:** Urlaubsschätzung auf `planning.py::estimated_vacation_days` konsolidieren (Restkontingent = `total_days − bereits genommen`, verteilt über verbleibende Projektmonate/-tage). Duplikat in `milestones.py` entfernen. Behebt BUG-11. Kurzprojekt-Überschätzung durch Deckelung `min(estimate, verfügbare Resttage)` beibehalten.

### 6.2 Budget als harte Obergrenze, `avail` als harter Personendeckel
- **V3 — Kappung bei der Verteilung (Kernänderung).** Zentrale Erkenntnis: Es gibt **nur zwei harte Grenzen**, nicht drei.
  - **Personendeckel = `avail`.** Da `avail` bereits aus `weekly_capacity_hours` abgeleitet ist (Brutto minus Abzüge), ist `avail` **immer ≤** dem Wochenstunden-Äquivalent. Solange nie über `avail` hinaus geplant wird, ist B2 **automatisch** erfüllt — eine separate Wochenstunden-Prüfung ist redundant und entfällt.
  - **Budgetdeckel = `R`** (Restbudget, s. §2.1) über alle offenen Monate (B1, B5).
  - Der bisherige Fehler (`scale = plan_euros / available_cost` je Monat, kann > 1 werden) wird durch **einen einzigen globalen, nach unten begrenzten Skalierungsfaktor** ersetzt. Details und Formel: **§6.6**. Behebt BUG-1, BUG-2, BUG-3.
- **V13 — Optionale MA-Priorität (B6).** `ProjectMembership.priority` steuert bei knappem Budget die tier-weise Auffüllung (§6.6). Rein additiv: ohne gesetzte Priorität bleibt das Verhalten proportional. Steuert die *einzige* zulässige Bevorzugung einzelner MA (nicht über Stundensätze).
- **V4 — `total_budget_hours` synchron halten oder entfernen (entschieden, s. §8.5).** Gemäß Review I.6 ist € führend. `total_budget_hours` wird **nur** beibehalten, wenn es jederzeit als **abgeleiteter Sync-Wert** aus den geplanten Stunden **× individuellen Stundensätzen** (`billing_rate_per_hour` je Membership) konsistent zum €-Budget gehalten werden kann. Ist das nicht mit vertretbarem Aufwand sicherzustellen, wird das Feld **entfernt** und die Steuerung erfolgt rein über €. Ein **unabhängiger** (frei gepflegter) Stunden-Deckel ist damit ausgeschlossen, weil er zwangsläufig mit dem €-Budget divergieren würde.

### 6.3 Anpassungs-Workflows robust machen
- **V5 — Meilenstein-Sync bei Membership-Änderungen.** Nach `POST/PUT/DELETE .../memberships` einen **inkrementellen, nicht-destruktiven Abgleich** der **offenen** Meilensteine anbieten/ausführen:
  - Neuer MA: Budget **mit** korrekter Skalierung/Deckelung einfügen (behebt BUG-4).
  - Geänderte Wochenstunden: Personen-Budget in offenen Monaten neu berechnen, **manuelle Overrides erhalten** (Flag „manuell angepasst" je Budget, damit force=false diese respektiert). Behebt BUG-5.
  - Gelöschter MA: zugehörige Budgets in offenen Monaten entfernen und Milestone-Summe neu bilden (behebt BUG-7).
  - Empfehlung: als expliziten Endpoint `POST .../milestones/resync` (nicht-destruktiv) neben dem bestehenden `force=true` (destruktiv). UI zeigt Badge „Meilensteine veraltet", wenn Memberships jünger als letzte (Re-)Initialisierung sind.
- **V6 — Validierung bei manueller Anpassung (entschieden, s. §8.2).** `update_person_budget` prüft:
  - `>= 0` (vorhanden),
  - Warnung/Hinweis bei `> avail` bzw. `> Wochenstunden-Äquivalent` (B2),
  - Bei drohender Überschreitung des Projekt-€-Budgets über alle Monate (B1, gesperrte Monate abgezogen): **kein hartes 422, sondern bestätigungspflichtige Warnung** (analog zum Monatsabschluss-Warndialog). Erst nach expliziter Bestätigung wird gespeichert. Behebt BUG-6.

### 6.4 Echtes „Auto-rebalance" auf das Budget hin (B1-Ziel) + Empfehlungen (B4)
- **V7 — Zielorientiertes Rebalancing.** `suggest_rebalancing` neu definieren als: „Verteile das **Restbudget** (Gesamt − abgerechnet/gesperrt − bereits gebucht) so über die **offenen** Meilensteine und Personen, dass es **maximal ausgereizt**, aber **nie überschritten** wird und **keine** Person über `avail`/Wochenstunden kommt." Drift (bereits gebucht) muss einfließen (behebt BUG-9, BUG-10).
- **V8 — Auslastungs-Empfehlungen (projektübergreifend, B4).** Grundlage ist die **freie allgemeine Kapazität** einer Person: `frei = default_weekly_hours − Σ weekly_capacity_hours (alle Projekte, überlappender Zeitraum)`. Ist `frei > 0` **und** bleibt im aktuellen Projekt noch €-Budget übrig, gib den **Hinweis** aus: „MA X hat noch `frei` h/Woche ungenutzte allgemeine Kapazität — die Projekt-Wochenstunden in diesem Projekt könnten um bis zu `min(frei, budgetgedeckte h)` erhöht werden." Der Vorschlag zielt also auf die **Anhebung von `ProjectMembership.weekly_capacity_hours`**, nicht auf eine Umverteilung innerhalb bestehender Meilenstein-Stunden. Rein informativ, keine automatische Änderung.
  - **Wiederverwendung:** Dies ist die exakte Umkehrung der bereits vorhandenen Überbuchungs-Prüfung `_membership_overbooking_warnings` (`backend/app/routers/projects.py`), die `Σ weekly_capacity_hours` gegen `default_weekly_hours` prüft. Die Empfehlungslogik sollte dieselbe Kapazitätsbasis nutzen (Konsistenz), nur mit umgekehrter Schwelle (`< 100 %` statt `> 100 %`).
- **V9 — Frontend.** „Rebalanciert"-Spalte in die Meilenstein-Tabelle integrieren (Differenz zu „Aktuell"), Empfehlungen als dezente Hinweiszeile/Badge. Konsolidierung mit dem separaten Rebalancing-Tab prüfen.

### 6.5 Datenintegrität & Invarianten
- **V10 — Baseline-Definition festschreiben.** `MilestonePersonBudget.initial_hours` ist die **pro Budgetzeile einmalig** bei deren Anlage gesetzte Baseline und wird danach nie mehr verändert (auch nicht bei Resync/Rebalancing). `Milestone.initial_hours` wird als **denormalisierter Cache** definiert und bei **jedem** Hinzufügen/Entfernen einer Budgetzeile auf `Σ MilestonePersonBudget.initial_hours` nachgeführt. Damit gilt durchgehend `Milestone.initial_hours == Σ budget.initial_hours` **und** `Milestone.current_hours == Σ budget.current_hours`. Drift = `Gebucht − Baseline` ist damit eindeutig. Behebt die im Ist inkonsistente Drift-Basis.
- **V11 — Referenzielle Aktionen.** MA-Löschung, Projekt-Datumsänderung und Membership-Datumsänderung brauchen definierte Auswirkungen: gesperrte Monate immer schützen; Monate außerhalb der neuen Projektlaufzeit → offene löschen, gesperrte behalten + Warnung; Budgetzeilen außerhalb des neuen Membership-Zeitraums entfernen.
- **V12 — Feiertags-Robustheit.** Feiertags-Abruf-Fehler nicht still auf „0 Feiertage" fallen lassen: Fallback-Cache nutzen **und** im `MilestonePersonDetailOut` ein Flag `holidays_estimated` mitliefern, damit das UI kennzeichnen kann, dass ohne Feiertagsdaten gerechnet wurde.

### 6.6 Verteilungsalgorithmus (verbindlich)

Ersetzt die fehlerhafte Monats-Skalierung im €-Pfad von `initialize_milestones`. Gilt für Initialisierung, Resync und zielorientiertes Rebalancing (eine gemeinsame Funktion, z. B. `allocate_budget(project_id, session)`).

**Eingaben**
- Offene Monate `M` (gesperrte sind fix und ausgenommen).
- Je Person `p` und Monat `m ∈ M`: `avail[p,m]` (netto, §2.1) und Stundensatz `rate[p]` (`billing_rate_per_hour` der Membership).
- Restbudget `R = total_budget_euros − Σ(abgerechnete Beträge gesperrter Monate)`.

**Berechnung**
1. Maximalkosten bei voller Kapazität: `Cmax = Σ_{p,m∈M} avail[p,m] × rate[p]`.
2. **Globaler Skalierungsfaktor** `s = min(1, R / Cmax)` (bei `Cmax = 0` → `s = 0`).
3. Planstunden je Person/Monat: `plan_hours[p,m] = avail[p,m] × s`.
4. Ergebniskosten `= s × Cmax ≤ R` → **Budget wird nie überschritten**, Kapazität nie überschritten (`s ≤ 1`).

**Priorisierung (optional, projektspezifisch — B6)**

Ist für die MA eine Prioritätenreihenfolge gesetzt, ersetzt eine **tier-weise Auffüllung** den globalen Faktor. `priority` je Membership (kleinerer Wert = höhere Priorität; gleicher Wert = gleiche Stufe):
1. Bilde Prioritätsstufen `T1 > T2 > …` (aufsteigend nach `priority`). Setze `R_rest = R`.
2. Für jede Stufe `Tk` (von hoch nach niedrig): `tier_cost = Σ_{p∈Tk, m∈M} avail[p,m] × rate[p]`.
   - Deckt `R_rest ≥ tier_cost`: alle MA der Stufe voll (`s_k = 1`), `R_rest −= tier_cost`.
   - Sonst: `s_k = R_rest / tier_cost` (proportional **innerhalb** der Stufe), `R_rest = 0`; alle folgenden Stufen erhalten 0.
3. `plan_hours[p,m] = avail[p,m] × s_k` (mit `k` = Stufe von `p`).

**Spezialfall = heutiges Verhalten:** Alle MA gleichrangig → eine einzige Stufe → `s_1 = min(1, R/Cmax)` — identisch zur Basisformel oben. Die Priorisierung ist damit eine echte Verallgemeinerung ohne Regression.

**Konsequenzen der Formel (bewusst so gewählt)**
- **`s < 1` (Budget bindet, keine/gleiche Prio):** Alle Personen werden **proportional** gekürzt. Der kapazitäts-proportionale Mix bleibt erhalten (§8.3). Es werden **nicht** automatisch günstige MA bevorzugt (§9.1). Eine gewünschte Bevorzugung wird **ausschließlich** über die Priorität (B6) gesteuert, nicht über den Stundensatz.
- **`s = 1` (Kapazität bindet):** Budget wird bewusst unterschritten (B1 erlaubt das). Die Differenz `R − Cmax` ist das „Auslastungs-Headroom" und triggert die B4-Empfehlungen (§6.4/V8).
- **Invarianten bleiben:** In jeder Stufe gilt `s_k ≤ 1` (Kapazität nie überschritten) und `Σ Kosten ≤ R` (Budget nie überschritten).
- **Keine Rundung in Berechnungen (§9.4, verbindlich):** Stunden werden **in voller Präzision** gehalten, damit sich das €-Budget **cent-genau** über Stunden × Stundensatz abbilden lässt. Mit `s = R / Cmax` treffen die Ergebniskosten `R` exakt (bis auf unvermeidbare Fließkomma-Epsilons). **Gerundet wird ausschließlich in der Anzeige** (Frontend/Reports), nie im gespeicherten Wert oder in Folgeberechnungen. Property-Test: `Σ Kosten ≤ R` (harte Invariante; kein bewusster Rundungspuffer, nur FP-Epsilon).

Diese eine Formel ersetzt sowohl die Kalender-Arbeitstag-Verteilung (BUG-3) als auch die Monats-Skalierung (BUG-1) und berücksichtigt gesperrte Monate über `R` (BUG-2).

### 6.7 Datenmodell- & Migrationsänderungen (Alembic)

| Änderung | Tabelle/Feld | Zweck | V-Bezug |
|---|---|---|---|
| Neu | `MilestonePersonBudget.is_manual_override: bool = False` | Manuelle Anpassung markieren, damit Resync sie erhält | V5, §8.4 |
| Neu | `ProjectMembership.priority: int = 0` | Projektspezifische MA-Priorität für die Budgetverteilung (kleiner = höher, gleicher Wert = gleiche Stufe, 0 = neutral) | B6, V13 |
| Neu (optional) | `Project.last_milestone_init_at: datetime \| None` | „Meilensteine veraltet"-Badge (Memberships jünger als Init) | V5 |
| Klarstellung | `Milestone.initial_hours` als Cache von `Σ budget.initial_hours` | Baseline-Konsistenz (V10) — keine Schemaänderung, aber Pflege-Logik | V10 |
| Prüfen/Entfernen | `Project.total_budget_hours` | Gemäß §8.5 entweder abgeleitet synchron halten oder Feld entfernen (Migration + Frontend-Felder in Settings) | V4 |

Da Rückwärtskompatibilität nicht erforderlich ist (§1), kann das Schema direkt sauber gezogen werden — entweder als neue Alembic-Revision (analog `b7e3d4f5c012_booking_flags.py`) **oder** durch Neuaufsetzen des Initial-Schemas. Kein Migrations-Fallback für Bestandsdaten nötig; `total_budget_hours` kann ersatzlos entfernt werden, falls §8.5 das ergibt.

### 6.8 API-Vertragsänderungen

- **Resync (neu, nicht-destruktiv):** `POST /projects/{id}/milestones/resync`
  - Gleicht **offene** Meilensteine an den aktuellen Membership-Stand an: fehlende Budgets ergänzen (mit korrekter Skalierung nach §6.6), überzählige entfernen, geänderte Kapazitäten neu berechnen — **`is_manual_override=True`-Zeilen bleiben unangetastet**. Gesperrte Monate unberührt.
  - Antwort: Liste der geänderten Meilensteine + Zusammenfassung (hinzugefügt/entfernt/neu berechnet).
  - Abgrenzung: `initialize?force=true` bleibt der destruktive „Alles neu"-Weg (verwirft auch Overrides).
- **Manuelle Anpassung mit Bestätigung (§8.2):** `PUT .../persons/{person_id}` und `.../budgets/{budget_id}` erhalten Query-Param `confirm: bool = false`.
  - Ohne `confirm`: Backend rechnet die Auswirkung und gibt bei drohender **Budgetüberschreitung** **HTTP 409** mit einem `warnings`-Body zurück (kein Speichern). Bei `> avail` nur `warnings` im Body, aber Speichern erlaubt (Kapazität ist weich für manuelle Overrides — Leitung darf bewusst überbuchen und trägt Verantwortung; B2 bleibt für die *automatische* Verteilung hart).
  - Mit `confirm=true`: speichert trotz Budgetwarnung; setzt `is_manual_override=True`.
- **Empfehlungen (neu, B4):** `GET /projects/{id}/milestones/recommendations`
  - Liefert je Person: `frei_h_pro_woche`, `budget_headroom_eur`, `empfohlene_zusatz_h` = `min(frei, budgetgedeckte h)`. Reine Lese-Operation, keine Mutation.
- **Rebalancing-Semantik (V7):** `GET .../rebalancing/suggestions` und `POST .../rebalancing/apply` nutzen künftig `allocate_budget` (§6.6) statt der reinen Umverteilung; `current_hours`-Summe je Meilenstein darf sich ändern (Budget-Ausschöpfung), bleibt aber `≤ R`.
- **MA-Priorität (B6):** `POST/PUT .../memberships` akzeptieren optional `priority: int` (Default 0). `GET .../memberships` liefert das Feld mit. Das Frontend erlaubt das Setzen einer Reihenfolge (inkl. Gleichstufen) im Mitglieder-Tab; `allocate_budget` liest es projektspezifisch ein.

### 6.9 Anwenderdokumentation & Nachvollziehbarkeit (mehrstufig)

Die Meilenstein-Logik ist erklärungsbedürftig (Verfügbarkeit, Skalierung, Priorität, Budgetdeckel). Dokumentation muss **nah an der Funktion** und **mehrstufig** sein — passend zum jeweiligen Design (nicht alles als Pop-up, nicht alles als separate Seite). Dies greift zugleich den allgemeinen Review-Punkt auf („Kurzbeschreibung unter dem Titel + ausführliche, per Klick erreichbare Doku-Seite").

- **V14 — Dreistufiges Hilfe-Konzept (wiederverwendbar, app-weit):**
  1. **Stufe 1 — Kurzbeschreibung.** Ein-/Zweizeiler direkt unter dem Seiten-/Tab-Titel (z. B. „Meilensteine: monatliche Planung der Stunden je Person aus Budget und Verfügbarkeit").
  2. **Stufe 2 — Inline-Hilfe.** Tooltips/Info-Icons an Spaltenköpfen und Kennzahlen (viele existieren bereits via `title`); ergänzt um „?"-Popover mit Kurzformel für die abgeleiteten Werte (Verfügbar, Plan, Aktuell, Eff. PWS, Rebalanciert, Empfehlung). Rechenweg **transparent** machen (B1/B2/B6, §6.6).
  3. **Stufe 3 — Ausführliche Doku.** Pro Bereich eine per Klick erreichbare Hilfeseite/-Tab (nicht auf der Hauptseite), die Spaltenbedeutungen, Interaktionen und **Beispiele** erklärt — insbesondere ein durchgerechnetes Meilenstein-Beispiel (Budget → Verfügbarkeit → Skalierung → Priorität).
- **Umsetzung:** Wiederverwendbare Komponenten `PageIntro` (Stufe 1) und `HelpPopover`/`HelpDrawer` (Stufe 2/3); Doku-Inhalte als Markdown-Bausteine, damit fachlich pflegbar. Zunächst für die Meilenstein-/Projektansicht, Muster app-weit ausrollbar.

---

## 7. Arbeitspakete (Implementierungsplan)

Reihenfolge = Abhängigkeitsreihenfolge. Jedes Paket ist eigenständig testbar und mergebar.

> **Umsetzungsstand (02.07.2026):** WP1 (milestones-Teil), WP2 und **WP3** sind implementiert; die volle pytest-Suite läuft im Dev-Env grün (415 Tests, Coverage 90.96 %, `--cov-fail-under=90`). Die reine Verteilungslogik `distribute_budget` wurde gegen die harten Invarianten (Budget/Kapazität) und das Prioritätsverhalten verifiziert (inkl. Fuzz). WP3 ergänzt: Nullmeilenstein-Guard `NoActiveMembership` in `initialize_milestones` (§8.1, Router → HTTP 422); referenzielle Aktionen (V11) `remove_member_budgets`/`prune_member_budgets_to_range`/`apply_project_range_change` (in `delete_membership`/`update_membership`/`update_project` verdrahtet, gesperrte Monate geschützt, V10-Cache via `_resync_milestone_totals`); 0-h-/„außerhalb-Projektzeitraum"-Warnungen im `MilestoneDetailOut.warnings`. Tests: `test_services_milestones_referential.py`, ergänzte Router-Tests. **Offen:** WP4–WP8. Der Rebalancing-Teil von WP1 (gemeinsame Netto-Kapazität) wird mit WP6 umgesetzt.

### WP0 — Testgerüst & Invarianten-Harness
- **Ziel:** Property-Tests als Sicherheitsnetz *vor* den Änderungen etablieren.
- **Dateien:** `backend/tests/unit/test_services_milestones.py`, `test_services_rebalancing.py`.
- **Akzeptanz:** Hypothesis-Tests für „`Σ(current×rate) ≤ R`" und „`current[p,m] ≤ avail[p,m]`" existieren und laufen (dürfen anfangs bekannte Ist-Bugs rot zeigen → dienen als Fortschrittsmaß).
- **Abhängt von:** —

### WP1 — Einheitliche Kapazitäts- & Urlaubslogik (V1, V2)
- **Ziel:** Eine einzige Netto-Kapazitätsfunktion; Urlaub = Restkontingent.
- **Dateien:** `milestones.py`, `rebalancing.py`, `planning.py`.
- **Änderungen:** Rebalancing auf `_person_available_hours` umstellen; `_vacation_estimate_for_month` durch konsolidierte Logik aus `planning.py::estimated_vacation_days` ersetzen (Rest = `total_days − genommen`, Deckel `min(estimate, Resttage)`).
- **Akzeptanz:** Init- und Rebalancing-Kapazität identisch für gleiche Eingaben; Person mit voll verbrauchtem Urlaub bekommt keinen Urlaubsabzug mehr (neuer Test). Behebt BUG-8, BUG-11.
- **Abhängt von:** WP0.

### WP2 — Verteilungsalgorithmus, Budgetdeckel & MA-Priorität (V3, V13, §6.6, V10, B6)
- **Ziel:** `allocate_budget` mit globalem `s = min(1, R/Cmax)` **und** tier-weiser Priorisierung; Baseline-Cache-Pflege.
- **Dateien:** `models/membership.py` (+`priority`), Alembic-Revision, `milestones.py` (neue Funktion + `initialize_milestones` nutzt sie).
- **Akzeptanz:** WP0-Invarianten grün; gesperrte Monate reduzieren `R`; Monate ohne Kapazität verlieren kein Budget; kein `scale > 1` mehr; **Prioritätstest**: höhere Stufe wird zuerst voll versorgt, Gleichstufe proportional, ohne Prio = proportional (identisch zu Basisformel). Behebt BUG-1/2/3.
- **Abhängt von:** WP1.

### WP3 — Nullmeilenstein-Guard & referenzielle Aktionen (§8.1, V11)
- **Ziel:** Backend blockt Init ohne Membership; 0-h-Monate mit Warnung; Datumsänderungen definiert.
- **Dateien:** `milestones.py`, `routers/milestones.py`, `routers/projects.py`.
- **Akzeptanz:** Init ohne Membership → 4xx mit klarer Meldung; Tests für Projekt-/Membership-Datumsänderung (gesperrte Monate geschützt).
- **Abhängt von:** WP2.

### WP4 — Membership-Sync & Override-Flag (V5, BUG-4/5/7, Migration)
- **Ziel:** `is_manual_override`-Feld + `POST .../milestones/resync`; MA-Add/Update/Delete konsistent.
- **Dateien:** Alembic-Revision, `models/milestone.py`, `milestones.py`, `routers/milestones.py`, `routers/projects.py`.
- **Akzeptanz:** Neuer MA korrekt skaliert eingefügt; geänderte Wochenstunden übernommen ohne Overrides zu verlieren; gelöschter MA → keine verwaisten Budgets. Behebt BUG-4/5/7.
- **Abhängt von:** WP2.

### WP5 — Manuelle Anpassung mit Bestätigung (V6, §8.2)
- **Ziel:** `confirm`-Param + Warnungs-/409-Flow; setzt Override-Flag.
- **Dateien:** `milestones.py`, `routers/milestones.py`.
- **Akzeptanz:** Budgetüberschreitung ohne `confirm` → 409 + Warnungen; mit `confirm` → gespeichert, `is_manual_override=True`. Behebt BUG-6.
- **Abhängt von:** WP2, WP4.

### WP6 — Zielorientiertes Rebalancing + Empfehlungen (V7, V8, BUG-9/10)
- **Ziel:** Rebalancing nutzt `allocate_budget` (Drift-bewusst); Empfehlungs-Endpoint.
- **Dateien:** `rebalancing.py`, `routers/rebalancing.py`, `routers/milestones.py` (recommendations).
- **Akzeptanz:** Vorschlag reizt `R` maximal aus ohne Überschreitung; Drift fließt ein; Empfehlung = Umkehrung von `_membership_overbooking_warnings`. Behebt BUG-9/10.
- **Abhängt von:** WP2, WP1.

### WP7 — Frontend (V9, V12-Flag, MA-Priorität, Warn-/Bestätigungsdialoge)
- **Ziel:** „Rebalanciert"-Spalte in Meilenstein-Tabelle, „veraltet"-Badge, Empfehlungs-Hinweise, 0-h- & Feiertags-Kennzeichnung, Bestätigungsdialog für Budget-Overrides, **Prioritäten-Setzung im Mitglieder-Tab** (Reihenfolge inkl. Gleichstufen).
- **Dateien:** `frontend/src/pages/ProjectDetailPage.tsx`, `frontend/src/api.ts`.
- **Akzeptanz:** Alle neuen Backend-Felder/Endpoints sind im UI sichtbar; Override-Bestätigung funktioniert; Priorität setz- und speicherbar.
- **Abhängt von:** WP4, WP5, WP6.

### WP8 — Anwenderdokumentation & Hilfe (V14, §6.9)
- **Ziel:** Dreistufiges Hilfe-Konzept (Kurzbeschreibung, Inline-Tooltips/Popover, ausführliche Doku-Seite) mit wiederverwendbaren Komponenten.
- **Dateien:** neue `frontend/src/components/PageIntro.tsx`, `HelpPopover.tsx`/`HelpDrawer.tsx`; Doku-Markdown-Bausteine; Einbindung in Meilenstein-/Projektansicht.
- **Akzeptanz:** Jede relevante Kennzahl hat eine erklärende Inline-Hilfe mit Rechenweg; ein durchgerechnetes Meilenstein-Beispiel ist per Klick erreichbar; Muster ist app-weit wiederverwendbar.
- **Abhängt von:** WP7 (nutzt die finalen UI-Werte/Begriffe).

**Querschnittlich:** Jeder WP schließt mit Unit-/Property-Tests ab; die harten Invarianten aus WP0 dürfen nie brechen.

---

## 8. Getroffene fachliche Entscheidungen

Die folgenden Punkte sind geklärt und für die Umsetzung verbindlich:

1. **Nullmeilensteine — entschieden:** Meilensteine **ohne Personal sind nicht möglich**. Die Initialisierung setzt mindestens eine aktive `ProjectMembership` voraus (Backend blockt, nicht nur das UI). Mit Personal ist die Anlage erlaubt; ergibt ein Monat trotz vorhandenem Personal **0 Stunden** (z. B. volle Abwesenheit/keine Kapazität), wird der Meilenstein angelegt, aber mit einer **Warnung** gekennzeichnet. → betrifft US-A/US-B, Backend-Guard in `initialize_milestones` + Router.
2. **Budget-Überschreitung bei manueller Anpassung — entschieden:** **Nur mit Bestätigung.** Kein hartes 422. Bei drohender Überschreitung des €-Budgets (über alle Monate, unter Berücksichtigung gesperrter Monate) wird eine **bestätigungspflichtige Warnung** angezeigt (analog zum Monatsabschluss-Warndialog); erst nach Bestätigung wird gespeichert. → präzisiert **V6**.
3. **Restbudget-Verteilung — entschieden:** Nach **verbleibender verfügbarer Kapazität** (netto), gedeckelt durch die Projekt-Wochenstunden (B2). → bestätigt **V3/V7**.
4. **Manuelle Overrides bei Resync — entschieden:** **Immer erhalten** (Flag „manuell angepasst" je Budget); nur ein explizites „Neu berechnen/force" durch den Nutzer verwirft sie. → bestätigt **V5**.
5. **`total_budget_hours` — entschieden:** Nur beibehalten, wenn es **jederzeit konsistent** mit dem €-Budget und der Stundenverteilung auf die MA gehalten werden kann — d. h. abgeleitet aus den geplanten Stunden **× individuellen Stundensätzen** je Person. Lässt sich diese Synchronität nicht mit vertretbarem Aufwand garantieren, wird `total_budget_hours` **entfernt** und ausschließlich über das €-Budget gesteuert. → ersetzt **V4** (kein unabhängiger „nachrangiger Deckel" mehr, sondern entweder abgeleiteter Sync-Wert oder Wegfall).

---

## 9. Design-Entscheidungen (final, geklärt)

Diese Punkte tauchten bei der Detaillierung des Algorithmus auf und sind nun **entschieden**:

1. **Kürzungsstrategie bei bindendem Budget (`s < 1`) — entschieden: proportional.** Alle Personen werden rate-neutral und mixerhaltend proportional gekürzt (§6.6). Kein „günstige MA zuerst".
2. **`avail` bei manuellen Overrides — entschieden: warnend, nicht hart.** Für die *automatische* Verteilung bleibt `avail` harte Grenze (B2). Bei *manuellen* Overrides wird `> avail` nur gewarnt (Speichern erlaubt), da die Leitung bewusst überbuchen darf und die Verantwortung trägt (§6.8).
3. **Budgetbezug gesperrter Monate — entschieden: Ist-Beträge.** `R` zieht die **abgerechneten** Beträge (Invoice-Summe) gesperrter Monate ab, nicht die geplanten Kosten.
4. **Rundung — entschieden: keine Rundung in Berechnungen.** Das Budget muss **cent-genau** über Stunden abbildbar sein; Stunden bleiben in voller Präzision gespeichert und berechnet. **Rundung nur zur Anzeige** (§6.6). ⚠️ In keiner Persistenz-/Folgeberechnung runden.

## 10. Nicht-Ziele & Risiken

**Nicht-Ziele (bewusst außerhalb dieses Plans):**
- Direkte SAGE-Datenbankanbindung (bleibt Import; separater Roadmap-Punkt).
- Datenhaltung/Datenschutz-Ablage (siehe `19-v08-data-storage.md`).
- Kalender-Chart „Budget/Plan/Aktuell/Prognose" (Review III.7) — nutzt zwar die hier definierten Begriffe, ist aber eigenes Arbeitspaket.

**Risiken:**
- **Floating-Point vs. harte Budgetgrenze:** Da nicht gerundet wird (§9.4), treffen die Kosten `R` exakt bis auf FP-Epsilon. Der Property-Test (WP0) prüft `Σ Kosten ≤ R` mit reinem FP-Epsilon (kein bewusster Puffer). Bei Bedarf konsequent mit `Decimal`/Cent-Arithmetik rechnen.
- **Feiertags-API-Abhängigkeit:** Ausfall verändert `avail` → Fallback-Cache + Kennzeichnung (V12), sonst schwankende Pläne.
- **`total_budget_hours` entfernen:** Betrifft Frontend-Settings — dank fehlender Kompatibilitätspflicht (§1) ohne Datenmigration umsetzbar; nur nach Klärung §8.5.
- **Neue Version statt Migration:** Da Altdaten verworfen werden dürfen (§1), ist das Hauptrisiko organisatorisch (laufende Projekte im PoC neu anlegen), nicht technisch. Gesperrte/abgerechnete Monate nur schützen, falls fachlich noch benötigt.
