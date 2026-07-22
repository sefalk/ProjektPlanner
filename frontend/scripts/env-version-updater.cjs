// commit-and-tag-version custom updater for backend/.env.example.
// Keeps the documented APP_VERSION example in sync with the release bump.
// Must be .cjs: the frontend package is ESM ("type": "module").

const RE = /^(APP_VERSION=)(.*)$/m

module.exports = {
  readVersion(contents) {
    const m = contents.match(RE)
    return m ? m[2].trim() : undefined
  },
  writeVersion(contents, version) {
    return contents.replace(RE, `$1${version}`)
  },
}
