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

from app.models.enums import AbsenceDaySegment, AbsenceStatus, AbsenceType
from app.models.membership import ProjectMembership
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.project import Project
from app.services.holiday import HolidayFetchError, get_holidays_in_range
from app.services.holiday_region import resolve_holiday_region


def working_days(start: date, end: date) -> int:
    """Count Mon–Fri days in [start, end] (inclusive). O(1) arithmetic.

    Calendar-only helper (ignores holidays and work-week patterns). For an
    absence-/capacity-relevant count use ``effective_working_dates``.
    """
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


def parse_work_week_pattern_or_none(person: Person | None) -> list[float] | None:
    """The person's Mon–Fri daily-hours pattern, or None if unset/invalid."""
    if person is None or not person.work_week_pattern:
        return None
    try:
        return _parse_work_week_pattern(person.work_week_pattern)
    except ValueError:
        return None


def effective_working_dates(
    start: date,
    end: date,
    session: Session,
    country: str,
    state: str,
    pattern: list[float] | None = None,
    client: httpx.Client | None = None,
) -> list[date]:
    """Dates in [start, end] the person would normally work.

    A day qualifies when it is Mon–Fri, is not a public holiday that falls on a
    workday in (country, state), and — if a work-week ``pattern`` is given — has
    pattern hours > 0. This is the single definition of "a working day" used by
    absence counting, availability and capacity so they can never drift apart.
    """
    if end < start:
        return []
    try:
        holidays = get_holidays_in_range(start, end, country, state, session, client)
        holiday_dates = {h.holiday_date for h in holidays if h.is_workday}
    except HolidayFetchError:
        # Graceful degradation: if the holiday source is unavailable, don't drop
        # working days (better to over-count availability than to crash the calc).
        holiday_dates = set()
    out: list[date] = []
    d = start
    while d <= end:
        wd = d.weekday()
        if wd < 5 and d not in holiday_dates and (pattern is None or pattern[wd] > 0):
            out.append(d)
        d += timedelta(days=1)
    return out


def _overlapping_absences(
    person_id: int, start: date, end: date, session: Session
) -> list[PersonAbsence]:
    """All of the person's absences whose date range overlaps [start, end].

    An ongoing sick record (null end_date) is treated as running until today.
    """
    rows = session.exec(
        select(PersonAbsence).where(
            PersonAbsence.person_id == person_id,
            PersonAbsence.start_date <= end,
        )
    ).all()
    result: list[PersonAbsence] = []
    for a in rows:
        a_end = a.end_date if a.end_date is not None else date.today()
        if a_end >= start:
            result.append(a)
    return result


def _covers(absence: PersonAbsence, day: date) -> bool:
    a_end = absence.end_date if absence.end_date is not None else date.today()
    return absence.start_date <= day <= a_end


def _day_fraction(absence: PersonAbsence, day: date) -> float:
    """Fraction of ``day`` the absence covers: 0.0 (not covered), 0.5 (half) or 1.0.

    The start day uses start_segment, the end day uses end_segment; a single-day
    absence (start == end) uses start_segment. Middle days are always full.
    A morning/afternoon segment is half a day; full is a whole day.
    """
    a_end = absence.end_date if absence.end_date is not None else date.today()
    if not (absence.start_date <= day <= a_end):
        return 0.0
    if day == absence.start_date:  # also the single-day case (start == end)
        seg = absence.start_segment
    elif day == a_end:
        seg = absence.end_segment
    else:
        return 1.0
    return 0.5 if seg in (AbsenceDaySegment.morning, AbsenceDaySegment.afternoon) else 1.0


def _is_confirmed_sick(a: PersonAbsence) -> bool:
    """A sick record with a medical certificate on file (AU vorliegt)."""
    return a.absence_type == AbsenceType.sick and a.status == AbsenceStatus.confirmed


def _resolve_region(
    person_id: int, session: Session, country: str | None, state: str | None
) -> tuple[str, str, Person | None]:
    person = session.get(Person, person_id)
    if country is None:
        country, state = resolve_holiday_region(session, person)
    return country, state or "", person


def absence_days_in_range(
    person_id: int,
    start: date,
    end: date,
    session: Session,
    country: str | None = None,
    state: str | None = None,
    client: httpx.Client | None = None,
) -> float:
    """Number of the person's *working days* in [start, end] covered by any absence.

    Only Mon–Fri days that are neither a public holiday (in the effective region)
    nor a non-working day of the person's work-week pattern count. A day covered by
    several overlapping absences counts exactly once (no double counting). When
    ``country``/``state`` are omitted the person's effective region is resolved.
    """
    country, state, person = _resolve_region(person_id, session, country, state)
    pattern = parse_work_week_pattern_or_none(person)
    workdates = effective_working_dates(start, end, session, country, state, pattern, client)
    if not workdates:
        return 0.0
    absences = _overlapping_absences(person_id, start, end, session)
    if not absences:
        return 0.0
    # Per working day, the absent portion = the largest coverage among overlapping
    # absences (0.5 for a half day, 1.0 for a full day); summed over the range.
    return sum(max((_day_fraction(a, d) for a in absences), default=0.0) for d in workdates)


def vacation_days_consumed_in_year(
    person_id: int,
    year: int,
    session: Session,
    country: str | None = None,
    state: str | None = None,
    client: httpx.Client | None = None,
) -> float:
    """Vacation working days consumed in ``year`` after the AU refund.

    A working day covered by a vacation absence is counted, unless the same day is
    also covered by a *confirmed* sick absence (AU liegt vor) — then the day counts
    as sick and the vacation day is refunded (§ "Krankheit während Urlaub")."""
    country, state, person = _resolve_region(person_id, session, country, state)
    pattern = parse_work_week_pattern_or_none(person)
    year_start, year_end = date(year, 1, 1), date(year, 12, 31)
    workdates = effective_working_dates(year_start, year_end, session, country, state, pattern, client)
    if not workdates:
        return 0.0
    absences = _overlapping_absences(person_id, year_start, year_end, session)
    vac = [a for a in absences if a.absence_type == AbsenceType.vacation]
    sick_confirmed = [a for a in absences if _is_confirmed_sick(a)]
    if not vac:
        return 0.0
    consumed = 0.0
    for d in workdates:
        if any(_covers(a, d) for a in sick_confirmed):
            continue  # topped by AU → refunded
        consumed += max((_day_fraction(a, d) for a in vac), default=0.0)
    return consumed


def _person_daily_hours(person: Person | None, weekday: int, pattern: list[float] | None) -> float:
    """Absolute hours the person works on a given weekday (Mon=0 … Fri=4)."""
    if weekday >= 5:
        return 0.0
    if pattern is not None:
        return pattern[weekday]
    if person is None:
        return 0.0
    return person.default_weekly_hours / 5.0


def absence_booking(
    person: Person,
    absence: PersonAbsence,
    session: Session,
    country: str | None = None,
    state: str | None = None,
    client: httpx.Client | None = None,
) -> dict:
    """What a single absence books for the person.

    Returns ``working_days`` (Mon–Fri ∩ no holiday ∩ pattern>0 within the absence
    range) and ``hours`` (person's daily hours summed over those days). For a
    vacation absence it also returns ``contingent_days`` = working days that
    actually draw down the vacation contingent, i.e. after refunding days topped
    by a confirmed sick absence (AU). Region defaults to the person's own.
    """
    if country is None:
        country, state = resolve_holiday_region(session, person)
    pattern = parse_work_week_pattern_or_none(person)
    a_end = absence.end_date if absence.end_date is not None else date.today()
    if a_end < absence.start_date:
        return {"working_days": 0, "hours": 0.0}
    workdates = effective_working_dates(
        absence.start_date, a_end, session, country, state or "", pattern, client
    )
    days = round(sum(_day_fraction(absence, d) for d in workdates), 3)
    hours = sum(_day_fraction(absence, d) * _person_daily_hours(person, d.weekday(), pattern) for d in workdates)
    result: dict = {"working_days": days, "hours": round(hours, 2)}
    if absence.absence_type == AbsenceType.vacation:
        sick_confirmed = [
            a for a in _overlapping_absences(person.id, absence.start_date, a_end, session)
            if _is_confirmed_sick(a)
        ]
        result["contingent_days"] = round(sum(
            _day_fraction(absence, d) for d in workdates if not any(_covers(s, d) for s in sick_confirmed)
        ), 3)
    return result


def absence_summary(
    person: Person,
    year: int,
    session: Session,
    country: str | None = None,
    state: str | None = None,
    client: httpx.Client | None = None,
) -> dict:
    """Per-year absence overview for one person.

    Returns, for the given ``year``:
    - ``categories``: for each AbsenceType a ``{days, hours}`` sum of booked working
      days (deduped within the type) and the person's hours over them.
    - ``vacation``: ``{contingent, taken, planned, open}`` in working days. Taken =
      confirmed vacation, planned = planned vacation; both after the confirmed-sick
      (AU) refund. Open = max(0, contingent − taken − planned).

    All counts respect weekends, holidays (effective region) and the work-week pattern.
    """
    if country is None:
        country, state = resolve_holiday_region(session, person)
    pattern = parse_work_week_pattern_or_none(person)
    year_start, year_end = date(year, 1, 1), date(year, 12, 31)
    workdates = effective_working_dates(year_start, year_end, session, country, state or "", pattern, client)
    absences = _overlapping_absences(person.id, year_start, year_end, session)

    categories: dict[str, dict] = {}
    for t in AbsenceType:
        of_type = [a for a in absences if a.absence_type == t]
        days = 0.0
        hours = 0.0
        for d in workdates:
            frac = max((_day_fraction(a, d) for a in of_type), default=0.0)
            if frac:
                days += frac
                hours += frac * _person_daily_hours(person, d.weekday(), pattern)
        categories[t.value] = {"days": round(days, 3), "hours": round(hours, 2)}

    # Vacation split by status, with the confirmed-sick (AU) refund applied.
    sick_confirmed = [a for a in absences if _is_confirmed_sick(a)]
    vac_confirmed = [a for a in absences if a.absence_type == AbsenceType.vacation and a.status == AbsenceStatus.confirmed]
    vac_planned = [a for a in absences if a.absence_type == AbsenceType.vacation and a.status == AbsenceStatus.planned]
    taken = planned = 0.0
    for d in workdates:
        if any(_covers(s, d) for s in sick_confirmed):
            continue  # topped by AU → refunded, consumes no vacation
        tf = max((_day_fraction(a, d) for a in vac_confirmed), default=0.0)
        pf = max((_day_fraction(a, d) for a in vac_planned), default=0.0)
        if tf > 0:
            taken += tf
        elif pf > 0:
            planned += pf

    contingent_row = session.exec(
        select(VacationContingent).where(
            VacationContingent.person_id == person.id,
            VacationContingent.year == year,
        )
    ).first()
    contingent = contingent_row.total_days if contingent_row else 0.0
    open_days = max(0.0, contingent - taken - planned)

    return {
        "year": year,
        "categories": categories,
        "vacation": {
            "contingent": contingent,
            "taken": round(taken, 3),
            "planned": round(planned, 3),
            "open": round(open_days, 3),
        },
    }


def estimated_vacation_days(
    person_id: int,
    start: date,
    end: date,
    session: Session,
    taken_days_flat: float = 0.0,
    country: str | None = None,
    state: str | None = None,
    client: httpx.Client | None = None,
) -> float:
    """Estimate unplanned vacation for person in [start, end].

    For each calendar year that overlaps the period:
        remaining_contingent = total_days − vacation working days consumed in year − taken_days_flat
        fraction = period_days_in_year_segment / remaining_days_in_year_from_period_start
        estimate += max(0, remaining_contingent) × fraction

    Consumed vacation is counted in *working days* after the AU refund
    (vacation_days_consumed_in_year), so weekends, holidays, non-working pattern
    days and days topped by confirmed sick leave never reduce the contingent.
    taken_days_flat is a project-specific flat number of already-taken vacation
    days (no dates) that further reduces the remaining contingent.
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

        used_days = vacation_days_consumed_in_year(
            person_id, year, session, country, state, client
        )

        remaining_contingent = max(0.0, contingent_row.total_days - used_days - taken_days_flat)
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

    available = effective_working_days − absence_days − estimated_vacation

    Holidays and non-working pattern days are already excluded from the base
    (effective_working_dates), so they are not subtracted again here.
    """
    person = session.get(Person, person_id)
    pattern = parse_work_week_pattern_or_none(person)
    base = len(effective_working_dates(start, end, session, country, state, pattern, client))

    absences = absence_days_in_range(person_id, start, end, session, country, state, client)
    estimate = estimated_vacation_days(person_id, start, end, session, 0.0, country, state, client)

    return float(base) - absences - estimate


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
    pattern = parse_work_week_pattern_or_none(person)

    if pattern is None:
        avail = available_days(person_id, start, end, country, state, session, client)
        return max(0.0, avail * (membership.weekly_capacity_hours / 5.0))

    # Pattern-aware: sum pattern hours over the person's effective working days,
    # scaled by the availability fraction. Base, absences and holidays all use the
    # same effective-working-day definition so nothing is deducted twice.
    workdates = effective_working_dates(start, end, session, country, state, pattern, client)
    base = len(workdates)
    if base == 0:
        return 0.0
    absence_count = absence_days_in_range(person_id, start, end, session, country, state, client)
    vacation_estimate = estimated_vacation_days(
        person_id, start, end, session, 0.0, country, state, client
    )
    net_working_days = max(0.0, base - absence_count - vacation_estimate)
    availability_fraction = net_working_days / base

    total = 0.0
    for day in workdates:
        h = _hours_per_day_from_pattern(pattern, day.weekday(), membership.weekly_capacity_hours)
        total += h * availability_fraction
    return max(0.0, total)
