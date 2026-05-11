import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  actions?: ReactNode
  back?: ReactNode
}

export default function PageHeader({ title, subtitle, actions, back }: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="flex items-center gap-3">
        {back}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 leading-tight">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 ml-4">{actions}</div>}
    </div>
  )
}
