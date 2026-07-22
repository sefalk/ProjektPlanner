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

**`Setting`:** **pro Owner** (Nutzerentscheidung 2026-07-22) — umgesetzt in **WP3 (Schritt 3b)**: Surrogat-`id`-PK + `owner_id` + `UNIQUE(owner_id, key)` (eine `(owner_id, key)`-Composite-PK scheidet aus, da `owner_id` nullable). Kein globales Startup-Seeding mehr; `db.ensure_owner_settings` seedet die Defaults pro Owner beim ersten Zugriff (owner-gescoped + `before_flush`-Stempel, race-safe). Die Lesepfade (milestones/persons/holiday_region) fallen bei fehlendem Key auf dieselben Defaults zurück, daher Verhalten vor/nach Seeding identisch.

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
| **WP2** ✅ | Auth-Backend: `fastapi-users`, Session-Cookie, Invite-Token-Flow, Admin-Flag | `routers/auth.py`, `main.py` |
| **WP3** ✅ | Zentraler Owner-Filter (`session.info` + `do_orm_execute`), Auto-Set von `owner_id` beim Insert, Auth-Schutz aller CRUD-Router, `Setting` pro Owner; Admin-Bypass | `tenancy.py`, `auth/deps.py`, `routers/*` |
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

### Umsetzungsstand WP2 (auf `dev`)
- **Bibliothek:** `fastapi-users` 15 (pwdlib argon2/bcrypt, pyjwt). Neue Dependency in `pyproject.toml`.
- **Sync-Adapter:** `app/auth/user_db.py` implementiert die `BaseUserDatabase` synchron auf der bestehenden sync-`Session` — vermeidet eine zweite async-Engine (aiosqlite) auf derselben SQLite-Datei (Locking-Risiko). Methoden sind `async def`, führen aber sync-Queries aus (für diese Last unkritisch).
- **Transport/Strategy:** httpOnly-**Session-Cookie** (`projektplannerauth`, secure/samesite konfigurierbar) mit **JWT** (HS256, 12 h, kein Refresh). Logout löscht das Cookie; das kurzlebige JWT läuft dann aus. Bewusst gewählt statt DB-Sessions (keine Extra-Tabelle) und statt Bearer/localStorage (XSS-sicher).
- **Registrierungs-Gate:** `UserManager.create` validiert & verbraucht das Einmal-Invite-Token (`app/auth/manager.py`), erst nach erfolgreicher Erstellung wird es als benutzt markiert. Selbst-Registrierung kann sich **nicht** zum Admin machen (`safe=True`).
- **Admin:** `is_superuser`. Invite-Verwaltung nur für Admins (`POST/GET /auth/invites`). **First-Admin-Bootstrap** (`app/auth/bootstrap.py`): via `ADMIN_EMAIL`/`ADMIN_PASSWORD` bei leerer User-Tabelle beim Start — löst die Henne-Ei-Situation.
- **Routen:** `routers/auth.py` mountet `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET/PATCH /users/me`, `GET/…/users/{id}`, plus `/auth/invites`. Passwort-Reset/Verify-Router bewusst noch weggelassen (Admin-gestützter Reset später).
- **Noch nicht:** Der Owner-Filter greift erst in **WP3** — die CRUD-Endpunkte sind aktuell noch nicht auth-geschützt/gefiltert. Config: `AUTH_SECRET` (in Prod setzen!), Cookie-/Session-Flags, Admin-Bootstrap in `.env.example`.
- **Tests:** `tests/unit/test_auth.py` (Invite-Gate, Login/Session, /users/me, Admin-only Invites, Bootstrap-Idempotenz). Suite: 567 grün, Coverage 91%.

### Umsetzungsstand WP3 (auf `dev`)
- **Bindung an die Session, nicht ContextVar:** Der Owner wird **einmal** an die `Session` gebunden (`session.info["owner"]`, `app/tenancy.py`). Grund: FastAPI fährt sync-Endpunkte und `yield`-Dependencies im Threadpool — ein dort gesetzter `ContextVar` propagiert nicht zuverlässig in den Endpunkt. Die Session ist dagegen exakt das Objekt, auf dem jede Query läuft → leck-sicher by construction.
- **Zwei globale ORM-Event-Listener** (`tenancy.py`):
  - `do_orm_execute` hängt für jede der `OWNABLE_MODELS` ein `with_loader_criteria(owner_id == uid, include_aliases=True)` an **jedes SELECT** (Relationship-/Column-Lazy-Loads ausgenommen). Superuser & unbound-Sessions: kein Filter.
  - `before_flush` erzwingt die Owner-Invariante: neue Zeilen werden gestempelt (Client-gesendetes `owner_id` ignoriert), und bei Updates wird `owner_id` aus der History wiederhergestellt (per CRUD **nicht** änderbar). Fixt u. a. das Blanking durch `model_dump(exclude_unset)` auf `ValidatedSQLModel`.
- **Auth-Schutz:** `owner_context`-Dependency (`app/auth/deps.py`) hängt an allen **acht** CRUD-Routern (`dependencies=[…]`) → 401 ohne Login, Daten pro Owner isoliert. `/auth`, `/users`, `/health` bleiben ungeschützt.
- **App-Level-Duplikatprüfung** in den Update-Handlern (program/project/person/mapping) **vor** die Mutation gezogen: sonst schreibt der von der Prüf-Query ausgelöste Autoflush den Konfliktwert und der per-Owner-UNIQUE kippt (500 statt 409).
- **`Setting` pro Owner (Schritt 3b):** Surrogat-`id`-PK + `owner_id` + `UNIQUE(owner_id, key)`; kein globales Startup-Seeding mehr — `db.ensure_owner_settings` seedet die Defaults pro Owner beim ersten Zugriff (`GET/PUT /settings`, race-safe). Alle `session.get(Setting, key)`-Lesepfade (holiday_region, milestones, persons) auf owner-gescopte Query umgestellt; Fallback-Defaults dort unverändert. Migration `a1b2c3d4e5f6` (Rebuild, reversibel validiert).
- **Tests:** `tests/unit/test_tenancy.py` (Auth-Pflicht, Lese-Isolation, Auto-Stempel, owner_id nicht schmuggel-/änderbar, per-Owner-Eindeutigkeit, Admin-Bypass, Settings pro Owner), `test_db_seeding.py` neu auf per-Owner. `conftest`: `client` (Owner 1), `client_for` (header-getaggte Mehr-Owner-Clients gegen eine DB). Suite: 576 grün, Coverage 91%.
- **Noch offen (WP4+):** Frontend hat noch keinen Login/Guard; `owner_id` bleibt nullable (spätere NOT-NULL-Verschärfung möglich); `AUTH_SECRET` vor Prod setzen.

---

## 8. Offene Punkte für die Umsetzungsphase
- ~~`owner_id` denormalisiert auf Kind-Tabellen vs. Filter über Join.~~ **Entschieden (WP1): denormalisiert** — jede besitzbare Tabelle trägt `owner_id`, damit der zentrale Filter (`with_loader_criteria`) uniform ohne Join greift und keine Route ihn „vergessen" kann. Speicher-Overhead bei dieser App-Größe vernachlässigbar.
- ~~Referenzdaten-Grenze.~~ **Entschieden:** `holiday` bleibt global; `setting` ist ab WP3 pro-Owner (s. §5.1).
- ~~`owner_id` ist in WP1 **nullable**; WP3 setzt es beim Insert automatisch und erzwingt den Filter.~~ **Umgesetzt (WP3):** Auto-Set + zentraler Filter aktiv. `owner_id` bleibt vorerst nullable; eine spätere Migration kann auf NOT NULL verschärfen, sobald jede Zeile nachweislich einen Owner hat.
- Invite-Token: Ablaufzeit, Mehrfach-Kontingent (1 Token = 1 Account) — Default: einmalig, mit Ablauf (WP2).
- Passwort-Policy / Reset-Weg ohne SMTP (Admin-gestützter Reset?) (WP2).
