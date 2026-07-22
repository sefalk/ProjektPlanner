# Multi-User: Mandantenfähigkeit + Auth (Optionsevaluation & Design)

_Status: 📋 Design & Optionsevaluation (noch keine Umsetzung)_
_Datum: 2026-07-22_
_Betrifft (voraussichtlich): alle `models/*.py` (owner_id), `db.py` (session/filter), `main.py`, neue `routers/auth.py` + `routers/account.py`, sämtliche CRUD-Router, `docker-compose.server.yml`, Alembic, `frontend/` (Login/Registrierung/Export)_
_Baut auf: Server-Deployment Login/HTTPS (#45)_

---

## 1. Ziel & Anforderungen

Die App läuft heute als **ein geteilter Arbeitsbereich ohne Nutzerkonzept**: eine SQLite-DB, ein globaler htpasswd-Login im nginx-Proxy (`docker-compose.server.yml`), alle Daten sind für jeden sichtbar. Ziel ist eine **gehostete Multi-User-App**, in der zunächst gilt:

1. **Isolation:** Jeder User sieht/bearbeitet **nur die von ihm erstellten Daten**. Sensible Daten werden nur Zugangsberechtigten gezeigt („minimal security").
2. **Selbstbedienung ohne IT:** Accounts legen User selbst an; **keine** Lösung, die die interne IT voraussetzt (LDAP/Entra scheidet vorerst aus).
3. **Registrierungs-Gate:** Nicht jeder Beliebige darf rein.
4. **Datenschutz:** verschlüsselte Backups/Volumen; **kein** E2EE (siehe §6).
5. **Nachhaltigkeit:** Ein **späterer Übergang zu einem geteilten Arbeitsbereich mit Governance** („wer darf was sehen") muss ohne Datenumbau möglich sein. Diese detaillierte Governance ist **jetzt ausdrücklich out of scope**.

### Getroffene Entscheidungen (Nutzer, 2026-07-22)
- **Bestandsdaten:** Die gehostete Instanz **startet frisch/leer**. Keine Migration vorhandener Zeilen auf Owner nötig.
- **Admin-Sicht:** Es gibt einen **Betreiber-/Admin-Account, der alle Daten sehen darf** (Support/Migration/Notfall). Im Threat-Model ehrlich benannt (§6).
- **Registrierung:** **Einmal-Invite-Token** (kein SMTP, volle Kontrolle).

---

## 2. Die entscheidende Weichenstellung: „Isolation" ≠ „getrennte Datenbanken"

Zwei **unabhängige** Achsen, die anfangs vermischt wurden:

- **Achse 1 – Isolation:** Sieht ein User nur seine Daten? → **ja** (Anforderung).
- **Achse 2 – Umsetzung:** *Wie* wird isoliert?
  - **physisch** — eine DB pro User,
  - **logisch** — eine DB + `owner_id`-Spalte + Zeilenfilter.

Beide erfüllen „jeder sieht nur seine Daten". Der Unterschied liegt in Betrieb und **Zukunftsfähigkeit**.

---

## 3. Optionen (mit Bewertung)

### Option A — Eine DB, `owner_id`-Spalte, zentraler Zeilenfilter  ✅ GEWÄHLT
Jede besitzbare Tabelle bekommt `owner_id` (FK → `user`). Ein **zentraler Filter** hängt an jede Query `WHERE owner_id = current_user` an; Schreibvorgänge setzen `owner_id` automatisch.
- **Pro:** Isolation *jetzt*; Übergang zu „geteilt + Governance" *später* = Filter aufweichen (`owner_id = ich` → `ich habe Zugriff`) + ACL/Team-Schicht **obendrauf**, **kein Datenumbau**. Eine Schema-Migration, ein Backup-Volume, Referenzdaten (Feiertage) nur einmal.
- **Contra:** Der Filter muss **wirklich zentral** sitzen (sonst „vergisst" eine Route ihn → Daten-Leak). Globale Unique-Constraints müssen pro Owner werden (§5).
- **Risiko:** mittel. **Komplexität:** mittel.

### Option B — Eine DB pro User (physische Trennung, ursprünglich „Modell B")  ❌ verworfen
- **Pro:** Isolation ist trivial garantiert; User-Download = „sein File".
- **Contra:** **Sackgasse für Anforderung 5.** Der Übergang zu „geteilt" wäre ein **Merge von N Datenbanken** (ID-Kollisionen, Dubletten, Referenz-Chaos). Schema-Migrationen N-fach, Referenzdaten (Feiertags-Cache) N-fach dupliziert. Der einzige echte Vorteil (Download) ist mit einem gefilterten Export (§5) auch in Option A lösbar.
- **Verworfen:** widerspricht dem erklärten Nachhaltigkeitsziel direkt.

### Option C — Geteilter Arbeitsbereich mit Feingranular-Governance sofort  ❌ (out of scope)
Vollständige „wer darf welches Detail sehen"-Rechteverwaltung von Anfang an.
- **Contra:** hoher Aufwand, jetzt nicht gefordert. Option A ist die **saubere Vorstufe** dorthin.

**Entscheidung: Option A.** Logische Trennung ist die einzige Option, die Isolation *jetzt* und den gewünschten Übergang *später* ohne Datenumbau erfüllt.

---

## 4. Auth-Schicht (ohne IT)

Weil die App zur Filterung **wissen muss, welcher User** eingeloggt ist, braucht sie in *jedem* Fall eine **app-seitige Identität** (`user`-Tabelle). Ein reiner Proxy-Auth-Weg (Authelia/Authentik) spart diese Tabelle **nicht** (owner_id ist ein FK darauf) und ist nicht self-service-freundlich.

**Gewählter Weg — In-App-Auth:**
- **Bibliothek:** [`fastapi-users`](https://fastapi-users.github.io/) (Registrierung, Passwort-Hashing argon2/bcrypt, Login, Reset) — etabliert, kein Rad-Neuerfinden.
- **Transport:** **Session-Cookie** (httpOnly, secure, SameSite). Für eine Single-Origin-SPA hinter dem eigenen Proxy einfacher und sicherer als JWT (kein Refresh-/Logout-Ballast). JWT wäre für ein stateless Multi-Service-API sinnvoll — hier nicht.
- **Registrierungs-Gate:** **Einmal-Invite-Token.** Admin erzeugt Token (Tabelle `invite_token`: `token`, `created_by`, `used_by`, `used_at`, `expires_at`); Registrierung nur mit gültigem, unbenutztem Token; beim Anlegen wird es verbraucht.
- **SSO später:** Wenn IT verfügbar wird, kann der Login-Teil gegen Entra ID / self-hosted Authelia/Authentik getauscht werden — **`owner_id`-Modell bleibt unverändert**. Als Notiz vermerkt, nicht Teil dieses Pakets.

---

## 5. Betroffene bestehende Logik (grounded)

### 5.1 Globale Unique-Constraints → pro Owner
Diese Constraints sind heute **global** und würden Isolation brechen (User2 könnte keine Projektnummer anlegen, die User1 hat — und das würde deren Existenz verraten):

| Feld | Fundstelle | neu |
|---|---|---|
| `Person.sage_employee_name` | `models/person.py:19` `unique=True` | `(owner_id, sage_employee_name)` |
| `Program.program_number` | `models/program.py:12` `unique=True` | `(owner_id, program_number)` |
| `Project.project_number` | `models/project.py:17` `unique=True` | `(owner_id, project_number)` |
| `SageProjectMapping.sage_project_name` | `models/timebooking.py:37` `unique=True` | `(owner_id, sage_project_name)` |

**Bleibt global** (Referenzdatum, kein Nutzerbesitz): `Holiday` `(holiday_date, country, state)` (`models/holiday.py:20`).

**`Setting`:** Zielbild ist **pro Owner** (Nutzerentscheidung 2026-07-22). In **WP1 bleibt `setting` global**, weil „Defaults pro Account seeden" einen User-Kontext braucht, den es erst mit Auth (WP2) gibt — und das idempotente Seeding (#42) an `session.get(Setting, key)` hängt. Die Umstellung `Setting`-PK → `(owner_id, key)` + per-Account-Seeding erfolgt in **WP3** zusammen mit dem Auto-Set/Filter.

Transitiv besessene Constraints (`membership`, `milestone`, `timebooking` — auf `project_id`/`person_id` gekeyt) sind bereits über ihren Eltern-Owner geschützt und brauchen i. d. R. **keinen** eigenen `owner_id`, solange der Filter über den Join greift. Ob `owner_id` dennoch denormalisiert wird (einfacherer Filter, mehr Speicher), ist eine WP1-Abwägung.

### 5.2 Zentraler Filter statt Route-für-Route
`get_session` (`db.py:63`) und `SessionDep` (z. B. `routers/imports.py:32`) liefern heute eine **ungefilterte** Session. Empfohlenes Muster: eine **request-scoped `current_user_id`** (ContextVar), gesetzt aus der Session-Auth, plus SQLAlchemy-Event `do_orm_execute` mit `with_loader_criteria(Base, lambda cls: cls.owner_id == current_user, include_aliases=True)`. So gilt der Filter **automatisch** für alle Queries — Admin-Flag hebt ihn auf. Vorteil: keine Route kann ihn „vergessen". Alternative (mehr Handarbeit, mehr Risiko): expliziter Filter in jeder Query.

### 5.3 Datenexport / -löschung (DSGVO, Anforderung aus Teil 1)
- **User-Export (Portabilität):** gefilterter, logischer Export — alle Zeilen `WHERE owner_id = ich` über alle Tabellen als JSON (oder pro-User-SQLite-Dump). **Nicht** das rohe DB-File (enthielte fremde Daten).
- **Restore:** Wiedereinspielen unter eigener Ownership.
- **Löschung:** Kaskade über `owner_id`.
- Getrennt davon: **DSGVO pro `Person`** (die *geplanten* Mitarbeiter sind die eigentlichen Datensubjekte) — eigenes kleines Feature, unabhängig von Multi-User.

### 5.4 Nicht betroffen (Stabilitätsanker)
- Die **Rechen-Engines** (`planning.py`, `milestones.py`, `rebalancing.py`) arbeiten pro Projekt/Person — sie rechnen weiter auf der (bereits owner-gefilterten) Datenmenge. Keine Logikänderung, nur eine kleinere Eingangsmenge.
- Simple-/Posten-Modus, Abwesenheits-/Feiertagslogik: unverändert.

---

## 6. Sicherheit / Threat-Model (ehrlich)

- **Encryption at Rest:** verschlüsseltes Volume (LUKS) und/oder SQLCipher; **verschlüsselte Backups**. Schützt gegen **gestohlene Platte / verlorenes Backup / Altgeräte** — **nicht** gegen einen laufenden Root (der Server muss zur Laufzeit entschlüsseln → Schlüssel im Prozessspeicher).
- **Kein E2EE:** „auch Root/Admin kann nichts lesen" ist mit einem **rechnenden** Server-Backend nicht erreichbar (E2EE würde Verteil-Engine, Aggregation, Sage-Matching unmöglich machen). Bewusst verworfen.
- **Admin-Account** kann alle Daten sehen (Entscheidung §1). Das ist ein bewusster Kompromiss für Support/Betrieb und muss den Usern gegenüber transparent sein.
- **Isolation ist „minimal security":** schützt Daten voreinander unter *kooperierenden* Usern + Auth, ersetzt aber keine Feingranular-Governance (die kommt erst mit Modell A / Option C).

---

## 7. Arbeitspakete (Vorschlag, noch nicht terminiert)

| WP | Inhalt | Kern-Artefakte |
|---|---|---|
| **WP1** ✅ | Datenmodell: `user`, `invite_token`; `owner_id` auf besitzbaren Entitäten; Unique-Constraints pro Owner; Referenzdaten-Grenze fixieren; Alembic-Migration (frische DB) | `models/*`, Alembic |
| **WP2** | Auth-Backend: `fastapi-users`, Session-Cookie, Invite-Token-Flow, Admin-Flag | `routers/auth.py`, `main.py` |
| **WP3** | Zentraler Owner-Filter (ContextVar + `do_orm_execute`), Auto-Set von `owner_id` beim Insert; Admin-Bypass | `db.py` |
| **WP4** | Frontend: Login/Registrierung (Invite), Auth-Guard/Redirect, Logout, Account-Menü | `frontend/` |
| **WP5** | Datenexport/-löschung pro User; DSGVO-Export pro `Person` (separat) | `routers/account.py`, `frontend/` |
| **WP6** | Deployment: verschlüsseltes Volume + verschlüsselte Backups; Proxy-Basic-Auth durch App-Login ersetzen | `docker-compose.server.yml`, `deploy/` |
| **später** | Übergang Modell A: Teams/Rollen/Sichtbarkeit als ACL-Schicht über `owner_id` (Filter aufweichen) | — |

### Umsetzungsstand WP1 (auf `dev`)
- **Neue Modelle:** `models/user.py` (`User`, fastapi-users-kompatible Felder, int-PK, `is_superuser` = Admin/Filter-Bypass), `models/invite_token.py` (`InviteToken`).
- **`owner_id`** (nullable FK → `user.id`, indiziert) auf allen 15 besitzbaren Tabellen (Root + Kinder **denormalisiert**, s. §8-Entscheidung). Referenzdaten `holiday` bleibt global; `user`/`invite_token` tragen kein `owner_id`.
- **Composite-Uniques** `(owner_id, feld)` für `program_number`, `project_number`, `sage_employee_name`, `sage_project_name`.
- **App-Level-Duplikatprüfung** in den vier CRUD-Routern (create+update) statt Verlass auf den DB-Constraint — verhält sich in WP1 (owner NULL) korrekt und wird in WP3 automatisch owner-gescoped.
- **Alembic** `e7a1c9d2f3b4` (batch-Mode, Guards, Up-/Downgrade gegen Wegwerf-DB validiert). Prod baut per `alembic upgrade head`, daher vollständige Migration.
- **Tests:** `tests/unit/test_models_owner_tenancy.py` (owner_id-Präsenz, Per-Owner-Eindeutigkeit, Auth-Tabellen). Suite: 554 grün.

---

## 8. Offene Punkte für die Umsetzungsphase
- ~~`owner_id` denormalisiert auf Kind-Tabellen vs. Filter über Join.~~ **Entschieden (WP1): denormalisiert** — jede besitzbare Tabelle trägt `owner_id`, damit der zentrale Filter (`with_loader_criteria`) uniform ohne Join greift und keine Route ihn „vergessen" kann. Speicher-Overhead bei dieser App-Größe vernachlässigbar.
- ~~Referenzdaten-Grenze.~~ **Entschieden:** `holiday` bleibt global; `setting` wird in WP3 pro-Owner (s. §5.1).
- `owner_id` ist in WP1 **nullable**; WP3 setzt es beim Insert automatisch und erzwingt den Filter. Eine spätere Migration kann auf NOT NULL verschärfen, sobald jede Zeile nachweislich einen Owner hat.
- Invite-Token: Ablaufzeit, Mehrfach-Kontingent (1 Token = 1 Account) — Default: einmalig, mit Ablauf (WP2).
- Passwort-Policy / Reset-Weg ohne SMTP (Admin-gestützter Reset?) (WP2).
