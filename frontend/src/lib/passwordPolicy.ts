/** Password policy (doc 25, #53) — frontend mirror of backend/app/auth/password_policy.py.
 *
 * The backend's validate_password is authoritative; these rules drive the live
 * checklist so the user sees requirements while typing. Keep BOTH in sync. */

export const PASSWORD_MIN_LENGTH = 12

export interface PasswordRule {
  /** Short German label shown in the checklist. */
  label: string
  test: (pw: string) => boolean
}

export const PASSWORD_RULES: PasswordRule[] = [
  { label: `Mindestens ${PASSWORD_MIN_LENGTH} Zeichen`, test: (pw) => pw.length >= PASSWORD_MIN_LENGTH },
  { label: 'Groß- und Kleinbuchstaben', test: (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  { label: 'Mindestens eine Ziffer', test: (pw) => /\d/.test(pw) },
  { label: 'Mindestens ein Sonderzeichen', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
]

/** True when the password satisfies every rule. */
export function isPasswordValid(pw: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(pw))
}
