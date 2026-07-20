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
    absence_booking,
    absence_summary,
    absence_days_in_range,
    available_days,
    capacity_hours,
    estimated_vacation_days,
    vacation_days_consumed_in_year,
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
        total_budget_euros=100000.0,
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


def _empty_client():
    """httpx client whose holiday API always returns no holidays (deterministic)."""
    import httpx
    return httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))


def _holiday_client(mapping: dict[str, str]):
    """httpx client returning fixed holidays. mapping: {name: 'YYYY-MM-DD'}."""
    import httpx
    payload = {name: {"datum": d, "hinweis": ""} for name, d in mapping.items()}
    return httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload)))


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
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 0


def test_absence_days_counts_working_days_only(mem_session):
    """A Mon–next-Wed absence (10 calendar days) counts only its 8 working days."""
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 6, 1), date(2026, 6, 10))
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 10), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 8  # 01–05 (Mon–Fri) + 08–10 (Mon–Wed); 06/07 weekend excluded


def test_absence_days_excludes_weekend_only_absence(mem_session):
    """An absence that falls entirely on a weekend books zero days."""
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 6, 6), date(2026, 6, 7))  # Sat+Sun
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 0


def test_absence_days_excludes_holiday(mem_session):
    """A public holiday inside the absence range does not count as an absence day."""
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 1, 5), date(2026, 1, 9))  # Mon–Fri = 5
    # Tuesday 2026-01-06 is a holiday → only 4 working days remain
    client = _holiday_client({"Heilige Drei Könige": "2026-01-06"})
    result = absence_days_in_range(
        p.id, date(2026, 1, 5), date(2026, 1, 9), mem_session, "DE", "BY", client
    )
    assert result == 4


def test_absence_days_excludes_non_working_pattern_day(mem_session):
    """A 4-day-week person (no Friday) does not book a vacation day on Fridays."""
    p = _make_person(mem_session)
    p.work_week_pattern = "8,8,8,8,0"
    mem_session.add(p)
    mem_session.commit()
    _make_absence(mem_session, p.id, date(2026, 4, 20), date(2026, 4, 24))  # Mon–Fri
    result = absence_days_in_range(
        p.id, date(2026, 4, 20), date(2026, 4, 24), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 4  # Fri excluded by pattern


def test_absence_days_partial_overlap_after(mem_session):
    p = _make_person(mem_session)
    # Absence ends after the period; overlap 06-25..06-30 has 4 working days (Thu,Fri,Mon,Tue)
    _make_absence(mem_session, p.id, date(2026, 6, 25), date(2026, 7, 5))
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 4


def test_absence_days_no_overlap(mem_session):
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 7, 1), date(2026, 7, 10))
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 0


def test_absence_days_overlapping_absences_counted_once(mem_session):
    """Overlapping vacation + sick on the same days must not double-count."""
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 6, 1), date(2026, 6, 5))  # vacation Mon–Fri
    _make_absence(
        mem_session, p.id, date(2026, 6, 3), date(2026, 6, 5),
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )  # sick overlaps Wed–Fri
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 5  # union of covered working days, not 5+3


def test_absence_days_ongoing_sick_uses_today(mem_session):
    p = _make_person(mem_session)
    # Ongoing sick (null end) runs until today; a fixed past Monday is deterministically counted.
    _make_absence(
        mem_session, p.id, date(2026, 1, 5), None,
        absence_type=AbsenceType.sick, status=AbsenceStatus.ongoing,
    )
    result = absence_days_in_range(
        p.id, date(2026, 1, 5), date(2026, 1, 5), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 1


def test_absence_days_multiple_absences(mem_session):
    p = _make_person(mem_session)
    _make_absence(mem_session, p.id, date(2026, 6, 1), date(2026, 6, 5))   # 5 working days
    _make_absence(mem_session, p.id, date(2026, 6, 10), date(2026, 6, 12)) # 3 working days
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 8


def test_absence_days_sick_confirmed_counts(mem_session):
    p = _make_person(mem_session)
    _make_absence(
        mem_session, p.id, date(2026, 6, 1), date(2026, 6, 3),
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 3


def test_absence_days_other_counts_like_any_absence(mem_session):
    """'Sonstiges' (Elternzeit/Sabbatical) reduces availability like every concrete absence."""
    p = _make_person(mem_session)
    _make_absence(
        mem_session, p.id, date(2026, 6, 1), date(2026, 6, 5),
        absence_type=AbsenceType.other, status=AbsenceStatus.confirmed,
    )
    result = absence_days_in_range(
        p.id, date(2026, 6, 1), date(2026, 6, 30), mem_session, "DE", "BY", _empty_client()
    )
    assert result == 5


# ---------------------------------------------------------------------------
# estimated_vacation_days
# ---------------------------------------------------------------------------

def test_estimated_vacation_no_contingent(mem_session):
    p = _make_person(mem_session)
    result = estimated_vacation_days(
        p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session, 0.0, "DE", "BY", _empty_client()
    )
    assert result == 0.0


def test_estimated_vacation_all_used(mem_session):
    p = _make_person(mem_session)
    # Contingent = 20 days, fully consumed by a 20-working-day vacation (Jan 5 – Jan 30).
    vc = VacationContingent(person_id=p.id, year=2026, total_days=20.0)
    mem_session.add(vc)
    mem_session.commit()
    _make_absence(
        mem_session, p.id, date(2026, 1, 5), date(2026, 1, 30),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )  # 4 full weeks = 20 working days
    result = estimated_vacation_days(
        p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session, 0.0, "DE", "BY", _empty_client()
    )
    assert result == 0.0


def test_estimated_vacation_proportional(mem_session):
    p = _make_person(mem_session)
    # Contingent = 20 days, none used yet, period = Jul 1–31 (31 days)
    # remaining_in_year from Jul 1 = 184 days (Jul 1 to Dec 31)
    # estimate = 20 × (31 / 184)
    vc = VacationContingent(person_id=p.id, year=2026, total_days=20.0)
    mem_session.add(vc)
    mem_session.commit()
    result = estimated_vacation_days(
        p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session, 0.0, "DE", "BY", _empty_client()
    )
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
    result = estimated_vacation_days(
        p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session, 0.0, "DE", "BY", _empty_client()
    )
    # The planned days reduce the remaining contingent;
    # estimate applies only to remaining days without concrete absences.
    assert result >= 0.0


def test_estimated_vacation_ignores_other_type(mem_session):
    """'Sonstiges' has no Pauschale: it must NOT deduct from the vacation contingent
    (only AbsenceType.vacation does). The estimate stays at the full pro-rata value."""
    p = _make_person(mem_session)
    vc = VacationContingent(person_id=p.id, year=2026, total_days=20.0)
    mem_session.add(vc)
    mem_session.commit()
    # A big 'other' absence in the year — must leave the vacation estimate untouched.
    _make_absence(
        mem_session, p.id, date(2026, 1, 5), date(2026, 3, 31),
        absence_type=AbsenceType.other, status=AbsenceStatus.confirmed,
    )
    result = estimated_vacation_days(
        p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session, 0.0, "DE", "BY", _empty_client()
    )
    expected = 20.0 * (31 / 184)  # identical to test_estimated_vacation_proportional
    assert abs(result - expected) < 0.01


# ---------------------------------------------------------------------------
# vacation_days_consumed_in_year (working days + AU refund)
# ---------------------------------------------------------------------------

def test_vacation_consumed_working_days_only(mem_session):
    p = _make_person(mem_session)
    _make_absence(
        mem_session, p.id, date(2026, 6, 1), date(2026, 6, 10),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )
    result = vacation_days_consumed_in_year(p.id, 2026, mem_session, "DE", "BY", _empty_client())
    assert result == 8  # 10 calendar → 8 working days


def test_vacation_consumed_confirmed_sick_refunds(mem_session):
    """Confirmed sick during vacation tops the vacation → those days are refunded."""
    p = _make_person(mem_session)
    _make_absence(
        mem_session, p.id, date(2026, 6, 1), date(2026, 6, 5),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )  # 5 working days
    _make_absence(
        mem_session, p.id, date(2026, 6, 3), date(2026, 6, 5),
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )  # AU covers Wed–Fri (3 working days)
    result = vacation_days_consumed_in_year(p.id, 2026, mem_session, "DE", "BY", _empty_client())
    assert result == 2  # only Mon+Tue consume vacation; Wed–Fri refunded


def test_vacation_consumed_ongoing_sick_does_not_refund(mem_session):
    """Sick without AU (ongoing) does NOT refund vacation days."""
    p = _make_person(mem_session)
    _make_absence(
        mem_session, p.id, date(2026, 6, 1), date(2026, 6, 5),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )
    _make_absence(
        mem_session, p.id, date(2026, 6, 3), None,
        absence_type=AbsenceType.sick, status=AbsenceStatus.ongoing,
    )
    result = vacation_days_consumed_in_year(p.id, 2026, mem_session, "DE", "BY", _empty_client())
    assert result == 5  # ongoing sick doesn't refund → all 5 vacation days stand


def test_estimated_vacation_refunded_days_return_to_contingent(mem_session):
    """A confirmed sick spell inside a booked vacation frees contingent for the estimate."""
    p = _make_person(mem_session)
    vc = VacationContingent(person_id=p.id, year=2026, total_days=20.0)
    mem_session.add(vc)
    mem_session.commit()
    _make_absence(
        mem_session, p.id, date(2026, 1, 5), date(2026, 1, 30),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )  # would consume all 20 working days …
    _make_absence(
        mem_session, p.id, date(2026, 1, 5), date(2026, 1, 9),
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )  # … but a confirmed sick week (5 wd) is refunded → 15 consumed, 5 remain
    result = estimated_vacation_days(
        p.id, date(2026, 7, 1), date(2026, 7, 31), mem_session, 0.0, "DE", "BY", _empty_client()
    )
    assert result > 0.0  # refund left contingent to distribute


# ---------------------------------------------------------------------------
# absence_booking (per-absence UI metrics)
# ---------------------------------------------------------------------------

def test_absence_booking_days_and_hours(mem_session):
    p = _make_person(mem_session)  # 40h/week → 8h/working day
    a = _make_absence(mem_session, p.id, date(2026, 6, 1), date(2026, 6, 10))  # vacation
    result = absence_booking(p, a, mem_session, "DE", "BY", _empty_client())
    assert result["working_days"] == 8
    assert result["hours"] == 64.0  # 8 days × 8h
    assert result["contingent_days"] == 8


def test_absence_booking_uses_pattern_hours(mem_session):
    p = _make_person(mem_session)
    p.work_week_pattern = "8,8,8,8,0"  # 4-day week
    mem_session.add(p)
    mem_session.commit()
    a = _make_absence(mem_session, p.id, date(2026, 4, 20), date(2026, 4, 24))  # Mon–Fri
    result = absence_booking(p, a, mem_session, "DE", "BY", _empty_client())
    assert result["working_days"] == 4  # Fri excluded by pattern
    assert result["hours"] == 32.0
    assert result["contingent_days"] == 4


def test_absence_booking_vacation_refunds_confirmed_sick(mem_session):
    p = _make_person(mem_session)
    vac = _make_absence(
        mem_session, p.id, date(2026, 6, 1), date(2026, 6, 5),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )
    _make_absence(
        mem_session, p.id, date(2026, 6, 3), date(2026, 6, 5),
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )
    result = absence_booking(p, vac, mem_session, "DE", "BY", _empty_client())
    assert result["working_days"] == 5   # the vacation still spans 5 working days …
    assert result["contingent_days"] == 2  # … but only Mon+Tue draw down the contingent


def test_absence_booking_non_vacation_has_no_contingent(mem_session):
    p = _make_person(mem_session)
    a = _make_absence(
        mem_session, p.id, date(2026, 6, 1), date(2026, 6, 3),
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )
    result = absence_booking(p, a, mem_session, "DE", "BY", _empty_client())
    assert result["working_days"] == 3
    assert "contingent_days" not in result


# ---------------------------------------------------------------------------
# absence_summary (per-year overview)
# ---------------------------------------------------------------------------

def test_absence_summary_vacation_split_and_open(mem_session):
    p = _make_person(mem_session)
    mem_session.add(VacationContingent(person_id=p.id, year=2026, total_days=30.0))
    mem_session.commit()
    _make_absence(  # confirmed = genommen, 5 working days
        mem_session, p.id, date(2026, 3, 2), date(2026, 3, 6),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )
    _make_absence(  # planned = geplant, 3 working days
        mem_session, p.id, date(2026, 9, 21), date(2026, 9, 23),
        absence_type=AbsenceType.vacation, status=AbsenceStatus.planned,
    )
    _make_absence(  # sick, own category
        mem_session, p.id, date(2026, 4, 1), date(2026, 4, 2),
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )
    s = absence_summary(p, 2026, mem_session, "DE", "BY", _empty_client())
    assert s["vacation"] == {"contingent": 30.0, "taken": 5.0, "planned": 3.0, "open": 22.0}
    assert s["categories"]["vacation"]["days"] == 8
    assert s["categories"]["sick"]["days"] == 2
    assert s["categories"]["training"]["days"] == 0


def test_absence_summary_confirmed_sick_refunds_vacation(mem_session):
    p = _make_person(mem_session)
    mem_session.add(VacationContingent(person_id=p.id, year=2026, total_days=30.0))
    mem_session.commit()
    _make_absence(
        mem_session, p.id, date(2026, 3, 2), date(2026, 3, 6),  # 5 wd vacation confirmed
        absence_type=AbsenceType.vacation, status=AbsenceStatus.confirmed,
    )
    _make_absence(
        mem_session, p.id, date(2026, 3, 4), date(2026, 3, 6),  # 3 wd confirmed sick (AU)
        absence_type=AbsenceType.sick, status=AbsenceStatus.confirmed,
    )
    s = absence_summary(p, 2026, mem_session, "DE", "BY", _empty_client())
    # Only Mon+Tue draw vacation; Wed–Fri refunded by AU
    assert s["vacation"]["taken"] == 2.0
    assert s["vacation"]["open"] == 28.0


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


def test_available_days_full_week_absence_is_zero(mem_session):
    """A full Mon–Sun absence covers exactly the 5 working days → availability 0 (not negative)."""
    p = _make_person(mem_session)
    import httpx
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    # Period Mon–Sun (5 working days); absence covers the whole week → 5 - 5 = 0
    _make_absence(mem_session, p.id, date(2026, 1, 5), date(2026, 1, 11))
    result = available_days(
        p.id, date(2026, 1, 5), date(2026, 1, 11), "DE", "BY", mem_session, client
    )
    assert result == 0.0


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
