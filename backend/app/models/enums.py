"""Domain enums shared across all models."""

from enum import Enum


class ProjectStatus(str, Enum):
    active = "active"
    completed = "completed"
    archived = "archived"


class AbsenceType(str, Enum):
    vacation = "vacation"
    training = "training"
    sick = "sick"


class AbsenceStatus(str, Enum):
    planned = "planned"      # vacation / training only
    confirmed = "confirmed"  # all types
    ongoing = "ongoing"      # sick only


class MilestoneStatus(str, Enum):
    open = "open"
    closed = "closed"


class InvoiceStatus(str, Enum):
    planned = "planned"
    invoiced = "invoiced"
    paid = "paid"
