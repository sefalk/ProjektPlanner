import { Routes, Route, NavLink } from 'react-router-dom'
import { FolderOpen, Users, Briefcase, Calendar, TrendingUp, FileText, Map } from 'lucide-react'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import PersonsPage from './pages/PersonsPage'
import ProgramsPage from './pages/ProgramsPage'
import MappingsPage from './pages/MappingsPage'

const navItems = [
  { to: '/projects', label: 'Projekte', icon: FolderOpen },
  { to: '/persons', label: 'Personen', icon: Users },
  { to: '/programs', label: 'Programme', icon: Briefcase },
  { to: '/mappings', label: 'Sage-Mapping', icon: Map },
]

export default function App() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-700">
          <h1 className="text-base font-semibold text-white">ProjektPlanner</h1>
          <p className="text-xs text-gray-400 mt-0.5">Project Planning</p>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/persons" element={<PersonsPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/mappings" element={<MappingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
