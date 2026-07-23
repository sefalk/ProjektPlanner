"""
Re-export all SQLModel table models so Alembic's env.py can discover them
with a single `import app.models` statement.
"""

from app.models.base import ValidatedSQLModel
from app.models.billing import BillingPosition
from app.models.enums import (
    AbsenceStatus,
    AbsenceType,
    InvoiceStatus,
    MilestoneStatus,
    ProjectStatus,
)
from app.models.holiday import Holiday
from app.models.invite_token import InviteToken
from app.models.invoice import InvoicePersonEntry, MonthlyInvoice
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.program import Program
from app.models.project import Project
from app.models.timebooking import ImportBatch, SagePositionMapping, SageProjectMapping, TimeBooking
from app.models.user import User

__all__ = [
    "ValidatedSQLModel",
    "AbsenceStatus",
    "AbsenceType",
    "BillingPosition",
    "Holiday",
    "ImportBatch",
    "InviteToken",
    "InvoicePersonEntry",
    "InvoiceStatus",
    "Milestone",
    "MilestonePersonBudget",
    "MilestoneStatus",
    "MonthlyInvoice",
    "Person",
    "PersonAbsence",
    "Program",
    "Project",
    "ProjectMembership",
    "ProjectStatus",
    "SagePositionMapping",
    "SageProjectMapping",
    "TimeBooking",
    "User",
    "VacationContingent",
]
