"""Person, VacationContingent, and PersonAbsence models."""

from datetime import date

from pydantic import model_validator
from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from app.models.base import ValidatedSQLModel
from app.models.enums import AbsenceStatus, AbsenceType


class Person(ValidatedSQLModel, table=True):
    __tablename__ = "person"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(min_length=1)
    # Must match the employee name string used in Sage ERP exports.
    sage_employee_name: str = Field(unique=True, index=True, min_length=1)
    default_weekly_hours: float = Field(gt=0, le=60)
    # Comma-separated daily hours Mon–Fri, e.g. "8,8,8,8,0" for 4-day/32h week.
    work_week_pattern: str | None = Field(default=None)
    default_billing_rate: float | None = Field(default=None, gt=0)


class VacationContingent(ValidatedSQLModel, table=True):
    __tablename__ = "vacation_contingent"
    __table_args__ = (UniqueConstraint("person_id", "year", name="uq_vacation_contingent_person_year"),)

    id: int | None = Field(default=None, primary_key=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    year: int = Field(ge=2000, le=2100)
    total_days: float = Field(ge=0, le=365)


class PersonAbsence(ValidatedSQLModel, table=True):
    """A date-range absence record for a person.

    Status rules (enforced by model_validator):
      vacation / training → planned | confirmed  (end_date required)
      sick                → ongoing | confirmed  (end_date optional when ongoing)
    """

    __tablename__ = "person_absence"

    id: int | None = Field(default=None, primary_key=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    start_date: date
    end_date: date | None = None  # null only for sick + ongoing
    absence_type: AbsenceType
    status: AbsenceStatus
    note: str = ""

    @model_validator(mode="after")
    def validate_type_status_and_dates(self) -> "PersonAbsence":
        if self.absence_type == AbsenceType.sick:
            if self.status == AbsenceStatus.planned:
                raise ValueError("Sick leave cannot have status 'planned'. Use 'ongoing' or 'confirmed'.")
            if self.status == AbsenceStatus.confirmed and self.end_date is None:
                raise ValueError("Confirmed sick leave requires an end_date.")
        else:
            if self.status == AbsenceStatus.ongoing:
                raise ValueError(
                    f"Absence type '{self.absence_type}' cannot have status 'ongoing'. "
                    "Only sick leave can be ongoing."
                )
            if self.end_date is None:
                raise ValueError(f"Absence type '{self.absence_type}' requires an end_date.")

        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date.")

        return self
