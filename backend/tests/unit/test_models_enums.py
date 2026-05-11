"""Tests for all domain enums."""

import pytest
from pydantic import ValidationError

from app.models.enums import (
    AbsenceStatus,
    AbsenceType,
    InvoiceStatus,
    MilestoneStatus,
    ProjectStatus,
)


@pytest.mark.parametrize("value,expected", [
    ("active", ProjectStatus.active),
    ("completed", ProjectStatus.completed),
    ("archived", ProjectStatus.archived),
])
def test_project_status_values(value: str, expected: ProjectStatus) -> None:
    assert ProjectStatus(value) == expected


@pytest.mark.parametrize("value,expected", [
    ("vacation", AbsenceType.vacation),
    ("training", AbsenceType.training),
    ("sick", AbsenceType.sick),
])
def test_absence_type_values(value: str, expected: AbsenceType) -> None:
    assert AbsenceType(value) == expected


@pytest.mark.parametrize("value,expected", [
    ("planned", AbsenceStatus.planned),
    ("confirmed", AbsenceStatus.confirmed),
    ("ongoing", AbsenceStatus.ongoing),
])
def test_absence_status_values(value: str, expected: AbsenceStatus) -> None:
    assert AbsenceStatus(value) == expected


@pytest.mark.parametrize("value,expected", [
    ("open", MilestoneStatus.open),
    ("closed", MilestoneStatus.closed),
])
def test_milestone_status_values(value: str, expected: MilestoneStatus) -> None:
    assert MilestoneStatus(value) == expected


@pytest.mark.parametrize("value,expected", [
    ("planned", InvoiceStatus.planned),
    ("invoiced", InvoiceStatus.invoiced),
    ("paid", InvoiceStatus.paid),
])
def test_invoice_status_values(value: str, expected: InvoiceStatus) -> None:
    assert InvoiceStatus(value) == expected


@pytest.mark.parametrize("enum_class,invalid_value", [
    (ProjectStatus, "deleted"),
    (AbsenceType, "holiday"),
    (AbsenceStatus, "cancelled"),
    (MilestoneStatus, "pending"),
    (InvoiceStatus, "draft"),
])
def test_invalid_enum_value_raises(enum_class, invalid_value: str) -> None:
    with pytest.raises(ValueError):
        enum_class(invalid_value)
