# Import: Projektebene → Posten mappen, Konflikte auflösen, Ist konsistent halten

_Status: 📋 Design & Implementierungsplan_
_Datum: 2026-07-20_
_Betrifft: `services/importer.py`, `routers/imports.py`, `routers/projects.py`, `services/milestones.py`,
`models/timebooking.py`, `frontend/src/pages/ImportPage.tsx`, `ProjectDetailPage.tsx`, `MappingsPage.tsx`_
_Baut auf: [23-posten-multi-assignment.md](23-posten-multi-assignment.md) (WP4)_

---

## 1. Ziel
Jede importierte Buchung trägt den korrekten **Posten**, sobald das Projekt Posten hat. Nicht
eindeutig auflösbare Buchungen werden **beim Import sichtbar und dort auflösbar** (blockierend, mit
Prompt), sind aber auf Wunsch mit **starker Warnung erzwingbar** — dann als **unaufgelöst geflaggt**,
aus den Posten-Berechnungen ausgenommen und in der Meilensteinansicht klar signalisiert. Die
Buchungstabelle zeigt die Zuordnung; Modus-Wechsel und spätere Mapping-Änderungen halten alles
konsistent.

## 2. Grundsatz (bestätigt)
Die Ebene→Posten-Zuordnung ist **projektweit** (eine Projektebene = ein Posten). Sie wird **nicht**
aus dem (evtl. einzigen) Posten *einer* Person abgeleitet — das wäre für andere Bucher derselben
Ebene ggf. falsch. Beobachtete Projektebenen aus Buchungen geben aber Hinweise auf das Projekt und
dienen als **Vorschläge** im Resolver/Editor.

## 3. Auflösungsregel (deterministisch, pro Buchung)
| Projekt-Situation | Ergebnis |
|---|---|
| 0 Posten | `billing_position_id = NULL`, keine Warnung (echter Simple-Fall) |
| Mapping (Projekt, Ebene) vorhanden | → dieser Posten (gewinnt immer, **unabhängig vom Modus**) |
| Kein Mapping, genau 1 Posten | Vorschlag im Resolver → **einmalige Bestätigung** (kein stilles Persistieren, s. §4a) |
| Kein Mapping, ≥ 2 Posten | **ungelöst → Resolver** (Ebene einem Posten zuordnen → erzeugt Mapping) |

Auflösung läuft **immer, wenn das Projekt ≥ 1 Posten hat** (nicht nur im Posten-Modus), damit ein
späteres Aktivieren des Posten-Modus nahtlos ist.

## 4. Import-Ablauf
- **Blockierend + Prompt:** ungelöste `(Projekt, Ebene)` werden — analog zum bestehenden Projekt-/
  Personen-Resolver — vor dem Import abgefragt. Der Nutzer weist die Ebene einem **vorhandenen**
  Posten zu (oder legt zuvor einen Posten an). Daraus wird ein `SagePositionMapping` abgeleitet.
- **(a) Einmalige Bestätigung auch im 1-Posten-Fall:** Der Resolver schlägt den einzigen Posten vor,
  persistiert das Mapping aber erst nach Bestätigung. Grund: Enthält ein Import nur eine Ebene,
  obwohl später weitere dazukommen, wäre eine stille Auto-Zuweisung ggf. falsch.
- **Erzwingen möglich:** Mit **starker Warnung** kann der Import trotz ungelöster Ebenen erzwungen
  werden — **nur wenn dadurch nichts kaputtgeht**. Die betroffenen Buchungen werden importiert, aber
  **unaufgelöst** (siehe §6).

## 5. Buchungstabelle (Projekt) + Inline-Mapping-Editor
- Neue Spalte **Posten** (aufgelöst) neben `Projektebene`; **unaufgelöste** Buchungen rot markiert.
  Dazu `billing_position_id`/Posten-Label in `BookingOut`/`TimeBookingOut` ergänzen.
- **Inline-Editor**: direkt in den Projekt-Buchungen die Zuordnung *Projektebene → Posten* bearbeiten
  (erzeugt/ändert `SagePositionMapping`), mit Vorschlägen (vorhandene Ebenen via `sageLevels()`,
  vorhandene Posten). Änderung wirkt per Backfill auf bestehende Buchungen der Ebene (§7).

## 6. Unaufgelöste Buchungen (erzwungener Import / Posten-Modus)
- Definition: **Posten-Modus aktiv** (bzw. Projekt hat Posten) **und** `billing_position_id = NULL`.
- Diese Buchungen **gehen nicht in Posten-Berechnungen ein** (kein eindeutiger Posten → keine
  Ist-Zuordnung, keine Abrechnung je Posten).
- Sie erscheinen in den Projekt-Buchungen **geflaggt**.
- **Meilensteinansicht** zeigt eine klare Warnung, dass unaufgelöste Buchungen existieren (mit Anzahl).
- Abgrenzung: Im **Simple-Modus** ist `NULL` normal (kein Posten-Konzept) → dann der Personen-primär-
  Zeile zugeordnet (doc 23 Ist-Fix), **nicht** „unaufgelöst".

## 7. Konsistenz-Hooks (Backfill)
- **Mapping angelegt/geändert** (Resolver, Inline-Editor, MappingsPage): bestehende Buchungen der
  betroffenen Ebene neu auflösen. Nötig, weil Re-Import sie wegen des Dedup-Schlüssels überspringt
  (`billing_position_id` ist nicht Teil des Unique-Keys).
- **Posten-Modus aktivieren**: bestehende NULL-Buchungen aus den vorhandenen Mappings (bzw. dem
  einzigen, bestätigten Posten) nachziehen; verbleibende unaufgelöste melden.
- **Posten gelöscht**: Mappings, die darauf zeigen, würden verwaisen → Löschen blockieren, solange
  ein Mapping/Buchung referenziert (analog zur bestehenden Membership-Prüfung).

## 8. Warnungs-Taxonomie (nach Auflösung, weich)
1. **Person-Mismatch** (WP4, vorhanden): Buchung auf Posten X, MA ist X nicht zugewiesen.
2. **Verifizieren bei Mehrdeutigkeit**: MA nur einem Posten zugewiesen, es gibt aber mehrere → Hinweis
   „gebucht auf X — bitte prüfen".
- `is_excluded`-Buchungen aus allen Warnungen ausnehmen.

## 9. Zusätzlich betrachtete Fälle (über die ursprüngliche Liste hinaus)
- Modus *aus* + ≥ 2 Posten + kein Mapping → ebenfalls Resolver (nicht nur der 1-Posten-Fall).
- Mapping *später* geändert → Backfill (Re-Import repariert nicht, §7).
- Verwaistes Mapping (Posten gelöscht) → Löschsperre/Warnung.
- Ausgeschlossene Buchungen von Warnungen ausnehmen.

## 10. Arbeitspakete
- **IP1** Backend-Auflösung: `billing_position_id` bei jedem Projekt mit Posten auflösen; Import liefert
  strukturierte „ungelöste Ebenen" + Warnungen (kein stiller Hard-Abort mehr).
- **IP2** Import-Resolver + Erzwingen: Inline-Auflösung ungelöster Ebenen (1-Posten mit Bestätigung;
  Posten anlegen möglich); Force-Import mit starker Warnung → geflaggte unaufgelöste Buchungen.
- **IP3** Buchungstabelle: Posten-Spalte + Unaufgelöst-Flag + Inline-Mapping-Editor mit Vorschlägen.
- **IP4** Backfill-Hooks: Mapping-Anlegen/-Ändern und Posten-Modus-Aktivieren ziehen bestehende
  Buchungen nach; Löschsperre für referenzierte Posten.
- **IP5** Berechnungen + Meilenstein-Warnung: unaufgelöste Buchungen aus Posten-Berechnungen
  ausnehmen; Meilensteinansicht signalisiert deren Existenz.

Reihenfolge: IP1 → IP5 → IP3 → IP2 → IP4 (Fundament + Korrektheits-Schutz zuerst, dann Sichtbarkeit,
dann Import-UX, zuletzt die Konsistenz-Automatik).
