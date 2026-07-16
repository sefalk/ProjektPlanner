"""Milestone service — initialization and invariant enforcement.

Milestones represent one calendar month of planned work for a project.
The core invariant: SUM(MilestonePersonBudget.current_hours) == Milestone.current_hours.

Initialization:
  - One Milestone per calendar month between project.start_date and project.end_date.
  - One MilestonePersonBudget per active ProjectMembership for that month.
  - initial_hours considers: working weekdays, public holidays, confirmed absences,
    and estimated vacation from remaining contingent when no specific vacation is entered.
  - Calling initialize_milestones() again is safe: existing milestones are left untouched.

Budget updates:
  - Updating a MilestonePersonBudget.current_hours automatically syncs Milestone.current_hours.
  - Locked milestones cannot be modified (raises MilestoneLocked).
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from dataclasses import dataclass, field

from sqlalchemy import func
from sqlmodel import Session, select

from app.models.enums import AbsenceType
from app.models.billing import BillingPosition
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person, PersonAbsence
from app.models.project import Project
from app.models.setting import Setting
from app.services.holiday import HolidayFetchError, get_holidays_in_range
from app.services.planning import absence_days_in_range, estimated_vacation_days


class MilestoneLocked(Exception):
    """Raised when an attempt is made to modify a locked milestone."""


class MilestoneNotFound(Exception):
    pass


class BudgetNotFound(Exception):
    pass


class NoActiveMembership(Exception):
    """Raised when milestone initialization is attempted for a project without any
    active member (§8.1). Milestones without personnel are not allowed — the guard
    lives in the backend, not only in the UI."""


class BudgetConfirmationRequired(Exception):
    """Raised when a manual budget edit would exceed the project euro budget and no
    explicit confirmation was given (§8.2, V6). Carries the warnings for the UI dialog."""

    def __init__(self, warnings: list[str]) -> None:
        self.warnings = warnings
        super().__init__("; ".join(warnings))


class PositionModeNotEnableable(Exception):
    """Raised when enabling position mode is blocked by unmet preconditions (§21 WP8).
    Carries the human-readable reasons for the UI."""

    def __init__(self, reasons: list[str]) -> None:
        self.reasons = reasons
        super().__init__("; ".join(reasons))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    last_day = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def effective_rate(
    membership: ProjectMembership, positions_by_id: dict[int, BillingPosition]
) -> float:
    """Effective hourly rate of a member (§21 P2): the assigned line item's rate in
    position mode, otherwise the member's own rate (simple mode). positions_by_id maps
    billing_position_id → BillingPosition (pass the project's positions)."""
    if membership.billing_position_id is not None:
        pos = positions_by_id.get(membership.billing_position_id)
        if pos is not None:
            return pos.billing_rate_per_hour
    return membership.billing_rate_per_hour


def _months_in_range(start: date, end: date) -> list[tuple[int, int]]:
    """Return (year, month) pairs for every month overlapping [start, end]."""
    months: list[tuple[int, int]] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append((year, month))
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return months


def _overlap_days(range_start: date, range_end: date, a_start: date, a_end: date) -> int:
    overlap_start = max(range_start, a_start)
    overlap_end = min(range_end, a_end)
    if overlap_end < overlap_start:
        return 0
    return (overlap_end - overlap_start).days + 1


def _concrete_absence_days_of_type(
    person_id: int, absence_type: AbsenceType, start: date, end: date, session: Session
) -> float:
    """Concrete absence-day overlap of one type in [start, end] (from PersonAbsence)."""
    rows = session.exec(
        select(PersonAbsence).where(
            PersonAbsence.person_id == person_id,
            PersonAbsence.absence_type == absence_type,
            PersonAbsence.start_date <= end,
        )
    ).all()
    total = 0.0
    for a in rows:
        a_end = a.end_date if a.end_date is not None else date.today()
        if a_end < start:
            continue
        total += _overlap_days(start, end, a.start_date, a_end)
    return total


def _estimated_pauschal_days(
    person_id: int, absence_type: AbsenceType, annual_days: float, start: date, end: date, session: Session
) -> float:
    """Estimate a flat annual richtwert (sick/training) for the period [start, end].

    The annual value counts for a WHOLE calendar year and is spread EVENLY across it.
    Per year overlapping the period:
      remaining = max(0, annual − concrete absences of this type already entered that year)
      estimate += remaining × (effective period days in year / days in year)
    where effective period days exclude concrete-absence days of this type in the period
    (those are deducted separately, no double-count). This makes the estimate proportional
    to how much of the calendar year the period covers and shrinks as concrete days accrue.
    """
    if annual_days <= 0:
        return 0.0
    total = 0.0
    for year in range(start.year, end.year + 1):
        year_start, year_end = date(year, 1, 1), date(year, 12, 31)
        days_in_year = (year_end - year_start).days + 1
        concrete_year = _concrete_absence_days_of_type(person_id, absence_type, year_start, year_end, session)
        remaining = max(0.0, annual_days - concrete_year)
        if remaining <= 0.0:
            continue
        seg_start, seg_end = max(start, year_start), min(end, year_end)
        if seg_end < seg_start:
            continue
        period_days = (seg_end - seg_start).days + 1
        concrete_in_period = _concrete_absence_days_of_type(person_id, absence_type, seg_start, seg_end, session)
        period_effective = max(0.0, period_days - concrete_in_period)
        total += remaining * (period_effective / days_in_year)
    return total


def _parse_work_week_pattern(pattern: str) -> list[float] | None:
    parts = [p.strip() for p in pattern.split(",")]
    if len(parts) != 5:
        return None
    try:
        values = [float(p) for p in parts]
    except ValueError:
        return None
    return values if sum(values) > 0 else None


def _estimated_absence_override(
    person_id: int, project_id: int, year: int, month: int, session: Session
) -> float | None:
    """Return the manual estimated-absence override for this person/month, or None."""
    ms = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.year == year,
            Milestone.month == month,
        )
    ).first()
    if ms is None:
        return None
    row = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms.id,
            MilestonePersonBudget.person_id == person_id,
        )
    ).first()
    return row.estimated_absence_days_override if row else None


def _get_setting_float(session: Session, key: str, default: float) -> float:
    setting = session.get(Setting, key)
    if setting is None:
        return default
    try:
        return float(setting.value)
    except (ValueError, TypeError):
        return default


@dataclass
class PersonMonthStats:
    hours: float
    work_days: int
    absence_days: int            # concrete/planned absences (from PersonAbsence)
    holiday_days: int
    estimated_absence_days: float = 0.0  # estimated (remaining vacation + sick + training)
    # Breakdown of the auto-estimate (for the tooltip). When a manual override is active,
    # estimated_absence_days is the override and these components are the underlying auto parts.
    vacation_estimate_days: float = 0.0
    sick_estimate_days: float = 0.0
    training_estimate_days: float = 0.0


def _person_available_hours(
    person: Person,
    membership: ProjectMembership,
    project: Project,
    year: int,
    month: int,
    session: Session,
) -> PersonMonthStats:
    """Compute available hours and day statistics for one person in one project month.

    Accounts for: work week pattern, public holidays, specific absences, and
    distributed vacation estimate when no specific vacation entries exist.
    """
    month_start, month_end = _month_bounds(year, month)
    eff_start = max(membership.from_date, month_start)
    eff_end = min(membership.to_date, month_end)
    if eff_end < eff_start:
        return PersonMonthStats(0.0, 0, 0, 0)

    # Public holidays in effective period (fall back to zero holidays if API unavailable)
    try:
        holidays = get_holidays_in_range(eff_start, eff_end, project.holiday_country, project.holiday_state, session)
        holiday_dates = {h.holiday_date for h in holidays if h.is_workday}
    except HolidayFetchError:
        holiday_dates = set()
    holiday_days_count = len(holiday_dates)

    # Working days in effective period (Mon-Fri, not holiday)
    working_day_list: list[date] = []
    d = eff_start
    while d <= eff_end:
        if d.weekday() < 5 and d not in holiday_dates:
            working_day_list.append(d)
        d += timedelta(days=1)
    work_days_count = len(working_day_list)

    if work_days_count == 0:
        return PersonMonthStats(0.0, 0, 0, holiday_days_count)

    # Gross hours from pattern or uniform
    pattern = _parse_work_week_pattern(person.work_week_pattern) if person.work_week_pattern else None
    if pattern:
        total_pattern = sum(pattern)
        gross_hours = sum(
            pattern[day.weekday()] * (membership.weekly_capacity_hours / total_pattern)
            for day in working_day_list
        )
    else:
        gross_hours = work_days_count * (membership.weekly_capacity_hours / 5.0)

    avg_daily_hours = gross_hours / work_days_count

    # Specific absence days (all types including vacation)
    abs_days = absence_days_in_range(person.id, eff_start, eff_end, session)

    # Unplanned (remaining) vacation estimate for the effective period.
    # estimated_vacation_days already subtracts concrete vacation already taken in the
    # year (no double counting with abs_days) and distributes the remaining contingent
    # across the remaining days of the year — see B3 / planning.estimated_vacation_days.
    vacation_estimate = estimated_vacation_days(
        person.id, eff_start, eff_end, session, taken_days_flat=membership.vacation_days_taken
    )
    # Cap: can't estimate more vacation days than actual available working days
    vacation_estimate = min(vacation_estimate, max(0, work_days_count - abs_days))

    # Sick / training richtwerte: annual values spread evenly across the calendar year,
    # pro-rated to the effective period and reduced by concrete absences of that type (§3).
    # A per-project override replaces the global setting; 0 disables the estimate.
    annual_sick = (
        project.sick_days_per_year_override
        if project.sick_days_per_year_override is not None
        else _get_setting_float(session, "sick_days_per_year", 10.0)
    )
    sick_estimate = _estimated_pauschal_days(person.id, AbsenceType.sick, annual_sick, eff_start, eff_end, session)

    annual_training = (
        project.training_days_per_year_override
        if project.training_days_per_year_override is not None
        else _get_setting_float(session, "training_days_per_year", 5.0)
    )
    training_estimate = _estimated_pauschal_days(person.id, AbsenceType.training, annual_training, eff_start, eff_end, session)

    # A manual (locked) override, if set for this person/month, replaces the whole estimate.
    override = _estimated_absence_override(person.id, project.id, year, month, session)
    estimated_absence = override if override is not None else (vacation_estimate + sick_estimate + training_estimate)
    total_deduction = abs_days + estimated_absence
    net_hours = gross_hours - total_deduction * avg_daily_hours
    return PersonMonthStats(
        hours=max(0.0, net_hours),
        work_days=work_days_count,
        absence_days=int(abs_days),
        holiday_days=holiday_days_count,
        estimated_absence_days=estimated_absence,
        vacation_estimate_days=vacation_estimate,
        sick_estimate_days=sick_estimate,
        training_estimate_days=training_estimate,
    )


# ---------------------------------------------------------------------------
# Budget distribution (§6.6) — pure, fully unit-testable
# ---------------------------------------------------------------------------


SlotKey = tuple[int, tuple[int, int]]  # (person_id, (year, month))


def distribute_budget(
    avail: dict[SlotKey, float],
    rates: dict[int, float],
    priorities: dict[int, int],
    remaining_budget: float | None,
) -> dict[SlotKey, float]:
    """Distribute a capped budget over (person, month) capacity slots.

    See docs/implementation/20-milestone-review-and-rework.md §6.6.

    Args:
        avail: {(person_id, (year, month)): available_net_hours}. The hard per-person
               capacity cap — the result never exceeds these values.
        rates: {person_id: euro_rate_per_hour}. Pass {pid: 1.0} to cap by HOURS instead
               of euros (legacy total_budget_hours path).
        priorities: {person_id: priority}; smaller = higher priority, equal = same tier,
               missing = 0. Higher tiers are funded to full capacity first (B6).
        remaining_budget: the cap in the same unit as (hours × rate). None => no cap,
               i.e. plan = full available capacity (global scale s = 1).

    Guarantees (hard invariants, verified by tests):
        * plan[k] <= avail[k]                      (capacity / weekly hours, B2)
        * SUM(plan[k] * rates[pid]) <= remaining   (budget, B1)
    No rounding is applied — full float precision is kept so the euro budget can be
    represented cent-exact via hours (§9.4). Rounding happens only in the display layer.
    """
    plan: dict[SlotKey, float] = dict.fromkeys(avail, 0.0)
    if not avail:
        return plan
    if remaining_budget is None:
        return dict(avail)  # no cap → full capacity

    rest = max(0.0, remaining_budget)
    tiers = sorted({priorities.get(pid, 0) for (pid, _ym) in avail})
    for tier in tiers:
        tier_keys = [k for k in avail if priorities.get(k[0], 0) == tier]
        tier_cost = sum(avail[k] * rates.get(k[0], 0.0) for k in tier_keys)
        if tier_cost <= 0:
            continue
        if rest >= tier_cost:
            scale = 1.0
            rest -= tier_cost
        else:
            scale = rest / tier_cost
            rest = 0.0
        for k in tier_keys:
            plan[k] = avail[k] * scale
        if rest <= 0.0:
            break
    return plan


def _remaining_euro_budget(
    project_id: int,
    total_budget_euros: float,
    exclude_months: set[tuple[int, int]],
    rate_map: dict[int, float],
    session: Session,
) -> float:
    """Budget still available for the given (new) months (B5).

    remaining = total − Σ(invoiced amounts of closed/locked months, actual)
                      − Σ(planned cost of already-existing open milestones not being
                          (re)computed now)
    Clamped to >= 0.
    """
    from app.models.invoice import MonthlyInvoice

    invoiced = session.exec(
        select(func.coalesce(func.sum(MonthlyInvoice.total_amount_euros), 0.0)).where(
            MonthlyInvoice.project_id == project_id
        )
    ).one()
    invoiced = float(invoiced or 0.0)

    # Planned cost of existing OPEN milestones whose months are not being recomputed now.
    existing = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.is_locked == False,  # noqa: E712
        )
    ).all()
    open_cost = 0.0
    for ms in existing:
        if (ms.year, ms.month) in exclude_months:
            continue
        budgets = session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all()
        open_cost += sum(b.current_hours * rate_map.get(b.person_id, 0.0) for b in budgets)

    return max(0.0, total_budget_euros - invoiced - open_cost)


def project_positions(project_id: int, session: Session) -> dict[int, BillingPosition]:
    """Line items (Projektposten) of a project, keyed by id."""
    return {
        p.id: p
        for p in session.exec(
            select(BillingPosition).where(BillingPosition.project_id == project_id)
        ).all()
    }


def is_position_mode(project: Project) -> bool:
    """Position mode (§21 WP8) is the project's explicit opt-in flag. It is the single
    source of truth for distribution, member-assignment validation, import level-mapping
    and invoicing. Enabling is guarded (see can_enable_position_mode)."""
    return bool(project.position_mode)


def can_enable_position_mode(
    project: Project,
    memberships: list[ProjectMembership],
    positions: list[BillingPosition],
) -> tuple[bool, list[str]]:
    """Whether position mode may be turned on for a project, plus human-readable reasons
    for any blockers (§21 WP8). Requires: at least one priced line item; Σ Posten-Budget ==
    total (P3 fully allocated); every ACTIVE member assigned to a line item (P2)."""
    reasons: list[str] = []
    priced = [p for p in positions if p.billing_rate_per_hour > 0]
    if not priced:
        reasons.append("Es gibt keinen bepreisten Posten (Satz > 0).")
    allocated = sum(p.budget_euros for p in positions)
    if abs(allocated - project.total_budget_euros) > 1e-6:
        reasons.append(
            f"Σ Posten-Budget ({allocated:.2f} €) entspricht nicht dem Gesamtbudget "
            f"({project.total_budget_euros:.2f} €)."
        )
    active = [
        m for m in memberships
        if m.from_date <= project.end_date and m.to_date >= project.start_date
    ]
    unassigned = [m for m in active if m.billing_position_id is None]
    if unassigned:
        reasons.append(f"{len(unassigned)} aktive(s) Mitglied(er) ohne Posten-Zuweisung.")
    return (not reasons, reasons)


def set_position_mode(project_id: int, enabled: bool, session: Session) -> Project:
    """Toggle a project's Projektposten-Modus (§21 WP8). Enabling is guarded by
    can_enable_position_mode; disabling is always allowed. Commits."""
    project = session.get(Project, project_id)
    if not project:
        raise MilestoneNotFound(f"Project {project_id} not found.")
    if enabled and not project.position_mode:
        memberships = list(session.exec(
            select(ProjectMembership).where(ProjectMembership.project_id == project_id)
        ).all())
        positions = list(session.exec(
            select(BillingPosition).where(BillingPosition.project_id == project_id)
        ).all())
        ok, reasons = can_enable_position_mode(project, memberships, positions)
        if not ok:
            raise PositionModeNotEnableable(reasons)
    project.position_mode = enabled
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def build_rate_map(
    memberships: list[ProjectMembership], positions_by_id: dict[int, BillingPosition]
) -> dict[int, float]:
    """person_id → effective hourly rate (position rate in position mode, else member rate)."""
    return {m.person_id: effective_rate(m, positions_by_id) for m in memberships}


def _remaining_position_euro_budget(
    project_id: int,
    pos: BillingPosition,
    exclude_months: set[tuple[int, int]],
    position_pids: set[int],
    session: Session,
) -> float:
    """Budget still available for one line item (§21 P4), analogous to
    `_remaining_euro_budget` but scoped to a single position:

        R_posten = posten.budget_euros
                   − Σ(invoiced amounts of this position)
                   − Σ(planned cost of this position's members in existing open milestones
                       whose months are not being recomputed now)
    Clamped to >= 0.
    """
    from app.models.invoice import MonthlyInvoice

    invoiced = session.exec(
        select(func.coalesce(func.sum(MonthlyInvoice.total_amount_euros), 0.0)).where(
            MonthlyInvoice.project_id == project_id,
            MonthlyInvoice.billing_position_id == pos.id,
        )
    ).one()
    invoiced = float(invoiced or 0.0)

    existing = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.is_locked == False,  # noqa: E712
        )
    ).all()
    open_cost = 0.0
    for ms in existing:
        if (ms.year, ms.month) in exclude_months:
            continue
        budgets = session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all()
        open_cost += sum(
            b.current_hours * pos.billing_rate_per_hour
            for b in budgets
            if b.person_id in position_pids
        )

    return max(0.0, pos.budget_euros - invoiced - open_cost)


def distribute_over_positions(
    avail_map: dict[SlotKey, float],
    memberships: list[ProjectMembership],
    positions_by_id: dict[int, BillingPosition],
    priorities: dict[int, int],
    override_rows: list[MilestonePersonBudget],
    exclude_months: set[tuple[int, int]],
    project_id: int,
    session: Session,
) -> dict[SlotKey, float]:
    """Position-mode distribution (§21 P4): one independent bucket per line item.

    Each position distributes its own R_posten over only the members assigned to it, at the
    position's rate; buckets never borrow from one another (shifting hours between positions
    = adjusting position budgets manually). Members not assigned to any position get 0 h
    (WP4 makes assignment mandatory in position mode).
    """
    memb_by_pid = {m.person_id: m for m in memberships}
    plan: dict[SlotKey, float] = dict.fromkeys(avail_map, 0.0)
    for pos_id, pos in positions_by_id.items():
        position_pids = {m.person_id for m in memberships if m.billing_position_id == pos_id}
        if not position_pids:
            continue
        sub_avail = {k: h for k, h in avail_map.items() if k[0] in position_pids}
        if not sub_avail:
            continue
        rate = pos.billing_rate_per_hour
        rates = {pid: rate for pid in position_pids}
        base = _remaining_position_euro_budget(project_id, pos, exclude_months, position_pids, session)
        override_cost = sum(
            b.current_hours * rate
            for b in override_rows
            if (mb := memb_by_pid.get(b.person_id)) is not None and mb.billing_position_id == pos_id
        )
        remaining = max(0.0, base - override_cost)
        plan.update(distribute_budget(sub_avail, rates, priorities, remaining))
    return plan


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def initialize_milestones(project_id: int, session: Session, force: bool = False) -> list[Milestone]:
    """Create Milestone + MilestonePersonBudget rows for the full project range.

    When force=False (default): skips months that already have a Milestone (safe to call
    multiple times) and repairs member budget rows for existing milestones.

    When force=True: deletes all unlocked milestones and re-creates everything from scratch.
    Locked (invoiced) milestones are never touched.

    initial_hours = available capacity per person (working days minus holidays, absences,
                    and proportional sick/vacation/training estimates), distributed so the
                    euro budget is maximally used but never exceeded (see distribute_budget).
    current_hours = same as initial_hours on first creation (editable afterwards).

    Budget distribution (§6.6):
      If total_budget_euros > 0: a single global scale s = min(1, R / Cmax) caps hours by
      the remaining euro budget R and by each person's capacity; member priority (B6) funds
      higher tiers first. If total_budget_hours only: same logic with unit rates (hours cap).
      Otherwise: initial_hours = full available capacity (no cap).
    """
    project = session.get(Project, project_id)
    if not project:
        raise MilestoneNotFound(f"Project {project_id} not found.")

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()
    positions_by_id = project_positions(project_id, session)
    position_mode = is_position_mode(project)
    membership_rate_map: dict[int, float] = build_rate_map(memberships, positions_by_id)

    person_cache: dict[int, Person] = {}

    def _get_person(pid: int) -> Person | None:
        if pid not in person_cache:
            person_cache[pid] = session.get(Person, pid)
        return person_cache[pid]

    # Guard (§8.1): milestones require personnel. At least one membership must overlap
    # the project range, otherwise we refuse to (re-)initialize — no mutation happens.
    active_memberships = [
        m for m in memberships
        if m.from_date <= project.end_date and m.to_date >= project.start_date
    ]
    if not active_memberships:
        raise NoActiveMembership(
            f"Project {project_id} has no active members. "
            "Add at least one member before initializing milestones."
        )

    current_person_ids = {m.person_id for m in memberships}
    all_project_months = _months_in_range(project.start_date, project.end_date)

    # When force=True, delete all unlocked milestones so they get fully re-created below.
    # Closed (invoiced) AND planning-locked months are protected from the hard reset.
    if force:
        unlocked = session.exec(
            select(Milestone).where(
                Milestone.project_id == project_id,
                Milestone.is_locked == False,  # noqa: E712
                Milestone.is_planning_locked == False,  # noqa: E712
            )
        ).all()
        for ms in unlocked:
            budgets = session.exec(
                select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
            ).all()
            for b in budgets:
                session.delete(b)
            session.delete(ms)
        session.flush()

    # Determine which months need to be created; also find existing milestones needing repair
    new_months: list[tuple[int, int]] = []
    repair_milestones: list[Milestone] = []
    for year, month in all_project_months:
        exists = session.exec(
            select(Milestone).where(
                Milestone.project_id == project_id,
                Milestone.year == year,
                Milestone.month == month,
            )
        ).first()
        if not exists:
            new_months.append((year, month))
        else:
            existing_budgets = session.exec(
                select(MilestonePersonBudget).where(
                    MilestonePersonBudget.milestone_id == exists.id
                )
            ).all()
            existing_person_ids = {b.person_id for b in existing_budgets}
            if current_person_ids - existing_person_ids:
                repair_milestones.append(exists)

    if not new_months and not repair_milestones:
        return []

    # First pass: compute available capacity per person per month
    month_capacity: dict[tuple[int, int], dict[int, float]] = {}
    for year, month in new_months:
        person_hours: dict[int, float] = {}
        for m in memberships:
            person = _get_person(m.person_id)
            if person is None:
                continue
            stats = _person_available_hours(person, m, project, year, month, session)
            if stats.hours > 0:
                person_hours[m.person_id] = person_hours.get(m.person_id, 0.0) + stats.hours
        month_capacity[(year, month)] = person_hours

    # Build the (person, month) availability map and distribute the budget across all new
    # months jointly (§6.6). The budget cap is global, so a single distribution call spans
    # every new month; member priority (B6) funds higher tiers first.
    avail_map: dict[SlotKey, float] = {}
    for (year, month), person_hours in month_capacity.items():
        for pid, hours in person_hours.items():
            avail_map[(pid, (year, month))] = hours

    priorities = {m.person_id: m.priority for m in memberships}
    new_month_set = set(new_months)

    budget_euros = project.total_budget_euros if project.total_budget_euros and project.total_budget_euros > 0 else 0.0
    budget_hours = project.total_budget_hours if project.total_budget_hours and project.total_budget_hours > 0 else 0.0

    if position_mode:
        # §21 P4: distribute each line item's budget independently over its members.
        plan_map = distribute_over_positions(
            avail_map, memberships, positions_by_id, priorities, [], new_month_set, project_id, session
        )
    elif budget_euros > 0:
        remaining = _remaining_euro_budget(
            project_id, budget_euros, new_month_set, membership_rate_map, session
        )
        plan_map = distribute_budget(avail_map, membership_rate_map, priorities, remaining)
    elif budget_hours > 0:
        # Legacy hours cap: unit rates so the "cost" is measured in hours.
        committed_hours = sum(
            ms.current_hours
            for ms in session.exec(
                select(Milestone).where(Milestone.project_id == project_id)
            ).all()
            if (ms.year, ms.month) not in new_month_set
        )
        remaining_hours = max(0.0, budget_hours - committed_hours)
        unit_rates = dict.fromkeys(priorities, 1.0)
        plan_map = distribute_budget(avail_map, unit_rates, priorities, remaining_hours)
    else:
        plan_map = distribute_budget(avail_map, membership_rate_map, priorities, None)

    # Create new milestone rows from the distributed plan
    created: list[Milestone] = []
    for year, month in new_months:
        person_hours = month_capacity[(year, month)]
        month_plan = {pid: plan_map.get((pid, (year, month)), 0.0) for pid in person_hours}
        total = sum(month_plan.values())

        milestone = Milestone(
            project_id=project_id,
            year=year,
            month=month,
            initial_hours=total,
            current_hours=total,
        )
        session.add(milestone)
        session.flush()

        # Create a budget row for every active member this month (even 0 h, e.g. lower
        # priority tiers not funded), so the per-person breakdown stays transparent.
        for person_id in person_hours:
            hours = month_plan.get(person_id, 0.0)
            session.add(MilestonePersonBudget(
                milestone_id=milestone.id,
                person_id=person_id,
                initial_hours=hours,
                current_hours=hours,
            ))

        created.append(milestone)

    # Repair existing open milestones (member added/removed/rescaled) via the shared,
    # correctly scaled alignment (fixes BUG-4 — the old repair path inserted unscaled
    # hours). Skipped on a fresh init (no pre-existing milestones to repair) so the
    # new-month distribution above is authoritative. Manual overrides are preserved.
    if repair_milestones:
        _align_open_milestones(project, session)

    session.commit()
    for m in created:
        session.refresh(m)
    return created


def update_person_budget(
    milestone_id: int,
    budget_id: int,
    new_hours: float,
    session: Session,
    *,
    mark_override: bool = False,
) -> tuple[MilestonePersonBudget, Milestone]:
    """Update a person's current_hours budget and sync Milestone.current_hours.

    When mark_override=True the row is flagged is_manual_override so resync preserves it
    (V5). Raises MilestoneLocked if the milestone is locked.
    Raises MilestoneNotFound / BudgetNotFound for missing records.
    Raises ValueError if new_hours < 0 or the budget does not belong to the milestone.
    """
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise MilestoneNotFound(f"Milestone {milestone_id} not found.")
    if milestone.is_locked:
        raise MilestoneLocked(f"Milestone {milestone_id} is locked.")

    budget = session.get(MilestonePersonBudget, budget_id)
    if not budget or budget.milestone_id != milestone_id:
        raise BudgetNotFound(f"Budget {budget_id} not found in milestone {milestone_id}.")

    if new_hours < 0:
        raise ValueError("Budget hours cannot be negative.")

    budget.current_hours = new_hours
    if mark_override:
        budget.is_manual_override = True

    all_budgets = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id
        )
    ).all()
    milestone.current_hours = sum(b.current_hours for b in all_budgets)

    session.add(budget)
    session.add(milestone)
    session.commit()
    session.refresh(budget)
    session.refresh(milestone)
    return budget, milestone


def update_person_budget_by_person(
    milestone_id: int,
    person_id: int,
    new_hours: float,
    session: Session,
) -> tuple[MilestonePersonBudget, Milestone]:
    """Update by person_id instead of budget_id. Convenience for the detail view."""
    budget = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id,
            MilestonePersonBudget.person_id == person_id,
        )
    ).first()
    if not budget:
        raise BudgetNotFound(f"No budget for person {person_id} in milestone {milestone_id}.")
    return update_person_budget(milestone_id, budget.id, new_hours, session)


# ---------------------------------------------------------------------------
# Manual adjustment with confirmation (V6, §8.2, WP5)
# ---------------------------------------------------------------------------


def _projected_budget_after_edit(
    milestone: Milestone,
    budget: MilestonePersonBudget,
    new_hours: float,
    session: Session,
) -> tuple[float, float]:
    """Return (projected_total_cost, budget_euros) if `budget.current_hours` becomes
    `new_hours`. Projected = invoiced (locked, Ist) + planned cost of all OPEN milestones,
    with the edited row substituted. Budget is the project euro budget (B1, §8.2)."""
    from app.models.invoice import MonthlyInvoice

    project = session.get(Project, milestone.project_id)
    budget_euros = project.total_budget_euros if project else 0.0

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == milestone.project_id)
    ).all()
    rate_map = build_rate_map(memberships, project_positions(milestone.project_id, session))

    invoiced = session.exec(
        select(func.coalesce(func.sum(MonthlyInvoice.total_amount_euros), 0.0)).where(
            MonthlyInvoice.project_id == milestone.project_id
        )
    ).one()
    projected = float(invoiced or 0.0)

    open_ms = session.exec(
        select(Milestone).where(
            Milestone.project_id == milestone.project_id,
            Milestone.is_locked == False,  # noqa: E712
        )
    ).all()
    for ms in open_ms:
        for b in session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all():
            hrs = new_hours if b.id == budget.id else b.current_hours
            projected += hrs * rate_map.get(b.person_id, 0.0)

    return projected, budget_euros


def manual_budget_update(
    milestone_id: int,
    budget_id: int,
    new_hours: float,
    session: Session,
    *,
    confirm: bool = False,
) -> tuple[MilestonePersonBudget, Milestone, list[str]]:
    """Manual budget edit with budget/capacity validation (V6, §8.2, BUG-6).

    * new_hours < 0                → ValueError.
    * new_hours > available (avail) → soft warning only; the save proceeds (leadership may
      deliberately overbook a manual override, §9.2).
    * would exceed the project euro budget → without `confirm`, raise
      BudgetConfirmationRequired (HTTP 409, no save); with `confirm=True`, save anyway.
    * every successful manual edit sets is_manual_override=True so resync preserves it.

    Returns (budget, milestone, warnings). warnings are informational (avail/budget notes
    that accompanied a confirmed save).
    """
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise MilestoneNotFound(f"Milestone {milestone_id} not found.")
    if milestone.is_locked:
        raise MilestoneLocked(f"Milestone {milestone_id} is locked.")

    budget = session.get(MilestonePersonBudget, budget_id)
    if not budget or budget.milestone_id != milestone_id:
        raise BudgetNotFound(f"Budget {budget_id} not found in milestone {milestone_id}.")

    if new_hours < 0:
        raise ValueError("Budget hours cannot be negative.")

    warnings: list[str] = []

    # Soft capacity warning (B2 stays hard only for the automatic distribution, §9.2).
    project = session.get(Project, milestone.project_id)
    membership = session.exec(
        select(ProjectMembership).where(
            ProjectMembership.project_id == milestone.project_id,
            ProjectMembership.person_id == budget.person_id,
        )
    ).first()
    person = session.get(Person, budget.person_id)
    if project and membership and person:
        avail = _person_available_hours(
            person, membership, project, milestone.year, milestone.month, session
        ).hours
        if new_hours > avail + 1e-6:
            warnings.append(
                f"Über verfügbarer Kapazität: {new_hours:.1f} h geplant, "
                f"aber nur {avail:.1f} h verfügbar."
            )

    # Budget guard (B1): requires confirmation on overrun.
    projected, budget_euros = _projected_budget_after_edit(milestone, budget, new_hours, session)
    if budget_euros > 0 and projected > budget_euros + 1e-6:
        budget_warning = (
            f"Budget würde überschritten: geplant {projected:.2f} € > "
            f"Budget {budget_euros:.2f} € (Δ {projected - budget_euros:.2f} €)."
        )
        if not confirm:
            raise BudgetConfirmationRequired(warnings + [budget_warning])
        warnings.append(budget_warning)

    budget, milestone = update_person_budget(
        milestone_id, budget_id, new_hours, session, mark_override=True
    )
    return budget, milestone, warnings


def manual_budget_update_by_person(
    milestone_id: int,
    person_id: int,
    new_hours: float,
    session: Session,
    *,
    confirm: bool = False,
) -> tuple[MilestonePersonBudget, Milestone, list[str]]:
    """manual_budget_update resolved by person_id (detail-view convenience)."""
    budget = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id,
            MilestonePersonBudget.person_id == person_id,
        )
    ).first()
    if not budget:
        raise BudgetNotFound(f"No budget for person {person_id} in milestone {milestone_id}.")
    return manual_budget_update(milestone_id, budget.id, new_hours, session, confirm=confirm)


def set_milestone_target_budget(
    project_id: int,
    milestone_id: int,
    target_euros: float,
    session: Session,
) -> tuple[Milestone, float, list[str]]:
    """Set an explicit € target for one month and (re)distribute the members' hours to
    hit it (B1: € leads, hours follow, capped by available capacity and priority).

    The target mirrors the external billing system. The month's per-person rows are set to
    the distributed plan and flagged is_manual_override so a later global resync/rebalance
    preserves them. Returns (milestone, achieved_euros, warnings). achieved_euros < target
    (with a warning) when the available capacity cannot absorb the full target.

    Raises MilestoneNotFound, MilestoneLocked, ValueError (negative target).
    """
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise MilestoneNotFound(f"Milestone {milestone_id} not found in project {project_id}.")
    if milestone.is_locked:
        raise MilestoneLocked(f"Milestone {milestone_id} is locked.")
    if target_euros < 0:
        raise ValueError("Target budget cannot be negative.")

    project = session.get(Project, project_id)
    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()
    positions_by_id = project_positions(project_id, session)
    rate_map = build_rate_map(memberships, positions_by_id)
    priorities = {m.person_id: m.priority for m in memberships}

    month_start, month_end = _month_bounds(milestone.year, milestone.month)
    active = [m for m in memberships if m.from_date <= month_end and m.to_date >= month_start]

    # Available net capacity per active member this month.
    avail_map: dict[SlotKey, float] = {}
    for m in active:
        person = session.get(Person, m.person_id)
        if person is None:
            continue
        avail = _person_available_hours(person, m, project, milestone.year, milestone.month, session).hours
        if avail > 0:
            avail_map[(m.person_id, (milestone.year, milestone.month))] = avail

    plan = distribute_budget(avail_map, rate_map, priorities, target_euros)
    achieved = sum(hours * rate_map.get(pid, 0.0) for (pid, _ym), hours in plan.items())

    # Apply the plan: upsert a manual-override row per active member.
    existing = {
        b.person_id: b
        for b in session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == milestone_id)
        ).all()
    }
    for m in active:
        hours = plan.get((m.person_id, (milestone.year, milestone.month)), 0.0)
        row = existing.get(m.person_id)
        if row is None:
            session.add(MilestonePersonBudget(
                milestone_id=milestone_id, person_id=m.person_id,
                initial_hours=hours, current_hours=hours, is_manual_override=True,
            ))
        else:
            row.current_hours = hours
            row.is_manual_override = True
            session.add(row)

    milestone.target_budget_euros = target_euros
    session.add(milestone)
    session.flush()
    _resync_milestone_totals(milestone, session)
    session.commit()
    session.refresh(milestone)

    warnings: list[str] = []
    if achieved < target_euros - 1e-6:
        warnings.append(
            f"Ziel-Budget übersteigt die verfügbare Kapazität dieses Monats — "
            f"nur {achieved:.2f} € von {target_euros:.2f} € planbar."
        )
    return milestone, achieved, warnings


def clear_milestone_target_budget(project_id: int, milestone_id: int, session: Session) -> Milestone:
    """Unlock a month's € target: drop the explicit target and unlock its budget rows so
    a later resync/rebalance may recompute them. Current hours are left in place until
    such a recompute runs (§ lock semantics). Locked (closed) months are rejected."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise MilestoneNotFound(f"Milestone {milestone_id} not found in project {project_id}.")
    if milestone.is_locked:
        raise MilestoneLocked(f"Milestone {milestone_id} is locked.")
    milestone.target_budget_euros = None
    for row in session.exec(
        select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == milestone_id)
    ).all():
        row.is_manual_override = False
        session.add(row)
    session.add(milestone)
    session.commit()
    session.refresh(milestone)
    return milestone


def set_milestone_planning_lock(milestone_id: int, locked: bool, session: Session) -> Milestone:
    """Freeze/unfreeze a whole month for planning (distinct from closed/invoiced). A
    planning-locked month is left untouched by "Neu berechnen"/force-init. Rejected on
    closed (invoiced) milestones (those are already fully protected)."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise MilestoneNotFound(f"Milestone {milestone_id} not found.")
    if milestone.is_locked:
        raise MilestoneLocked(f"Milestone {milestone_id} is closed (invoiced).")
    milestone.is_planning_locked = locked
    session.add(milestone)
    session.commit()
    session.refresh(milestone)
    return milestone


def set_budget_hours_lock(
    milestone_id: int, person_id: int, locked: bool, session: Session
) -> MilestonePersonBudget:
    """Lock/unlock a person's hours for a month. Locked rows are preserved by
    resync/rebalance; unlocking keeps the current value until the next recompute."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise MilestoneNotFound(f"Milestone {milestone_id} not found.")
    if milestone.is_locked:
        raise MilestoneLocked(f"Milestone {milestone_id} is locked.")
    budget = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id,
            MilestonePersonBudget.person_id == person_id,
        )
    ).first()
    if not budget:
        raise BudgetNotFound(f"No budget for person {person_id} in milestone {milestone_id}.")
    budget.is_manual_override = locked
    session.add(budget)
    session.commit()
    session.refresh(budget)
    return budget


def set_estimated_absence(
    milestone_id: int, person_id: int, days: float | None, session: Session
) -> MilestonePersonBudget:
    """Set (or clear, days=None) the manual estimated-absence override for a person/month.
    Affects the availability calc. Rejected on locked (closed) months.
    Raises ValueError on negative days."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise MilestoneNotFound(f"Milestone {milestone_id} not found.")
    if milestone.is_locked:
        raise MilestoneLocked(f"Milestone {milestone_id} is locked.")
    if days is not None and days < 0:
        raise ValueError("Estimated absence days cannot be negative.")
    budget = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id,
            MilestonePersonBudget.person_id == person_id,
        )
    ).first()
    if not budget:
        raise BudgetNotFound(f"No budget for person {person_id} in milestone {milestone_id}.")
    budget.estimated_absence_days_override = days
    session.add(budget)
    session.commit()
    session.refresh(budget)
    return budget


# ---------------------------------------------------------------------------
# Referential actions (V11) — keep milestones consistent when memberships or the
# project range change. Locked (invoiced) months are ALWAYS protected.
# ---------------------------------------------------------------------------


def _resync_milestone_totals(milestone: Milestone, session: Session) -> None:
    """Recompute the milestone's denormalized hour caches from its budget rows (V10).

    Milestone.initial_hours is the cache of Σ budget.initial_hours (baseline),
    Milestone.current_hours the cache of Σ budget.current_hours. Both are kept in
    sync whenever a budget row is added or removed.
    """
    budgets = session.exec(
        select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == milestone.id)
    ).all()
    milestone.initial_hours = sum(b.initial_hours for b in budgets)
    milestone.current_hours = sum(b.current_hours for b in budgets)
    session.add(milestone)


def remove_member_budgets(project_id: int, person_id: int, session: Session) -> list[Milestone]:
    """Remove a person's budget rows from all OPEN milestones of a project (V11, BUG-7).

    Locked (invoiced) months keep their historical rows untouched. Affected milestone
    totals are re-synced. Does not commit — the caller owns the transaction.
    Returns the list of milestones whose totals changed.
    """
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project_id)
    ).all()
    affected: list[Milestone] = []
    for ms in milestones:
        if ms.is_locked:
            continue
        rows = session.exec(
            select(MilestonePersonBudget).where(
                MilestonePersonBudget.milestone_id == ms.id,
                MilestonePersonBudget.person_id == person_id,
            )
        ).all()
        if not rows:
            continue
        for row in rows:
            session.delete(row)
        session.flush()
        _resync_milestone_totals(ms, session)
        affected.append(ms)
    return affected


def prune_member_budgets_to_range(
    project_id: int,
    person_id: int,
    from_date: date,
    to_date: date,
    session: Session,
) -> list[Milestone]:
    """Remove a member's budget rows from OPEN milestones whose month no longer overlaps
    the member's [from_date, to_date] range (V11, membership date change).

    Locked months are protected. Budgets for months still inside the range are left as
    they are — recomputing changed weekly hours into existing budgets is the resync path
    (WP4/WP5), not this referential cleanup. Does not commit.
    Returns the list of milestones whose totals changed.
    """
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project_id)
    ).all()
    affected: list[Milestone] = []
    for ms in milestones:
        if ms.is_locked:
            continue
        month_start, month_end = _month_bounds(ms.year, ms.month)
        if from_date <= month_end and to_date >= month_start:
            continue  # still overlaps — keep
        rows = session.exec(
            select(MilestonePersonBudget).where(
                MilestonePersonBudget.milestone_id == ms.id,
                MilestonePersonBudget.person_id == person_id,
            )
        ).all()
        if not rows:
            continue
        for row in rows:
            session.delete(row)
        session.flush()
        _resync_milestone_totals(ms, session)
        affected.append(ms)
    return affected


def apply_project_range_change(project: Project, session: Session) -> list[str]:
    """Reconcile milestones with a changed project range (V11, project date change).

    Months now outside [project.start_date, project.end_date]:
      - open milestone → deleted (with its budget rows),
      - locked milestone → kept, and a warning string is returned so the UI can flag it.
    Milestones inside the range are untouched. Does not commit.
    Returns warning strings for locked out-of-range months.
    """
    valid_months = set(_months_in_range(project.start_date, project.end_date))
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project.id)
    ).all()
    warnings: list[str] = []
    for ms in milestones:
        if (ms.year, ms.month) in valid_months:
            continue
        if ms.is_locked:
            warnings.append(
                f"{ms.year}-{ms.month:02d}: gesperrter Meilenstein liegt außerhalb des "
                "neuen Projektzeitraums und bleibt erhalten."
            )
            continue
        budgets = session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all()
        for b in budgets:
            session.delete(b)
        session.delete(ms)
    session.flush()
    return warnings


# ---------------------------------------------------------------------------
# Non-destructive resync (V5, WP4) — align open milestones to the current
# membership state without discarding manual overrides.
# ---------------------------------------------------------------------------


@dataclass
class ResyncSummary:
    added: int = 0        # budget rows created for newly active members
    removed: int = 0      # rows removed for members no longer active that month
    recomputed: int = 0   # auto rows whose current_hours changed
    changed_milestone_ids: list[int] = field(default_factory=list)


def _align_open_milestones(project: Project, session: Session) -> ResyncSummary:
    """Non-destructively align all OPEN milestones to the current membership state.

    Fixes BUG-4/5/7 (V5):
      * add correctly scaled budget rows for members newly active in a month,
      * remove rows for members no longer active that month,
      * recompute auto (non-override) rows from current capacity and the budget (§6.6),
      * leave ``is_manual_override`` rows and locked months untouched.

    Manual-override commitments and invoiced (locked) months reduce the distributable
    budget R first; the remainder is spread over the recomputed slots. Baselines
    (``initial_hours``) are set once when a row is created and never changed here (V10).
    Does not commit — the caller owns the transaction.
    """
    project_id = project.id
    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()
    positions_by_id = project_positions(project_id, session)
    position_mode = is_position_mode(project)
    rate_map = build_rate_map(memberships, positions_by_id)
    priorities = {m.person_id: m.priority for m in memberships}

    person_cache: dict[int, Person] = {}

    def _get_person(pid: int) -> Person | None:
        if pid not in person_cache:
            person_cache[pid] = session.get(Person, pid)
        return person_cache[pid]

    open_ms = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.is_locked == False,  # noqa: E712
            Milestone.is_planning_locked == False,  # noqa: E712 — planning-locked months are frozen
        ).order_by(Milestone.year, Milestone.month)
    ).all()

    summary = ResyncSummary()
    changed: set[int] = set()

    rows_by_ms: dict[int, dict[int, MilestonePersonBudget]] = {}
    recompute_avail: dict[SlotKey, float] = {}
    override_rows: list[MilestonePersonBudget] = []
    zero_avail_autos: list[MilestonePersonBudget] = []

    for ms in open_ms:
        month_start, month_end = _month_bounds(ms.year, ms.month)
        active = [m for m in memberships if m.from_date <= month_end and m.to_date >= month_start]
        active_pids = {m.person_id for m in active}
        rows = {
            b.person_id: b
            for b in session.exec(
                select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
            ).all()
        }
        rows_by_ms[ms.id] = rows

        # Remove rows for members no longer active this month (überzählig, BUG-7).
        for pid, b in list(rows.items()):
            if pid not in active_pids:
                session.delete(b)
                del rows[pid]
                summary.removed += 1
                changed.add(ms.id)

        for m in active:
            pid = m.person_id
            b = rows.get(pid)
            if b is not None and b.is_manual_override:
                override_rows.append(b)  # fixed commitment, never recomputed
                continue
            person = _get_person(pid)
            if person is None:
                continue
            avail = _person_available_hours(person, m, project, ms.year, ms.month, session).hours
            if avail > 0:
                recompute_avail[(pid, (ms.year, ms.month))] = avail
            elif b is not None:
                zero_avail_autos.append(b)  # existing row, member now has no capacity

    session.flush()

    # Distributable budget: total − invoiced(locked) − manual-override commitments.
    budget_euros = project.total_budget_euros if project.total_budget_euros and project.total_budget_euros > 0 else 0.0
    budget_hours = project.total_budget_hours if project.total_budget_hours and project.total_budget_hours > 0 else 0.0
    open_month_set = {(ms.year, ms.month) for ms in open_ms}

    if position_mode:
        plan = distribute_over_positions(
            recompute_avail, memberships, positions_by_id, priorities, override_rows,
            open_month_set, project_id, session,
        )
    elif budget_euros > 0:
        override_cost = sum(b.current_hours * rate_map.get(b.person_id, 0.0) for b in override_rows)
        base_remaining = _remaining_euro_budget(project_id, budget_euros, open_month_set, rate_map, session)
        remaining = max(0.0, base_remaining - override_cost)
        plan = distribute_budget(recompute_avail, rate_map, priorities, remaining)
    elif budget_hours > 0:
        override_hours = sum(b.current_hours for b in override_rows)
        committed = sum(
            ms.current_hours
            for ms in session.exec(select(Milestone).where(Milestone.project_id == project_id)).all()
            if (ms.year, ms.month) not in open_month_set
        )
        remaining_h = max(0.0, budget_hours - committed - override_hours)
        unit_rates = dict.fromkeys(priorities, 1.0)
        plan = distribute_budget(recompute_avail, unit_rates, priorities, remaining_h)
    else:
        plan = distribute_budget(recompute_avail, rate_map, priorities, None)

    ms_by_ym = {(ms.year, ms.month): ms for ms in open_ms}
    for (pid, ym), hours in plan.items():
        ms = ms_by_ym[ym]
        rows = rows_by_ms[ms.id]
        b = rows.get(pid)
        if b is None:
            session.add(MilestonePersonBudget(
                milestone_id=ms.id, person_id=pid,
                initial_hours=hours, current_hours=hours,  # baseline set at creation (V10)
            ))
            summary.added += 1
            changed.add(ms.id)
        else:
            if b.current_hours != hours:
                b.current_hours = hours  # initial_hours (baseline) preserved (V10)
                session.add(b)
                summary.recomputed += 1
                changed.add(ms.id)

    for b in zero_avail_autos:
        if b.current_hours != 0.0:
            b.current_hours = 0.0
            session.add(b)
            summary.recomputed += 1
            changed.add(b.milestone_id)

    session.flush()
    for ms in open_ms:
        _resync_milestone_totals(ms, session)

    summary.changed_milestone_ids = sorted(changed)
    return summary


def resync_milestones(project_id: int, session: Session) -> ResyncSummary:
    """Public, non-destructive resync of a project's open milestones (V5, WP4).

    Aligns open milestones to the current membership state (add/remove/rescale),
    preserving ``is_manual_override`` rows and locked months. This is the sanctioned
    alternative to ``initialize?force=true`` (which discards manual overrides).
    """
    project = session.get(Project, project_id)
    if not project:
        raise MilestoneNotFound(f"Project {project_id} not found.")
    summary = _align_open_milestones(project, session)
    session.commit()
    return summary


def _person_hours_in_month(membership: ProjectMembership, year: int, month: int) -> float:
    """Simple capacity calc without holiday/absence deduction (used by rebalancing service)."""
    month_start, month_end = _month_bounds(year, month)
    eff_start = max(membership.from_date, month_start)
    eff_end = min(membership.to_date, month_end)
    if eff_end < eff_start:
        return 0.0
    from app.services.planning import working_days as _working_days
    days = _working_days(eff_start, eff_end)
    return days * (membership.weekly_capacity_hours / 5)


def get_milestone_budgets(milestone_id: int, session: Session) -> list[MilestonePersonBudget]:
    return session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id
        )
    ).all()
