import { useState, type ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'
import HelpDrawer from './HelpDrawer'

/**
 * Stufe 1 (V14, §6.9): a short one/two-line description under a section title, with an
 * optional "Hilfe" trigger that opens the detailed HelpDrawer (Stufe 3). Reusable app-wide.
 */
export default function PageIntro({
  text,
  helpTitle,
  helpContent,
}: {
  text: string
  helpTitle?: string
  helpContent?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <p className="text-sm text-gray-500">{text}</p>
      {helpContent && (
        <>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 shrink-0 text-xs text-blue-600 hover:text-blue-800"
            title="Ausführliche Hilfe öffnen"
          >
            <HelpCircle size={14} /> Hilfe
          </button>
          {open && (
            <HelpDrawer title={helpTitle ?? 'Hilfe'} onClose={() => setOpen(false)}>
              {helpContent}
            </HelpDrawer>
          )}
        </>
      )}
    </div>
  )
}
