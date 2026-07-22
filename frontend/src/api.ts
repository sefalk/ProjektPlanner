/** Typed API client for the ProjektPlanner backend. */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

/** Error carrying the HTTP status and parsed response body so callers can react to
 *  specific cases (e.g. a 409 budget-confirmation prompt with a `warnings` payload). */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Event fired when any authenticated request gets a 401 — the session expired
 *  or the cookie is gone. The AuthProvider listens and drops the user, so the
 *  route guard bounces to the login page. Not fired by the bootstrap `me()`
 *  check (a logged-out visitor is normal, not an expiry). */
export const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized';

function raiseHttpError(method: string, path: string, status: number, text: string): never {
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  throw new ApiError(status, parsed, `${method} ${path} → ${status}: ${text}`);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // A 401 on a normal call means the session lapsed mid-use → tell the app to
    // re-authenticate, then still throw so the caller's own error path runs.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    }
    raiseHttpError(method, path, res.status, await res.text());
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
  sick_days_per_year_override: number | null;
  training_days_per_year_override: number | null;
  position_mode: boolean;
}

export interface PositionModeStatus {
  enabled: boolean;
  can_enable: boolean;
  reasons: string[];
}

export interface Person {
  id: number;
  name: string;
  sage_employee_name: string;
  default_weekly_hours: number;
  work_week_pattern: string | null;
  default_billing_rate: number | null;
  // Per-person holiday region override (null = inherit global setting).
  holiday_country?: string | null;
  holiday_state?: string | null;
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
  priority: number;
  vacation_days_taken: number;
  billing_position_id: number | null;
  warnings?: string[];
}

export interface BillingPosition {
  id: number;
  project_id: number;
  position_number: string;
  description: string;
  budget_euros: number;
  /** Hourly rate of the line item (Projektposten). 0 = no rate (simple invoicing position). */
  billing_rate_per_hour: number;
  /** WP3: false = hard cap (never planned past budget); true = cheap position, may exceed budget. */
  overrunnable: boolean;
}

/** Aggregate €-budget state across a project's line items (doc 21 §P3). */
export interface BillingPositionBudgetState {
  total_budget_euros: number;
  allocated_euros: number;
  open_euros: number;
  is_over: boolean;
  is_complete: boolean;
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
  is_planning_locked: boolean;
  target_budget_euros: number | null;
}

export interface MilestoneTargetResult {
  milestone: Milestone;
  achieved_euros: number;
  warnings: string[];
}

export interface MilestonePersonBudget {
  id: number;
  milestone_id: number;
  person_id: number;
  initial_hours: number;
  current_hours: number;
  is_manual_override: boolean;
  estimated_absence_days_override: number | null;
}

/** Response of a manual budget update (PUT persons/budgets): the row plus warnings. */
export interface BudgetUpdateResult {
  id: number;
  milestone_id: number;
  person_id: number;
  initial_hours: number;
  current_hours: number;
  is_manual_override: boolean;
  warnings: string[];
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
  estimated_absence_days: number;
  vacation_estimate_days: number;
  sick_estimate_days: number;
  training_estimate_days: number;
  holiday_days: number;
  billing_rate_per_hour: number;
  billing_position_id: number | null;
  booked_hours: number;
  is_manual_override: boolean;
  estimated_absence_days_override: number | null;
  cap_reason?: string | null;
}

export interface MilestoneDetail {
  milestone: Milestone;
  persons: MilestonePersonDetail[];
  warnings: string[];
}

export interface BudgetSuggestion {
  budget_id: number;
  person_id: number;
  current_hours: number;
  suggested_hours: number;
  billing_position_id: number | null;
}

export interface MilestoneSuggestion {
  milestone_id: number;
  year: number;
  month: number;
  total_current_hours: number;
  suggested_total_hours: number;
  budgets: BudgetSuggestion[];
}

export interface UtilizationRecommendation {
  person_id: number;
  person_name: string;
  free_weekly_hours: number;
  budget_headroom_euros: number;
  recommended_additional_hours: number;
}

export interface ResyncResult {
  added: number;
  removed: number;
  recomputed: number;
  changed_milestone_ids: number[];
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

export interface SagePositionMapping {
  id: number;
  project_id: number;
  sage_project_level: string;
  billing_position_id: number;
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
  billing_position_id: number | null;
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
  create: (d: Omit<Project, 'id' | 'position_mode'>) => req<Project>('POST', '/projects', d),
  get: (id: number) => req<Project>('GET', `/projects/${id}`),
  update: (id: number, d: Omit<Project, 'id' | 'position_mode'>) => req<Project>('PUT', `/projects/${id}`, d),
  delete: (id: number) => req<void>('DELETE', `/projects/${id}`),
  memberships: (id: number) => req<ProjectMembership[]>('GET', `/projects/${id}/memberships`),
  addMembership: (
    id: number,
    d: Omit<ProjectMembership, 'id' | 'project_id' | 'warnings' | 'billing_position_id'> & { billing_position_id?: number | null },
  ) => req<ProjectMembership>('POST', `/projects/${id}/memberships`, d),
  updateMembership: (
    projectId: number,
    membershipId: number,
    d: Pick<ProjectMembership, 'from_date' | 'to_date' | 'weekly_capacity_hours' | 'billing_rate_per_hour' | 'priority' | 'vacation_days_taken'> & { billing_position_id?: number | null },
  ) => req<ProjectMembership>('PUT', `/projects/${projectId}/memberships/${membershipId}`, d),
  deleteMembership: (projectId: number, membershipId: number) =>
    req<void>('DELETE', `/projects/${projectId}/memberships/${membershipId}`),
  sageLevels: (id: number) => req<string[]>('GET', `/projects/${id}/sage-levels`),
  billingPositions: (id: number) => req<BillingPosition[]>('GET', `/projects/${id}/billing-positions`),
  billingPositionsBudgetState: (id: number) =>
    req<BillingPositionBudgetState>('GET', `/projects/${id}/billing-positions/budget-state`),
  addBillingPosition: (
    id: number,
    d: { position_number: string; description?: string; budget_euros?: number | null; billing_rate_per_hour?: number; overrunnable?: boolean },
  ) => req<BillingPosition>('POST', `/projects/${id}/billing-positions`, d),
  updateBillingPosition: (
    projectId: number,
    bpId: number,
    d: { position_number: string; description?: string; budget_euros: number; billing_rate_per_hour?: number; overrunnable?: boolean },
  ) => req<BillingPosition>('PUT', `/projects/${projectId}/billing-positions/${bpId}`, d),
  deleteBillingPosition: (projectId: number, bpId: number) =>
    req<void>('DELETE', `/projects/${projectId}/billing-positions/${bpId}`),
  positionModeStatus: (id: number) =>
    req<PositionModeStatus>('GET', `/projects/${id}/position-mode`),
  setPositionMode: (id: number, enabled: boolean) =>
    req<Project>('PUT', `/projects/${id}/position-mode`, { enabled }),
  milestones: (id: number) => req<Milestone[]>('GET', `/projects/${id}/milestones`),
  milestonesDetail: (id: number) => req<MilestoneDetail[]>('GET', `/projects/${id}/milestones/detail`),
  initMilestones: (id: number, force?: boolean) => req<Milestone[]>('POST', `/projects/${id}/milestones/initialize${force ? '?force=true' : ''}`),
  resyncMilestones: (id: number) => req<ResyncResult>('POST', `/projects/${id}/milestones/resync`),
  setMilestoneTargetBudget: (projectId: number, milestoneId: number, targetEuros: number) =>
    req<MilestoneTargetResult>('PUT', `/projects/${projectId}/milestones/${milestoneId}/target-budget`, { target_euros: targetEuros }),
  clearMilestoneTargetBudget: (projectId: number, milestoneId: number) =>
    req<Milestone>('DELETE', `/projects/${projectId}/milestones/${milestoneId}/target-budget`),
  setHoursLock: (projectId: number, milestoneId: number, budgetId: number, locked: boolean) =>
    req<MilestonePersonBudget>('PUT', `/projects/${projectId}/milestones/${milestoneId}/budgets/${budgetId}/lock`, { locked }),
  setEstimatedAbsence: (projectId: number, milestoneId: number, budgetId: number, days: number | null) =>
    req<MilestonePersonBudget>('PUT', `/projects/${projectId}/milestones/${milestoneId}/budgets/${budgetId}/estimated-absence`, { days }),
  updatePersonBudget: (projectId: number, milestoneId: number, budgetId: number, hours: number, confirm?: boolean) =>
    req<BudgetUpdateResult>('PUT', `/projects/${projectId}/milestones/${milestoneId}/budgets/${budgetId}${confirm ? '?confirm=true' : ''}`, { current_hours: hours }),
  recommendations: (id: number) => req<UtilizationRecommendation[]>('GET', `/projects/${id}/milestones/recommendations`),
  recalcPreview: (id: number) => req<MilestoneSuggestion[]>('GET', `/projects/${id}/milestones/recalc-preview`),
  setPlanningLock: (projectId: number, milestoneId: number, locked: boolean) =>
    req<Milestone>('PUT', `/projects/${projectId}/milestones/${milestoneId}/planning-lock`, { locked }),
  invoices: (id: number) => req<MonthlyInvoice[]>('GET', `/projects/${id}/invoices`),
  closeMonth: (id: number, d: { year: number; month: number; billing_position_id: number }) =>
    req<MonthlyInvoice[]>('POST', `/projects/${id}/invoices/close`, d),
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
  absence_type: 'vacation' | 'sick' | 'training' | 'other';
  status: 'planned' | 'confirmed' | 'ongoing';
  note: string;
  // Half-day segments: which part of the start/end day the absence covers.
  start_segment?: 'full' | 'morning' | 'afternoon';
  end_segment?: 'full' | 'morning' | 'afternoon';
  // Booking metrics (backend-computed): working days & hours the absence books.
  booked_working_days?: number;
  booked_hours?: number;
  // Vacation only: contingent days consumed after the confirmed-sick (AU) refund.
  contingent_days?: number | null;
}

export interface AbsenceSummary {
  year: number;
  categories: Record<'vacation' | 'sick' | 'training' | 'other', { days: number; hours: number }>;
  vacation: { contingent: number; taken: number; planned: number; open: number };
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
  priority: number;
  vacation_days_taken: number;
  billing_position_id: number | null;
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
  absenceSummary: (id: number, year?: number) =>
    req<AbsenceSummary>('GET', `/persons/${id}/absence-summary${year ? `?year=${year}` : ''}`),
  absenceSummaryBatch: (year?: number) =>
    req<Record<number, AbsenceSummary>>('GET', `/persons/absence-summary${year ? `?year=${year}` : ''}`),
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

// ─── Sage position (level → line item) mappings ────────────────────────────────

export const positionMappings = {
  list: (projectId?: number) =>
    req<SagePositionMapping[]>('GET', `/sage-position-mappings${projectId != null ? `?project_id=${projectId}` : ''}`),
  create: (d: { project_id: number; sage_project_level: string; billing_position_id: number }) =>
    req<SagePositionMapping>('POST', '/sage-position-mappings', d),
  update: (id: number, d: { project_id: number; sage_project_level: string; billing_position_id: number }) =>
    req<SagePositionMapping>('PUT', `/sage-position-mappings/${id}`, d),
  delete: (id: number) => req<void>('DELETE', `/sage-position-mappings/${id}`),
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
  absence_type: 'vacation' | 'sick' | 'training' | 'other';
  status: 'planned' | 'confirmed' | 'ongoing';
  start_segment?: 'full' | 'morning' | 'afternoon';
  end_segment?: 'full' | 'morning' | 'afternoon';
  booked_working_days?: number;
  booked_hours?: number;
  contingent_days?: number | null;
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

export interface YearHoliday {
  holiday_date: string;
  name: string;
  is_workday: boolean;
  country: string;
  state: string;
}

export interface YearCalendarPerson {
  id: number;
  name: string;
  default_weekly_hours: number;
  holiday_country: string;
  holiday_state: string;
  absences: CalendarAbsence[];
  memberships: CalendarMembership[];
}

export interface YearCalendarResponse {
  year: number;
  country: string;
  state: string;
  holidays: YearHoliday[];
  persons: YearCalendarPerson[];
}

export const calendar = {
  get: (year: number, month: number) =>
    req<CalendarResponse>('GET', `/calendar?year=${year}&month=${month}`),
  year: (year: number, country?: string, state?: string) =>
    req<YearCalendarResponse>(
      'GET',
      `/calendar/year?year=${year}` +
        (country ? `&country=${encodeURIComponent(country)}` : '') +
        (state ? `&state=${encodeURIComponent(state)}` : ''),
    ),
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

// ─── Auth / account (multi-user, doc 25 WP4) ───────────────────────────────────

export interface User {
  id: number;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
}

export interface Invite {
  id: number;
  token: string;
  created_by: number | null;
  used_by: number | null;
  created_at: string | null;
  used_at: string | null;
  expires_at: string | null;
}

export const auth = {
  /** Current user, or null when unauthenticated. Uses a bare fetch so a logged-out
   *  visitor (401) is a normal outcome and does NOT raise the global re-auth event. */
  me: async (): Promise<User | null> => {
    const res = await fetch(`${BASE}/users/me`);
    if (res.status === 401) return null;
    if (!res.ok) raiseHttpError('GET', '/users/me', res.status, await res.text());
    return res.json();
  },

  /** fastapi-users login expects form-encoded `username`/`password` (OAuth2 form). */
  login: async (email: string, password: string): Promise<void> => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password }),
    });
    if (!res.ok) raiseHttpError('POST', '/auth/login', res.status, await res.text());
  },

  logout: () => req<void>('POST', '/auth/logout'),

  register: (d: { email: string; password: string; invite_token: string }) =>
    req<User>('POST', '/auth/register', d),

  invites: {
    list: () => req<Invite[]>('GET', '/auth/invites'),
    create: (expiresInDays: number | null = 14) =>
      req<Invite>('POST', '/auth/invites', { expires_in_days: expiresInDays }),
  },
};
