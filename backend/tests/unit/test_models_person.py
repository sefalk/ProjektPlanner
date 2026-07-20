"""
Tests for Person, VacationContingent, and PersonAbsence models.

PersonAbsence has the most complex validation: the status field is
constrained by absence_type. These rules are tested exhaustively here,
including property-based tests for date ordering.
"""

from datetime import date, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from app.models.enums import AbsenceStatus, AbsenceType
from app.models.person import Person, PersonAbsence, VacationContingent

# ---------------------------------------------------------------------------
# Person
# ---------------------------------------------------------------------------

def test_person_valid_minimal() -> None:
    p = Person(name="Max Mustermann", sage_employee_name="Mustermann, Max", default_weekly_hours=40)
    assert p.name == "Max Mustermann"


def test_person_requires_name() -> None:
    with pytest.raises(ValidationError):
        Person(sage_employee_name="X, Y", default_weekly_hours=40)  # type: ignore[call-arg]


def test_person_weekly_hours_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        Person(name="X", sage_employee_name="X, Y", default_weekly_hours=0)


def test_person_weekly_hours_max_60() -> None:
    with pytest.raises(ValidationError):
        Person(name="X", sage_employee_name="X, Y", default_weekly_hours=61)


# ---------------------------------------------------------------------------
# VacationContingent
# ---------------------------------------------------------------------------

def test_vacation_contingent_valid() -> None:
    vc = VacationContingent(person_id=1, year=2026, total_days=30)
    assert vc.total_days == 30


def test_vacation_contingent_rejects_negative_days() -> None:
    with pytest.raises(ValidationError):
        VacationContingent(person_id=1, year=2026, total_days=-1)


def test_vacation_contingent_rejects_year_below_2000() -> None:
    with pytest.raises(ValidationError):
        VacationContingent(person_id=1, year=1999, total_days=30)


# ---------------------------------------------------------------------------
# PersonAbsence — valid combinations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("absence_type,status", [
    (AbsenceType.vacation, AbsenceStatus.planned),
    (AbsenceType.vacation, AbsenceStatus.confirmed),
    (AbsenceType.training, AbsenceStatus.planned),
    (AbsenceType.training, AbsenceStatus.confirmed),
    (AbsenceType.other, AbsenceStatus.planned),
    (AbsenceType.other, AbsenceStatus.confirmed),
    (AbsenceType.sick, AbsenceStatus.ongoing),
    (AbsenceType.sick, AbsenceStatus.confirmed),
])
def test_person_absence_valid_type_status_combinations(
    absence_type: AbsenceType, status: AbsenceStatus
) -> None:
    end = None if (absence_type == AbsenceType.sick and status == AbsenceStatus.ongoing) else date(2026, 6, 5)
    absence = PersonAbsence(
        person_id=1,
        start_date=date(2026, 6, 1),
        end_date=end,
        absence_type=absence_type,
        status=status,
    )
    assert absence.absence_type == absence_type


# ---------------------------------------------------------------------------
# PersonAbsence — invalid combinations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("absence_type", [AbsenceType.vacation, AbsenceType.training, AbsenceType.other])
def test_person_absence_ongoing_invalid_for_non_sick(absence_type: AbsenceType) -> None:
    with pytest.raises(ValidationError, match="ongoing"):
        PersonAbsence(
            person_id=1,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 5),
            absence_type=absence_type,
            status=AbsenceStatus.ongoing,
        )


def test_person_absence_planned_invalid_for_sick() -> None:
    with pytest.raises(ValidationError, match="planned"):
        PersonAbsence(
            person_id=1,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 5),
            absence_type=AbsenceType.sick,
            status=AbsenceStatus.planned,
        )


@pytest.mark.parametrize("absence_type", [AbsenceType.vacation, AbsenceType.training, AbsenceType.other])
def test_person_absence_non_sick_requires_end_date(absence_type: AbsenceType) -> None:
    with pytest.raises(ValidationError, match="end_date"):
        PersonAbsence(
            person_id=1,
            start_date=date(2026, 6, 1),
            end_date=None,
            absence_type=absence_type,
            status=AbsenceStatus.planned,
        )


def test_person_absence_sick_confirmed_requires_end_date() -> None:
    with pytest.raises(ValidationError, match="end_date"):
        PersonAbsence(
            person_id=1,
            start_date=date(2026, 6, 1),
            end_date=None,
            absence_type=AbsenceType.sick,
            status=AbsenceStatus.confirmed,
        )


def test_person_absence_sick_ongoing_allows_null_end_date() -> None:
    absence = PersonAbsence(
        person_id=1,
        start_date=date(2026, 6, 1),
        end_date=None,
        absence_type=AbsenceType.sick,
        status=AbsenceStatus.ongoing,
    )
    assert absence.end_date is None


def test_person_absence_end_before_start_raises() -> None:
    with pytest.raises(ValidationError, match="end_date"):
        PersonAbsence(
            person_id=1,
            start_date=date(2026, 6, 5),
            end_date=date(2026, 6, 1),
            absence_type=AbsenceType.vacation,
            status=AbsenceStatus.planned,
        )


def test_person_absence_same_day_start_end_valid() -> None:
    absence = PersonAbsence(
        person_id=1,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 6, 1),
        absence_type=AbsenceType.vacation,
        status=AbsenceStatus.planned,
    )
    assert absence.start_date == absence.end_date


# ---------------------------------------------------------------------------
# Property-based tests
# ---------------------------------------------------------------------------

@given(
    offset=st.integers(min_value=0, max_value=365),
    duration=st.integers(min_value=0, max_value=365),
)
@settings(max_examples=200)
def test_person_absence_end_always_gte_start_when_set(offset: int, duration: int) -> None:
    """For any valid start+duration, end_date is always >= start_date."""
    start = date(2026, 1, 1) + timedelta(days=offset)
    end = start + timedelta(days=duration)
    absence = PersonAbsence(
        person_id=1,
        start_date=start,
        end_date=end,
        absence_type=AbsenceType.vacation,
        status=AbsenceStatus.planned,
    )
    assert absence.end_date >= absence.start_date


@given(
    absence_type=st.sampled_from([AbsenceType.vacation, AbsenceType.training]),
    status=st.sampled_from([AbsenceStatus.planned, AbsenceStatus.confirmed]),
)
def test_valid_non_sick_combinations_never_raise(
    absence_type: AbsenceType, status: AbsenceStatus
) -> None:
    PersonAbsence(
        person_id=1,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 6, 5),
        absence_type=absence_type,
        status=status,
    )
