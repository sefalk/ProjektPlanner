"""Domain enums shared across all models."""

from enum import Enum


class ProjectStatus(str, Enum):
    planned = "planned"
    active = "active"
    completed = "completed"
    archived = "archived"


class AbsenceType(str, Enum):
    vacation = "vacation"
    training = "training"
    sick = "sick"
    # Geplante Abwesenheit ohne Pauschale/Kontingent (z. B. Elternzeit, Sabbatical).
    # Reduziert konkret die Verfügbarkeit, fließt aber in keine Richtwert-/Kontingent-
    # Schätzung ein (die sind typ-selektiv auf vacation/sick/training verdrahtet).
    other = "other"


class AbsenceStatus(str, Enum):
    planned = "planned"      # vacation / training only
    confirmed = "confirmed"  # all types
    ongoing = "ongoing"      # sick only


class AbsenceDaySegment(str, Enum):
    """Which part of a day an absence covers (for half-day absences).

    Applies to the start day (start_segment) and end day (end_segment) of an
    absence. A half segment (morning/afternoon) counts 0.5 working days; full
    counts 1.0. Middle days of a multi-day absence are always full.
    """

    full = "full"
    morning = "morning"      # Vormittag
    afternoon = "afternoon"  # Nachmittag


class MilestoneStatus(str, Enum):
    open = "open"
    closed = "closed"


class InvoiceStatus(str, Enum):
    planned = "planned"
    invoiced = "invoiced"
    paid = "paid"
