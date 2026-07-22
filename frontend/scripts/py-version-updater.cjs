// commit-and-tag-version custom updater for backend/app/config.py.
// Keeps the backend `app_version` default in sync with the SemVer bump derived
// from package.json — so the release stays the single source of truth (see
// docs/RELEASING.md) instead of a hand-maintained second copy that drifts.
// Must be .cjs: the frontend package is ESM ("type": "module").

const RE = /(app_version:\s*str\s*=\s*")([^"]+)(")/

module.exports = {
  readVersion(contents) {
    const m = contents.match(RE)
    return m ? m[2] : undefined
  },
  writeVersion(contents, version) {
    return contents.replace(RE, `$1${version}$3`)
  },
}
