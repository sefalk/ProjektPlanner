/** Centered card shell shared by the login and registration screens (doc 25, WP4). */
import { LayoutDashboard } from 'lucide-react'
import type { ReactNode } from 'react'

export default function AuthLayout({ title, subtitle, children }: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <LayoutDashboard size={22} className="text-blue-600" />
            <h1 className="text-lg font-bold tracking-wide text-slate-900">ProjektPlanner</h1>
          </div>
          <p className="text-xs text-gray-500">Project Planning</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white px-6 py-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <p className="mb-4 mt-0.5 text-xs text-gray-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
