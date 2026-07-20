# Releasing / Versionierung

Die App-Version folgt **SemVer** und lebt in `frontend/package.json` (Single Source of Truth).
Die UI zeigt sie via `__APP_VERSION__` (Vite `define`) an — nie hartkodieren.

## Prozess (Conventional Commits + commit-and-tag-version)

Commits werden im **Conventional-Commits**-Format geschrieben (machen wir bereits):
`feat: …`, `fix: …`, `docs: …`, `refactor: …`, `perf: …`, `chore: …`, `test: …`,
Breaking Change via `feat!: …` oder `BREAKING CHANGE:` im Body.

Der Versionssprung wird daraus **automatisch** abgeleitet:
- `fix` → Patch (0.2.0 → 0.2.1)
- `feat` → Minor (0.2.0 → 0.3.0)
- `feat!` / `BREAKING CHANGE` → Major (0.2.0 → 1.0.0)

### Release durchführen
Vor (oder direkt nach) dem `dev → main`-Merge, im Ordner `frontend/`:

```bash
npm run release:dry   # Vorschau: welcher Bump, welche Changelog-Einträge (ändert nichts)
npm run release       # bumpt package.json, schreibt CHANGELOG.md, committet, setzt Git-Tag vX.Y.Z
git push --follow-tags
```

`commit-and-tag-version` bestimmt den Bump aus den Commits seit dem letzten Tag,
aktualisiert `package.json` + `package-lock.json`, pflegt `frontend/CHANGELOG.md`,
erstellt den Release-Commit (`chore(release): X.Y.Z`) und den Tag `vX.Y.Z`.

Bump bei Bedarf erzwingen: `npm run release -- --release-as minor` (bzw. `patch`/`major`).

### Erste Ausführung (Baseline)
Es existiert noch **kein** Git-Tag. Beim ersten `npm run release` scannt das Tool die
gesamte Historie und schlägt daher einen Versionssprung vor, der die Vergangenheit
mit einschließt (im Dry-Run z. B. `v0.2.1`). Zwei saubere Optionen:
- **Baseline explizit setzen:** `npm run release -- --release-as 0.2.0` erstellt Tag `v0.2.0`
  als Startpunkt; alle folgenden Releases bumpen dann korrekt ab diesem Tag.
- **Oder** den vorgeschlagenen ersten Release einfach übernehmen — ab dann wird pro Tag
  sauber weitergezählt.

Ab dem ersten Tag ist der Prozess vollautomatisch aus den Commits abgeleitet.

## Warum so
- Kein CI nötig (läuft lokal), passt zum Workflow `feature → dev → (PR) → main`.
- Nutzt die bereits gelebten Conventional Commits → keine zusätzliche Disziplin.
- Kein erzwingender commit-msg-Hook (bewusst weggelassen) — die Commit-Konvention bleibt
  Verabredung. Falls später Strenge gewünscht: husky + commitlint als commit-msg-Hook ergänzen.
