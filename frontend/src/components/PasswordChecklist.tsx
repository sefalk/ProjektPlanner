/** Live password-policy checklist (#53). Shows each rule with a check/circle as
 *  the user types. Purely visual — the backend enforces the policy authoritatively. */
import { Check, Circle } from 'lucide-react'
import { PASSWORD_RULES } from '../lib/passwordPolicy'

export default function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mt-1.5 space-y-0.5" aria-label="Passwort-Anforderungen">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password)
        return (
          <li
            key={rule.label}
            className={`flex items-center gap-1.5 text-xs ${ok ? 'text-green-600' : 'text-gray-400'}`}
          >
            {ok ? <Check size={12} /> : <Circle size={12} />}
            {rule.label}
          </li>
        )
      })}
    </ul>
  )
}
