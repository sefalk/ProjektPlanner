import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Stufe 3 (V14, §6.9): a slide-over panel for detailed, per-area help content.
 * Content is passed as React nodes so it stays editable as maintainable "Markdown-like"
 * building blocks (headings, lists, worked examples) without an extra dependency.
 */
export default function HelpDrawer({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} aria-label="Schließen" className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 text-sm text-gray-700 space-y-4">{children}</div>
      </div>
    </div>
  )
}
