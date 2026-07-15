import { useState, type ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'

/**
 * Stufe 2 (V14, §6.9): a small "?" trigger next to a column header or metric that reveals
 * a short explanation / formula on click. Keeps the rechenweg transparent inline.
 */
export default function HelpPopover({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="text-gray-400 hover:text-blue-600"
        aria-label={label ?? 'Erklärung anzeigen'}
      >
        <HelpCircle size={12} />
      </button>
      {open && (
        <span className="absolute z-30 left-0 top-5 w-56 p-2 bg-gray-900 text-white text-[11px] leading-snug rounded shadow-lg normal-case font-normal">
          {children}
        </span>
      )}
    </span>
  )
}
