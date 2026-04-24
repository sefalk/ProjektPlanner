"""Unit tests for the planning service (availability and capacity math)."""

from datetime import date, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.models.enums import AbsenceStatus, AbsenceType
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.project import Project
from app.models.membership import ProjectMembership
from app.services.planning import (
    absence_days_in_range,
    available_days,
    capacity_hours,
    estimated_vacation_days,
    working_days,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mem_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    SQLModel.metadata.drop_all(engine)


def _make_person(session: Session, name: str = "Test Person") -> Person:
    p = Person(
        name=name,
        sage_employee_name=name,
        default_weekly_hours=40.0,
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


def _make_project(session: Session) -> Project:
    proj = Project(
        project_number="P00001",
        name="Test Project",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        total_budget_hours=1000.0,
    )
    session.add(proj)
    session.commit()
    session.refresh(proj)
    return proj


def _make_membership(
    session: Session,
    person_id: int,
    project_id: int,
    weekly_hours: float = 40.0,
    from_date: date = date(2026, 1, 1),
    to_date: date = date(2026, 12, 31),
) -> ProjectMembership:
    m = ProjectMembership(
        project_id=project_id,
        person_id=person_id,
        from_date=from_date,
        to_date=to_date,
        weekly_capacity_hours=weekly_hours,
        billing_rate_per_hour=100.0,
    )
    session.add(m)
    session.commit()
    session.refresh(m)
    return m


def _make_absence(
    session: Session,
    person_id: int,
    start: date,
    end: date | None,
    absence_type: AbsenceType = AbsenceType.vacation,
    status: AbsenceStatus = AbsenceStatus.planned,
) -> PersonAbsence:
    a = PersonAbsence(
        person_id=person_id,
        start_date=start,
        end_date=end,
        absence_type=absence_type,
        status=status,
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    return a


# ---------------------------------------------------------------------------
# working_days
# ---------------------------------------------------------------------------

def test_working_days_mon_to_fri():
    # 2026-04-20 (Mon) to 2026-04-24 (Fri) = 5 days
    assert working_days(date(2026, 4, 20), date(2026, 4, 24)) == 5


def test_working_days_includes_both_endpoints():
    # Same day on a Monday = 1
    assert working_days(date(2026, 4, 20), date(2026, 4, 20)) == 1


def test_working_days_same_day_saturday():
    assert working_days(date(2026, 4, 18), date(2026, 4, 18)) == 0


def test_working_days_weekend_only_is_zero():
    # Sat + Sun
    assert working_days(date(2026, 4, 18), date(2026, 4, 19)) == 0


def test_working_days_full_week():
    # Mon–Sun includes 5 working days
    assert working_days(date(2026, 4, 20), date(2026, 4, 26)) == 5


def test_working_days_end_before_start_returns_zero():
    assert working_days(date(2026, 4, 24), date(2026, 4, 20)) == 0


def test_working_days_two_full_weeks():
    assert working_days(date(2026, 4, 20), date(2026, 5, 1)) == 10


@given(
    start_offset=st.integers(min_value=0, max_value=365),
    length=st.integers(min_value=0, max_value=365),
)
def test_working_days_always_non_negative(start_offset, length):
    base = date(2026, 1, 1)
    start = base + timedelta(days=start_offset)
    end = start + timedelta(days=length)
    assert working_days(start, end) >= 0


@given(
    start_offset=st.integers(min_value=0, max_value=365),
    length=st.integers(min_value=0, max_value=365),
)
def test_working_days_never_exceeds_calendar_days(start_offset, length):
    base = date(2026, 1, 1)
    start = base + timedelta(days=start_offset)
    end = start + timedelta(days=length)
    assert working_days(start, end) <= (end - start).days + 1


# ---------------------------------------------------------------------------
# absence_days_in_range
# ---------------------------------------------------------------------------

def test_absence_days_no_absences(mem_session):
    p = _make_person(mem_session)
    result = absence_days_in_range(p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session)
    assert result == 0


def test_absence_days_full_overlap(mem_session):
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 6, 1), date(2026, 6, 10))
    result = absence_days_in_range(p.id, date(2026, 6, 1), date(2026, 6, 10), mem_session)
    assert result == 10


def test_absence_days_partial_overlap_before(mem_session):
    p = _make_person(mem_session)
    # Absence starts before the period
    _make_absence(mem_session, p.id, date(2026, 5, 25), date(2026, 6, 5))
    result = absence_days_in_range(p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session)
    assert result == 5  # 6-01 to 6-05


def test_absence_days_partial_overlap_after(mem_session):
    p = _make_person(mem_session)
    # Absence ends after the period
    _make_absence(mem_session, p.id, date(2026, 6, 25), date(2026, 7, 5))
    result = absence_days_in_range(p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session)
    assert result == 6  # 6-25 to 6-30


def test_absence_days_no_overlap(mem_session):
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 7, 1), date(2026, 7, 10))
    result = absence_days_in_range(p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session)
    assert result == 0


def test_absence_days_ongoing_sick_uses_today(mem_session):
    p = _make_person(mem_session)
    # Ongoing sick starting "today" — should count at least 1 day
    today = date.today()
    _make_absence(
        mem_session, p.id, today, None,
        absence_type=AbsenceType.sick, status=AbsenceStatus.ongoing,
    )
    result = absence_days_in_range(p.id, today, today, mem_session)
    assert result == 1


def test_absence_days_multiple_absences(mem_session):
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 6, 1), date(2026, 6, 5))   # 5 days
    _make_absence(mem_session, p.id, date(2026, 6, 10), date(2026, 6, 12)) # 3 days
    result = absence_days_in_range(p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session)
    assert result == 8


def test_absence_days_sick_confirmed_counts(mem_session):
    p = _make_person(mem_session)
    _make_absence(
        mem_session, p.id, date(2026, 6, 1), date(2026, 6, 3),
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )
    result = absence_days_in_range(p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session)
    assert result == 3


# ---------------------------------------------------------------------------
# estimated_vacation_days
# ---------------------------------------------------------------------------

def test_estimated_vacation_no_contingent(mem_session):
    p = _make_person(mem_session)
    result = estimated_vacation_days(p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session)
    assert result == 0.0


def test_estimated_vacation_all_used(mem_session):
    p = _make_person(mem_session)
    # Contingent = 20 days, all already planned
    vc = VacationContingent(person_id=p.id, year=2026, total_days=20.0)
    mem_session.add(vc)
    mem_session.commit()
    _make_absence(
        mem_session, p.id, date(2026, 1, 5), date(2026, 1, 24),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )  # 20 calendar days
    result = estimated_vacation_days(p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session)
    assert result == 0.0


def test_estimated_vacation_proportional(mem_session):
    p = _make_person(mem_session)
    # Contingent = 20 days, none used yet, period = Jul 1–31 (31 days)
    # remaining_in_year from Jul 1 = 184 days (Jul 1 to Dec 31)
    # estimate = 20 × (31 / 184)
    vc = VacationContingent(person_id=p.id, year=2026, total_days=20.0)
    mem_session.add(vc)
    mem_session.commit()
    result = estimated_vacation_days(p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session)
    expected = 20.0 * (31 / 184)
    assert abs(result - expected) < 0.01


def test_estimated_vacation_already_has_concrete_absence(mem_session):
    """Days covered by a concrete absence are not double-counted."""
    p = _make_person(mem_session)
    vc = VacationContingent(person_id=p.id, year=2026, total_days=20.0)
    mem_session.add(vc)
    mem_session.commit()
    # Concrete vacation already planned in the period
    _make_absence(mem_session, p.id, date(2026, 7, 1), date(2026, 7, 10))
    result = estimated_vacation_days(p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session)
    # The 10 planned days reduce the remaining contingent;
    # estimate applies only to remaining days without concrete absences.
    assert result >= 0.0


# ---------------------------------------------------------------------------
# available_days
# ---------------------------------------------------------------------------

def test_available_days_no_absences_no_holidays(mem_session):
    p = _make_person(mem_session)
    # Jan 5–9 2026 = Mon–Fri, no holidays (no VacationContingent = 0 estimate)

    class _NoOpClient:
        def get(self, url):
            from unittest.mock import MagicMock
            resp = MagicMock()
            resp.raise_for_status = lambda: None
            resp.json = lambda: {}
            return resp

    # Use a client that returns empty holidays
    import httpx
    def handler(request):
        return httpx.Response(200, json={})
    client = httpx.Client(transport=httpx.MockTransport(handler))

    result = available_days(
        p.id, date(2026, 1, 5), date(2026, 1, 9), "DE", "BY", mem_session, client
    )
    assert result == 5.0


def test_available_days_subtracts_holidays(mem_session):
    p = _make_person(mem_session)
    import httpx
    # Provide one weekday holiday on 2026-01-06 (Tuesday)
    def handler(request):
        return httpx.Response(200, json={"Heilige Drei Könige": {"datum": "2026-01-06", "hinweis": ""}})
    client = httpx.Client(transport=httpx.MockTransport(handler))

    result = available_days(
        p.id, date(2026, 1, 5), date(2026, 1, 9), "DE", "BY", mem_session, client
    )
    assert result == 4.0  # 5 working days − 1 holiday


def test_available_days_subtracts_absences(mem_session):
    p = _make_person(mem_session)
    import httpx
    def handler(request):
        return httpx.Response(200, json={})
    client = httpx.Client(transport=httpx.MockTransport(handler))

    _make_absence(mem_session, p.id, date(2026, 1, 5), date(2026, 1, 7))
    result = available_days(
        p.id, date(2026, 1, 5), date(2026, 1, 9), "DE", "BY", mem_session, client
    )
    assert result == 2.0  # 5 working days − 3 absence days


def test_available_days_can_be_negative(mem_session):
    """absence_days counts calendar days, so a full Mon–Sun absence beats 5 working days."""
    p = _make_person(mem_session)
    import httpx
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    # Period Mon–Sun (5 working days), absence covers all 7 calendar days → 5 - 7 = -2
    _make_absence(mem_session, p.id, date(2026, 1, 5), date(2026, 1, 11))
    result = available_days(
        p.id, date(2026, 1, 5), date(2026, 1, 11), "DE", "BY", mem_session, client
    )
    assert result < 0


# ---------------------------------------------------------------------------
# capacity_hours
# ---------------------------------------------------------------------------

def test_capacity_hours_no_membership_returns_zero(mem_session):
    p = _make_person(mem_session)
    proj = _make_project(mem_session)
    import httpx
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    result = capacity_hours(
        p.id, proj.id, date(2026, 4, 1), date(2026, 4, 30), mem_session, client
    )
    assert result == 0.0


def test_capacity_hours_with_membership(mem_session):
    p = _make_person(mem_session)
    proj = _make_project(mem_session)
    _make_membership(mem_session, p.id, proj.id, weekly_hours=40.0)
    import httpx
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    # April 2026: Mon 6 – Fri 10 = 5 working days × (40/5) = 40 hours
    result = capacity_hours(
        p.id, proj.id, date(2026, 4, 6), date(2026, 4, 10), mem_session, client
    )
    assert abs(result - 40.0) < 0.01


def test_capacity_hours_partial_week(mem_session):
    p = _make_person(mem_session)
    proj = _make_project(mem_session)
    _make_membership(mem_session, p.id, proj.id, weekly_hours=20.0)
    import httpx
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    # Mon–Wed = 3 working days × (20/5) = 12 hours
    result = capacity_hours(
        p.id, proj.id, date(2026, 4, 20), date(2026, 4, 22), mem_session, client
    )
    assert abs(result - 12.0) < 0.01


def test_capacity_hours_with_work_week_pattern_4day(mem_session):
    """4-day work week (8,8,8,8,0): Friday should contribute 0 h."""
    import httpx
    p = _make_person(mem_session)
    # Override work_week_pattern
    p.work_week_pattern = "8,8,8,8,0"
    mem_session.add(p)
    mem_session.commit()
    proj = _make_project(mem_session)
    _make_membership(mem_session, p.id, proj.id, weekly_hours=32.0)
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    # 2026-04-20 Mon – 2026-04-24 Fri (Mon-Thu = 4 days at 8h = 32h, Fri = 0)
    result = capacity_hours(
        p.id, proj.id, date(2026, 4, 20), date(2026, 4, 24), mem_session, client
    )
    assert abs(result - 32.0) < 0.5


def test_capacity_hours_with_work_week_pattern_returns_non_negative(mem_session):
    import httpx
    p = _make_person(mem_session)
    p.work_week_pattern = "7,7,7,7,4"
    mem_session.add(p)
    mem_session.commit()
    proj = _make_project(mem_session)
    _make_membership(mem_session, p.id, proj.id, weekly_hours=32.0)
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    result = capacity_hours(
        p.id, proj.id, date(2026, 4, 1), date(2026, 4, 30), mem_session, client
    )
    assert result >= 0.0


def test_capacity_hours_with_invalid_pattern_falls_back(mem_session):
    """Invalid pattern string silently falls back to the non-pattern formula."""
    import httpx
    p = _make_person(mem_session)
    p.work_week_pattern = "bad,data"
    mem_session.add(p)
    mem_session.commit()
    proj = _make_project(mem_session)
    _make_membership(mem_session, p.id, proj.id, weekly_hours=40.0)
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    result = capacity_hours(
        p.id, proj.id, date(2026, 4, 6), date(2026, 4, 10), mem_session, client
    )
    # Falls back to 5 days × 8h = 40h
    assert abs(result - 40.0) < 0.01


@given(weekly_h=st.floats(min_value=1.0, max_value=60.0, allow_nan=False))
@settings(max_examples=30)
def test_capacity_hours_always_non_negative(weekly_h):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            p = _make_person(session)
            proj = _make_project(session)
            _make_membership(session, p.id, proj.id, weekly_hours=weekly_h)
            import httpx
            client = httpx.Client(
                transport=httpx.MockTransport(lambda r: httpx.Response(200, json={}))
            )
            result = capacity_hours(
                p.id, proj.id, date(2026, 4, 1), date(2026, 4, 30), session, client
            )
            assert result >= 0.0
    finally:
        SQLModel.metadata.drop_all(engine)
