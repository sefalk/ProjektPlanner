"""Planning service — availability and capacity calculations.

All functions are read-only (no DB writes). The only external I/O is the
holiday fetch triggered by available_days / capacity_hours.

Public API:
    working_days(start, end) -> int
    absence_days_in_range(person_id, start, end, session) -> float
    estimated_vacation_days(person_id, start, end, session) -> float
    available_days(person_id, start, end, country, state, session, client) -> float
    capacity_hours(person_id, project_id, start, end, session, client) -> float
"""

from datetime import date, timedelta

import httpx
from sqlmodel import Session, select

from app.models.enums import AbsenceStatus, AbsenceType
from app.models.membership import ProjectMembership
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.project import Project
from app.services.holiday import get_holidays_in_range


def working_days(start: date, end: date) -> int:
    """Count Mon–Fri days in [start, end] (inclusive). O(1) arithmetic."""
    if end < start:
        return 0
    total = (end - start).days + 1
    # Number of complete weeks
    full_weeks, remainder = divmod(total, 7)
    weekday_start = start.weekday()  # 0=Mon … 6=Sun
    # Count extra weekdays in the partial week
    extra = sum(1 for i in range(remainder) if (weekday_start + i) % 7 < 5)
    return full_weeks * 5 + extra


def _overlap_days(range_start: date, range_end: date, a_start: date, a_end: date) -> int:
    """Calendar-day overlap between two inclusive date ranges. Never negative."""
    overlap_start = max(range_start, a_start)
    overlap_end = min(range_end, a_end)
    if overlap_end < overlap_start:
        return 0
    return (overlap_end - overlap_start).days + 1


def absence_days_in_range(
    person_id: int,
    start: date,
    end: date,
    session: Session,
) -> float:
    """Sum of calendar absence days that overlap [start, end].

    Counts vacation (planned+confirmed), training (planned+confirmed),
    sick (ongoing+confirmed). Ongoing sick with null end_date uses today.
    """
    absences = session.exec(
        select(PersonAbsence).where(
            PersonAbsence.person_id == person_id,
            PersonAbsence.start_date <= end,
        )
    ).all()

    total = 0.0
    for absence in absences:
        effective_end = absence.end_date if absence.end_date is not None else date.today()
        if effective_end < start:
            continue
        total += _overlap_days(start, end, absence.start_date, effective_end)
    return total


def estimated_vacation_days(
    person_id: int,
    start: date,
    end: date,
    session: Session,
) -> float:
    """Estimate unplanned vacation for person in [start, end].

    For each calendar year that overlaps the period:
        remaining_contingent = total_days − Σ concrete vacation absences in year
        fraction = period_days_in_year_segment / remaining_days_in_year_from_period_start
        estimate += max(0, remaining_contingent) × fraction

    Days already covered by a concrete absence are excluded to avoid
    double-counting (absence_days_in_range handles those).
    """
    total_estimate = 0.0
    for year in range(start.year, end.year + 1):
        year_start = date(year, 1, 1)
        year_end = date(year, 12, 31)

        contingent_row = session.exec(
            select(VacationContingent).where(
                VacationContingent.person_id == person_id,
                VacationContingent.year == year,
            )
        ).first()
        if contingent_row is None:
            continue

        # Sum all concrete vacation absence days in this year
        concrete_absences = session.exec(
            select(PersonAbsence).where(
                PersonAbsence.person_id == person_id,
                PersonAbsence.absence_type == AbsenceType.vacation,
                PersonAbsence.start_date <= year_end,
            )
        ).all()
        used_days = 0.0
        for absence in concrete_absences:
            a_end = absence.end_date if absence.end_date is not None else date.today()
            if a_end < year_start:
                continue
            used_days += _overlap_days(year_start, year_end, absence.start_date, a_end)

        remaining_contingent = max(0.0, contingent_row.total_days - used_days)
        if remaining_contingent == 0.0:
            continue

        # Period segment within this year
        segment_start = max(start, year_start)
        segment_end = min(end, year_end)
        period_days_in_year = (segment_end - segment_start).days + 1

        # Remaining days in year from the start of the period segment
        remaining_days_in_year = (year_end - segment_start).days + 1
        if remaining_days_in_year <= 0:
            continue

        total_estimate += remaining_contingent * (period_days_in_year / remaining_days_in_year)

    return total_estimate


def available_days(
    person_id: int,
    start: date,
    end: date,
    country: str,
    state: str,
    session: Session,
    client: httpx.Client | None = None,
) -> float:
    """Compute available working days for person in [start, end].

    available = working_days − workday_holidays − absence_days − estimated_vacation
    """
    wdays = working_days(start, end)

    holidays = get_holidays_in_range(start, end, country, state, session, client)
    holiday_deduction = sum(1 for h in holidays if h.is_workday)

    absences = absence_days_in_range(person_id, start, end, session)
    estimate = estimated_vacation_days(person_id, start, end, session)

    return float(wdays) - holiday_deduction - absences - estimate


def _parse_work_week_pattern(pattern: str) -> list[float]:
    """Parse 'h1,h2,h3,h4,h5' → list of 5 floats (Mon–Fri daily hours)."""
    parts = [p.strip() for p in pattern.split(",")]
    if len(parts) != 5:
        raise ValueError(f"work_week_pattern must have exactly 5 values, got: {pattern!r}")
    return [float(p) for p in parts]


def _hours_per_day_from_pattern(pattern: list[float], weekday: int, weekly_capacity: float) -> float:
    """Scale pattern hours by the person's weekly_capacity_hours / sum(pattern)."""
    total = sum(pattern)
    if total <= 0 or weekday >= 5:
        return 0.0
    return pattern[weekday] * (weekly_capacity / total)


def capacity_hours(
    person_id: int,
    project_id: int,
    start: date,
    end: date,
    session: Session,
    client: httpx.Client | None = None,
) -> float:
    """Compute billable capacity hours for person on project in [start, end].

    Uses the active ProjectMembership for weekly_capacity_hours and the
    project's holiday_country/state for the availability calc.
    Returns 0.0 if no membership exists for this person+project.

    If the person has a work_week_pattern set, hours are computed by summing
    pattern-scaled hours per working day instead of uniform hours_per_day.
    """
    membership = session.exec(
        select(ProjectMembership).where(
            ProjectMembership.person_id == person_id,
            ProjectMembership.project_id == project_id,
        )
    ).first()
    if membership is None:
        return 0.0

    project = session.get(Project, project_id)
    country = project.holiday_country if project else "DE"
    state = project.holiday_state if project else "BY"

    person = session.get(Person, person_id)
    pattern: list[float] | None = None
    if person and person.work_week_pattern:
        try:
            pattern = _parse_work_week_pattern(person.work_week_pattern)
        except ValueError:
            pattern = None

    if pattern is None:
        avail = available_days(person_id, start, end, country, state, session, client)
        return max(0.0, avail * (membership.weekly_capacity_hours / 5.0))

    # Pattern-aware: sum hours for each working day not covered by holidays/absences.
    holidays = get_holidays_in_range(start, end, country, state, session, client)
    holiday_dates = {h.holiday_date for h in holidays if h.is_workday}
    absence_count = absence_days_in_range(person_id, start, end, session)
    vacation_estimate = estimated_vacation_days(person_id, start, end, session)
    # Compute available fraction: (working_days - absences - vacations) / working_days
    wdays = working_days(start, end)
    net_working_days = max(0.0, wdays - absence_count - vacation_estimate)
    if wdays == 0:
        return 0.0
    availability_fraction = net_working_days / wdays

    total = 0.0
    day = start
    while day <= end:
        wd = day.weekday()
        if wd < 5 and day not in holiday_dates:
            h = _hours_per_day_from_pattern(pattern, wd, membership.weekly_capacity_hours)
            total += h * availability_fraction
        day += timedelta(days=1)
    return max(0.0, total)
