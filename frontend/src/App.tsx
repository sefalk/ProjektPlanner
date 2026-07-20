import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { FolderOpen, Users, Briefcase, Map, LayoutDashboard, CalendarDays, ArrowDownToLine, Settings } from 'lucide-react'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import PersonsPage from './pages/PersonsPage'
import ProgramsPage from './pages/ProgramsPage'
import MappingsPage from './pages/MappingsPage'
import CalendarPage from './pages/CalendarPage'
import ImportPage from './pages/ImportPage'
import PersonDetailPage from './pages/PersonDetailPage'
import SettingsPage from './pages/SettingsPage'

const navItems = [
  { to: '/calendar', label: 'Kalender', icon: CalendarDays },
  { to: '/projects', label: 'Projekte', icon: FolderOpen },
  { to: '/persons', label: 'Personen', icon: Users },
  { to: '/import', label: 'Sage-Import', icon: ArrowDownToLine },
  { to: '/programs', label: 'Hauptprojekte', icon: Briefcase },
  { to: '/mappings', label: 'Sage-Mapping', icon: Map },
]

export default function App() {
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="px-4 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2 mb-0.5">
            <LayoutDashboard size={16} className="text-blue-400" />
            <h1 className="text-sm font-bold text-white tracking-wide">ProjektPlanner</h1>
          </div>
          <p className="text-xs text-slate-400 pl-6">Project Planning</p>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-2 py-2 border-t border-slate-700">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`
            }
          >
            <Settings size={15} />
            Einstellungen
          </NavLink>
          <p className="text-xs text-slate-400 px-3 pt-2">v{__APP_VERSION__}</p>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/calendar" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/persons" element={<PersonsPage />} />
          <Route path="/persons/:id" element={<PersonDetailPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/mappings" element={<MappingsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
