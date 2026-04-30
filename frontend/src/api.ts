/** Typed API client for the ProjektPlanner backend. */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Program {
  id: number;
  program_number: string;
  name: string;
  customer: string;
}

export interface Project {
  id: number;
  project_number: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  total_budget_hours: number | null;
  total_budget_euros: number;
  holiday_country: string;
  holiday_state: string;
  status: 'planned' | 'active' | 'completed' | 'archived';
  program_id: number | null;
}

export interface Person {
  id: number;
  name: string;
  sage_employee_name: string;
  default_weekly_hours: number;
  work_week_pattern: string | null;
  default_billing_rate: number | null;
}

export interface PersonWithProjects extends Person {
  project_numbers: string[];
}

export interface ProjectMembership {
  id: number;
  project_id: number;
  person_id: number;
  from_date: string;
  to_date: string;
  weekly_capacity_hours: number;
  billing_rate_per_hour: number;
  warnings?: string[];
}

export interface BillingPosition {
  id: number;
  project_id: number;
  position_number: string;
  description: string;
  budget_euros: number;
}

export interface Milestone {
  id: number;
  project_id: number;
  year: number;
  month: number;
  initial_hours: number;
  current_hours: number;
  status: 'open' | 'closed';
  is_locked: boolean;
}

export interface MilestonePersonBudget {
  id: number;
  milestone_id: number;
  person_id: number;
  initial_hours: number;
  current_hours: number;
}

export interface MilestonePersonDetail {
  person_id: number;
  person_name: string;
  budget_id: number;
  initial_hours: number;
  current_hours: number;
  available_hours: number;
  days_per_week: number;
  work_days: number;
  absence_days: number;
  holiday_days: number;
  billing_rate_per_hour: number;
  booked_hours: number;
}

export interface MilestoneDetail {
  milestone: Milestone;
  persons: MilestonePersonDetail[];
}

export interface PersonDrift {
  person_id: number;
  planned_hours: number;
  actual_hours: number;
  drift_hours: number;
}

export interface BudgetSuggestion {
  budget_id: number;
  person_id: number;
  current_hours: number;
  suggested_hours: number;
}

export interface MilestoneSuggestion {
  milestone_id: number;
  year: number;
  month: number;
  total_current_hours: number;
  budgets: BudgetSuggestion[];
}

export interface MonthlyInvoice {
  id: number;
  project_id: number;
  billing_position_id: number;
  year: number;
  month: number;
  total_hours: number;
  total_amount_euros: number;
  status: 'planned' | 'invoiced' | 'paid';
  is_locked: boolean;
}

export interface SageProjectMapping {
  id: number;
  sage_project_name: string;
  project_id: number;
}

export interface ImportBatch {
  id: number;
  project_id: number;
  imported_at: string;
  source_filename: string | null;
  last_booking_date: string;
}

export type ExclusionReason = 'duplicate' | 'incorrect' | 'cancelled' | 'test';

export interface TimeBooking {
  id: number;
  booking_date: string;
  person_id: number;
  person_name: string;
  import_batch_id: number;
  sage_project_name: string;
  sage_project_level: string;
  net_hours: number;
  duration_raw: string;
  break_duration: string;
  note: string;
  is_excluded: boolean;
  exclusion_reason: ExclusionReason | null;
  exclusion_note: string | null;
}

// ─── Programs ────────────────────────────────────────────────────────────────

export const programs = {
  list: () => req<Program[]>('GET', '/programs'),
  create: (d: Omit<Program, 'id'>) => req<Program>('POST', '/programs', d),
  get: (id: number) => req<Program>('GET', `/programs/${id}`),
  update: (id: number, d: Omit<Program, 'id'>) => req<Program>('PUT', `/programs/${id}`, d),
  delete: (id: number) => req<void>('DELETE', `/programs/${id}`),
  projects: (id: number) => req<Project[]>('GET', `/programs/${id}/projects`),
};

export interface ProjectStats {
  project_id: number;
  booked_hours: number;
  open_milestones: number;
  overdue_milestones: number;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export const projects = {
  list: () => req<Project[]>('GET', '/projects'),
  stats: () => req<ProjectStats[]>('GET', '/projects/stats'),
  create: (d: Omit<Project, 'id'>) => req<Project>('POST', '/projects', d),
  get: (id: number) => req<Project>('GET', `/projects/${id}`),
  update: (id: number, d: Omit<Project, 'id'>) => req<Project>('PUT', `/projects/${id}`, d),
  delete: (id: number) => req<void>('DELETE', `/projects/${id}`),
  memberships: (id: number) => req<ProjectMembership[]>('GET', `/projects/${id}/memberships`),
  addMembership: (id: number, d: Omit<ProjectMembership, 'id' | 'project_id'>) =>
    req<ProjectMembership>('POST', `/projects/${id}/memberships`, d),
  updateMembership: (projectId: number, membershipId: number, d: Pick<ProjectMembership, 'from_date' | 'to_date' | 'weekly_capacity_hours' | 'billing_rate_per_hour'>) =>
    req<ProjectMembership>('PUT', `/projects/${projectId}/memberships/${membershipId}`, d),
  deleteMembership: (projectId: number, membershipId: number) =>
    req<void>('DELETE', `/projects/${projectId}/memberships/${membershipId}`),
  billingPositions: (id: number) => req<BillingPosition[]>('GET', `/projects/${id}/billing-positions`),
  addBillingPosition: (id: number, d: Omit<BillingPosition, 'id' | 'project_id'>) =>
    req<BillingPosition>('POST', `/projects/${id}/billing-positions`, d),
  deleteBillingPosition: (projectId: number, bpId: number) =>
    req<void>('DELETE', `/projects/${projectId}/billing-positions/${bpId}`),
  milestones: (id: number) => req<Milestone[]>('GET', `/projects/${id}/milestones`),
  milestonesDetail: (id: number) => req<MilestoneDetail[]>('GET', `/projects/${id}/milestones/detail`),
  initMilestones: (id: number, force?: boolean) => req<Milestone[]>('POST', `/projects/${id}/milestones/initialize${force ? '?force=true' : ''}`),
  updatePersonBudget: (projectId: number, milestoneId: number, personId: number, hours: number) =>
    req<MilestonePersonBudget>('PUT', `/projects/${projectId}/milestones/${milestoneId}/persons/${personId}`, { current_hours: hours }),
  drift: (id: number) => req<PersonDrift[]>('GET', `/projects/${id}/rebalancing/drift`),
  suggestions: (id: number) => req<MilestoneSuggestion[]>('GET', `/projects/${id}/rebalancing/suggestions`),
  applyRebalancing: (id: number) => req<unknown[]>('POST', `/projects/${id}/rebalancing/apply`),
  invoices: (id: number) => req<MonthlyInvoice[]>('GET', `/projects/${id}/invoices`),
  closeMonth: (id: number, d: { year: number; month: number; billing_position_id: number }) =>
    req<MonthlyInvoice>('POST', `/projects/${id}/invoices/close`, d),
  bookings: (id: number, filters?: { person_id?: number; year?: number; month?: number; week?: number }) => {
    const p = new URLSearchParams()
    if (filters?.person_id) p.set('person_id', String(filters.person_id))
    if (filters?.year) p.set('year', String(filters.year))
    if (filters?.month) p.set('month', String(filters.month))
    if (filters?.week) p.set('week', String(filters.week))
    const qs = p.toString()
    return req<TimeBooking[]>('GET', `/projects/${id}/bookings${qs ? '?' + qs : ''}`)
  },
};

export interface PersonAbsence {
  id: number;
  person_id: number;
  start_date: string;
  end_date: string | null;
  absence_type: 'vacation' | 'sick' | 'training';
  status: 'planned' | 'confirmed' | 'ongoing';
  note: string;
}

export interface VacationContingent {
  id: number;
  person_id: number;
  year: number;
  total_days: number;
}

// ─── Persons ─────────────────────────────────────────────────────────────────

export interface PersonMembershipDetail {
  id: number;
  project_id: number;
  project_number: string;
  project_name: string;
  from_date: string;
  to_date: string;
  weekly_capacity_hours: number;
  billing_rate_per_hour: number;
}

export const persons = {
  list: () => req<Person[]>('GET', '/persons'),
  withProjects: () => req<PersonWithProjects[]>('GET', '/persons/with-projects'),
  memberships: (id: number) => req<PersonMembershipDetail[]>('GET', `/persons/${id}/memberships`),
  create: (d: Omit<Person, 'id'>) => req<Person>('POST', '/persons', d),
  get: (id: number) => req<Person>('GET', `/persons/${id}`),
  update: (id: number, d: Omit<Person, 'id'>) => req<Person>('PUT', `/persons/${id}`, d),
  delete: (id: number) => req<void>('DELETE', `/persons/${id}`),
  absences: (id: number) => req<PersonAbsence[]>('GET', `/persons/${id}/absences`),
  addAbsence: (id: number, d: Omit<PersonAbsence, 'id' | 'person_id'>) =>
    req<PersonAbsence>('POST', `/persons/${id}/absences`, d),
  updateAbsence: (personId: number, absenceId: number, d: Omit<PersonAbsence, 'id' | 'person_id'>) =>
    req<PersonAbsence>('PUT', `/persons/${personId}/absences/${absenceId}`, d),
  deleteAbsence: (personId: number, absenceId: number) =>
    req<void>('DELETE', `/persons/${personId}/absences/${absenceId}`),
  vacationContingents: (id: number) => req<VacationContingent[]>('GET', `/persons/${id}/vacation-contingents`),
  addVacationContingent: (id: number, d: Omit<VacationContingent, 'id' | 'person_id'>) =>
    req<VacationContingent>('POST', `/persons/${id}/vacation-contingents`, d),
  updateVacationContingent: (personId: number, contingentId: number, d: { year: number; total_days: number }) =>
    req<VacationContingent>('PUT', `/persons/${personId}/vacation-contingents/${contingentId}`, d),
  deleteVacationContingent: (personId: number, contingentId: number) =>
    req<void>('DELETE', `/persons/${personId}/vacation-contingents/${contingentId}`),
};

// ─── Invoices ────────────────────────────────────────────────────────────────

export const invoices = {
  get: (id: number) => req<MonthlyInvoice>('GET', `/invoices/${id}`),
  setStatus: (id: number, status: MonthlyInvoice['status']) =>
    req<MonthlyInvoice>('PUT', `/invoices/${id}/status`, { status }),
  reopen: (id: number) => req<void>('DELETE', `/invoices/${id}`),
};

// ─── Sage project mappings ───────────────────────────────────────────────────

export const mappings = {
  list: () => req<SageProjectMapping[]>('GET', '/sage-project-mappings'),
  create: (d: { sage_project_name: string; project_id: number }) =>
    req<SageProjectMapping>('POST', '/sage-project-mappings', d),
  update: (id: number, d: { sage_project_name: string; project_id: number }) =>
    req<SageProjectMapping>('PUT', `/sage-project-mappings/${id}`, d),
  delete: (id: number) => req<void>('DELETE', `/sage-project-mappings/${id}`),
};

// ─── Calendar ────────────────────────────────────────────────────────────────

export interface CalendarHoliday {
  holiday_date: string;
  name: string;
  is_workday: boolean;
}

export interface CalendarAbsence {
  id: number;
  start_date: string;
  end_date: string | null;
  absence_type: 'vacation' | 'sick' | 'training';
  status: 'planned' | 'confirmed' | 'ongoing';
}

export interface CalendarMembership {
  project_id: number;
  project_number: string;
  project_name: string;
  program_id: number | null;
  from_date: string;
  to_date: string;
  weekly_capacity_hours: number;
}

export interface CalendarPerson {
  id: number;
  name: string;
  default_weekly_hours: number;
  absences: CalendarAbsence[];
  memberships: CalendarMembership[];
}

export interface CalendarMilestoneBudget {
  person_id: number;
  current_hours: number;
  booked_hours: number;
}

export interface CalendarMilestone {
  project_id: number;
  project_number: string;
  year: number;
  month: number;
  status: 'open' | 'closed';
  is_locked: boolean;
  initial_hours: number | undefined;
  current_hours: number | undefined;
  budgets?: CalendarMilestoneBudget[];
}

export interface CalendarResponse {
  year: number;
  month: number;
  holidays: CalendarHoliday[];
  persons: CalendarPerson[];
  milestones: CalendarMilestone[];
}

export const calendar = {
  get: (year: number, month: number) =>
    req<CalendarResponse>('GET', `/calendar?year=${year}&month=${month}`),
};

// ─── Settings ────────────────────────────────────────────────────────────────

export interface DbPathInfo {
  url: string;
  path: string;
  config_source: string;
  cloud_warning: boolean;
}

export interface DbPathResult {
  new_path: string;
  restart_required: boolean;
  cloud_warning: boolean;
}

export const settings = {
  get: () => req<Record<string, string>>('GET', '/settings'),
  update: (key: string, value: string) =>
    req<{ key: string; value: string }>('PUT', `/settings/${key}`, { value }),
  getDbPath: () => req<DbPathInfo>('GET', '/settings/database-path'),
  setDbPath: (directory: string) =>
    req<DbPathResult>('PUT', '/settings/database-path', { directory }),
};

// ─── Imports ─────────────────────────────────────────────────────────────────

export const imports = {
  list: () => req<ImportBatch[]>('GET', '/imports'),
  bookings: (batchId: number) => req<TimeBooking[]>('GET', `/imports/${batchId}/bookings`),
};

// ─── Bookings ─────────────────────────────────────────────────────────────────

export const bookings = {
  flag: (id: number, data: { is_excluded: boolean; exclusion_reason?: ExclusionReason | null; exclusion_note?: string | null }) =>
    req<TimeBooking>('PUT', `/bookings/${id}/flag`, data),
};
