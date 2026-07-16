from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.billing import BillingPosition
from app.models.enums import MilestoneStatus
from app.models.invoice import MonthlyInvoice
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone
from app.models.person import Person
from app.models.project import Project
from app.models.timebooking import ImportBatch, TimeBooking
from app.services.line_items import (
    default_new_position_budget,
    position_budget_state,
    would_overshoot,
)
from app.services.milestones import (
    MilestoneNotFound,
    PositionModeNotEnableable,
    apply_project_range_change,
    can_enable_position_mode,
    prune_member_budgets_to_range,
    remove_member_budgets,
    set_position_mode,
)

router = APIRouter(prefix="/projects", tags=["projects"])

SessionDep = Annotated[Session, Depends(get_session)]


# ---------------------------------------------------------------------------
# Create schemas (FK from URL, not body)
# ---------------------------------------------------------------------------

class BillingPositionCreate(SQLModel):
    position_number: str = Field(min_length=1)
    description: str = ""
    # None → default to the open (unallocated) difference (P3).
    budget_euros: float | None = Field(default=None, ge=0)
    billing_rate_per_hour: float = Field(default=0.0, ge=0)


class BillingPositionUpdate(SQLModel):
    position_number: str = Field(min_length=1)
    description: str = ""
    budget_euros: float = Field(ge=0)
    billing_rate_per_hour: float = Field(default=0.0, ge=0)


class BillingPositionBudgetState(SQLModel):
    total_budget_euros: float
    allocated_euros: float
    open_euros: float
    is_over: bool
    is_complete: bool


class MembershipCreate(SQLModel):
    person_id: int
    from_date: str  # date as ISO string; FastAPI converts
    to_date: str
    weekly_capacity_hours: float = Field(gt=0, le=60)
    billing_rate_per_hour: float = Field(ge=0)
    priority: int = 0  # B6: smaller = higher priority for budget distribution
    vacation_days_taken: float = Field(default=0.0, ge=0)
    billing_position_id: int | None = None  # position mode (P2); null = simple mode


class MembershipUpdate(SQLModel):
    from_date: str
    to_date: str
    weekly_capacity_hours: float = Field(gt=0, le=60)
    billing_rate_per_hour: float = Field(ge=0)
    priority: int = 0
    vacation_days_taken: float = Field(default=0.0, ge=0)
    billing_position_id: int | None = None


class MembershipWithWarnings(SQLModel):
    id: int
    project_id: int
    person_id: int
    from_date: date
    to_date: date
    weekly_capacity_hours: float
    billing_rate_per_hour: float
    priority: int = 0
    vacation_days_taken: float = 0.0
    billing_position_id: int | None = None
    warnings: list[str] = []


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectStats(BaseModel):
    project_id: int
    booked_hours: float
    open_milestones: int
    overdue_milestones: int


@router.get("", response_model=list[Project])
def list_projects(session: SessionDep, skip: int = 0, limit: int = 100):
    return session.exec(select(Project).offset(skip).limit(limit)).all()


@router.get("/stats", response_model=list[ProjectStats])
def get_project_stats(session: SessionDep):
    today = date.today()

    booked_rows = session.exec(
        select(TimeBooking.project_id, func.sum(TimeBooking.net_hours))
        .where(TimeBooking.is_excluded == False)  # noqa: E712
        .group_by(TimeBooking.project_id)
    ).all()
    booked_map: dict[int, float] = {pid: float(hrs) for pid, hrs in booked_rows}

    open_ms = session.exec(select(Milestone).where(Milestone.status == MilestoneStatus.open)).all()
    open_count: dict[int, int] = {}
    overdue_count: dict[int, int] = {}
    for ms in open_ms:
        open_count[ms.project_id] = open_count.get(ms.project_id, 0) + 1
        if (ms.year, ms.month) < (today.year, today.month):
            overdue_count[ms.project_id] = overdue_count.get(ms.project_id, 0) + 1

    projects_all = session.exec(select(Project)).all()
    return [
        ProjectStats(
            project_id=p.id,
            booked_hours=booked_map.get(p.id, 0.0),
            open_milestones=open_count.get(p.id, 0),
            overdue_milestones=overdue_count.get(p.id, 0),
        )
        for p in projects_all
    ]


@router.post("", response_model=Project, status_code=201)
def create_project(project: Project, session: SessionDep):
    project.id = None
    try:
        session.add(project)
        session.commit()
        session.refresh(project)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Project number already exists.")
    return project


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: int, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    return project


@router.put("/{project_id}", response_model=Project)
def update_project(project_id: int, data: Project, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    old_start, old_end = project.start_date, project.end_date
    # position_mode is toggled only via the guarded /position-mode endpoint (§21 WP8).
    update = data.model_dump(exclude_unset=True, exclude={"id", "position_mode"})
    for field, value in update.items():
        setattr(project, field, value)
    try:
        session.add(project)
        session.commit()
        session.refresh(project)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Project number already exists.")
    # Referential action (V11): reconcile milestones if the project range shrank/shifted.
    # Open out-of-range milestones are removed; locked ones are kept (flagged in detail).
    if project.start_date != old_start or project.end_date != old_end:
        apply_project_range_change(project, session)
        session.commit()
        session.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    session.delete(project)
    session.commit()


@router.get("/{project_id}/sage-levels", response_model=list[str])
def list_sage_levels(project_id: int, session: SessionDep):
    """Distinct Sage 'Projektebene 1' values seen in this project's bookings — used to
    suggest level values when mapping levels to line items (§21 P6). Project-scoped."""
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    rows = session.exec(
        select(TimeBooking.sage_project_level)
        .where(TimeBooking.project_id == project_id)
        .distinct()
    ).all()
    return sorted({lvl for lvl in rows if lvl})


# ---------------------------------------------------------------------------
# Billing positions
# ---------------------------------------------------------------------------

@router.get("/{project_id}/billing-positions", response_model=list[BillingPosition])
def list_billing_positions(project_id: int, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    return session.exec(
        select(BillingPosition).where(BillingPosition.project_id == project_id)
    ).all()


def _positions(project_id: int, session: Session) -> list[BillingPosition]:
    return list(session.exec(
        select(BillingPosition).where(BillingPosition.project_id == project_id)
    ).all())


@router.get(
    "/{project_id}/billing-positions/budget-state",
    response_model=BillingPositionBudgetState,
)
def billing_positions_budget_state(project_id: int, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    state = position_budget_state(
        project.total_budget_euros, [p.budget_euros for p in _positions(project_id, session)]
    )
    return BillingPositionBudgetState(**state.__dict__)


@router.post("/{project_id}/billing-positions", response_model=BillingPosition, status_code=201)
def create_billing_position(project_id: int, body: BillingPositionCreate, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    existing = [p.budget_euros for p in _positions(project_id, session)]
    # Default to the open difference (P3); otherwise honour the requested amount.
    budget = (
        default_new_position_budget(project.total_budget_euros, existing)
        if body.budget_euros is None
        else body.budget_euros
    )
    if would_overshoot(project.total_budget_euros, existing, budget):
        raise HTTPException(
            409,
            f"Σ Posten-Budget würde das Gesamtbudget ({project.total_budget_euros:.2f} €) "
            f"überschreiten.",
        )
    bp = BillingPosition(
        project_id=project_id,
        position_number=body.position_number,
        description=body.description,
        budget_euros=budget,
        billing_rate_per_hour=body.billing_rate_per_hour,
    )
    session.add(bp)
    session.commit()
    session.refresh(bp)
    return bp


@router.put("/{project_id}/billing-positions/{bp_id}", response_model=BillingPosition)
def update_billing_position(
    project_id: int, bp_id: int, body: BillingPositionUpdate, session: SessionDep
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    bp = session.get(BillingPosition, bp_id)
    if not bp or bp.project_id != project_id:
        raise HTTPException(404, "Billing position not found.")
    others = [p.budget_euros for p in _positions(project_id, session) if p.id != bp_id]
    if would_overshoot(project.total_budget_euros, others, body.budget_euros):
        raise HTTPException(
            409,
            f"Σ Posten-Budget würde das Gesamtbudget ({project.total_budget_euros:.2f} €) "
            f"überschreiten.",
        )
    bp.position_number = body.position_number
    bp.description = body.description
    bp.budget_euros = body.budget_euros
    bp.billing_rate_per_hour = body.billing_rate_per_hour
    session.add(bp)
    session.commit()
    session.refresh(bp)
    return bp


@router.delete("/{project_id}/billing-positions/{bp_id}", status_code=204)
def delete_billing_position(project_id: int, bp_id: int, session: SessionDep):
    bp = session.get(BillingPosition, bp_id)
    if not bp or bp.project_id != project_id:
        raise HTTPException(404, "Billing position not found.")
    # Guard: a position may only be deleted while nothing references it (P8/§8).
    assigned = session.exec(
        select(ProjectMembership).where(ProjectMembership.billing_position_id == bp_id)
    ).first()
    if assigned:
        raise HTTPException(409, "Posten hat zugewiesene Mitarbeiter und kann nicht gelöscht werden.")
    invoiced = session.exec(
        select(MonthlyInvoice).where(MonthlyInvoice.billing_position_id == bp_id)
    ).first()
    if invoiced:
        raise HTTPException(409, "Posten hat Abrechnungen und kann nicht gelöscht werden.")
    session.delete(bp)
    session.commit()


# ---------------------------------------------------------------------------
# Position mode (§21 WP8)
# ---------------------------------------------------------------------------

class PositionModeStatus(SQLModel):
    enabled: bool
    can_enable: bool
    reasons: list[str]


class PositionModeUpdate(SQLModel):
    enabled: bool


@router.get("/{project_id}/position-mode", response_model=PositionModeStatus)
def get_position_mode(project_id: int, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    memberships = list(session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all())
    ok, reasons = can_enable_position_mode(project, memberships, _positions(project_id, session))
    return PositionModeStatus(enabled=project.position_mode, can_enable=ok, reasons=reasons)


@router.put("/{project_id}/position-mode", response_model=Project)
def put_position_mode(project_id: int, body: PositionModeUpdate, session: SessionDep):
    try:
        return set_position_mode(project_id, body.enabled, session)
    except MilestoneNotFound:
        raise HTTPException(404, "Project not found.")
    except PositionModeNotEnableable as exc:
        raise HTTPException(409, {"detail": "Posten-Modus kann nicht aktiviert werden.", "reasons": exc.reasons})


# ---------------------------------------------------------------------------
# Memberships
# ---------------------------------------------------------------------------

@router.get("/{project_id}/memberships", response_model=list[ProjectMembership])
def list_memberships(project_id: int, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    return session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()


def _membership_overbooking_warnings(membership: ProjectMembership, session: Session) -> list[str]:
    from app.models.person import Person
    from calendar import monthrange

    person = session.get(Person, membership.person_id)
    if not person or person.default_weekly_hours <= 0:
        return []

    # The new membership is already committed; query all memberships including it.
    all_memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.person_id == membership.person_id)
    ).all()

    warnings: list[str] = []
    cur = date(membership.from_date.year, membership.from_date.month, 1)
    end_month = date(membership.to_date.year, membership.to_date.month, 1)
    MONTH_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

    while cur <= end_month:
        last_day = date(cur.year, cur.month, monthrange(cur.year, cur.month)[1])
        total_cap = sum(
            m.weekly_capacity_hours
            for m in all_memberships
            if m.from_date <= last_day and m.to_date >= cur
        )
        pct = round(total_cap / person.default_weekly_hours * 100)
        if pct > 100:
            warnings.append(f"{MONTH_DE[cur.month - 1]} {cur.year}: {pct}% ({total_cap:.0f}/{person.default_weekly_hours:.0f} h/Woche)")
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)

    return warnings


def _validate_membership_position(project_id: int, billing_position_id: int | None, session: Session) -> None:
    """Enforce §21 P2: while the project is in position mode every member must be assigned
    to a line item of THIS project. A provided assignment must always reference a position
    of the project (checked in either mode)."""
    project = session.get(Project, project_id)
    pos_ids = {p.id for p in _positions(project_id, session)}
    if project is not None and project.position_mode and billing_position_id is None:
        raise HTTPException(400, "Im Posten-Modus muss dem Mitglied ein Posten zugewiesen werden.")
    if billing_position_id is not None and billing_position_id not in pos_ids:
        raise HTTPException(400, "Zugewiesener Posten gehört nicht zu diesem Projekt.")


@router.post("/{project_id}/memberships", response_model=MembershipWithWarnings, status_code=201)
def create_membership(project_id: int, body: MembershipCreate, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    _validate_membership_position(project_id, body.billing_position_id, session)
    membership = ProjectMembership(
        project_id=project_id,
        person_id=body.person_id,
        from_date=date.fromisoformat(body.from_date),
        to_date=date.fromisoformat(body.to_date),
        weekly_capacity_hours=body.weekly_capacity_hours,
        billing_rate_per_hour=body.billing_rate_per_hour,
        priority=body.priority,
        vacation_days_taken=body.vacation_days_taken,
        billing_position_id=body.billing_position_id,
    )
    try:
        session.add(membership)
        session.commit()
        session.refresh(membership)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Membership already exists for this person and project.")
    warnings = _membership_overbooking_warnings(membership, session)
    return MembershipWithWarnings(
        id=membership.id,
        project_id=membership.project_id,
        person_id=membership.person_id,
        from_date=membership.from_date,
        to_date=membership.to_date,
        weekly_capacity_hours=membership.weekly_capacity_hours,
        billing_rate_per_hour=membership.billing_rate_per_hour,
        priority=membership.priority,
        vacation_days_taken=membership.vacation_days_taken,
        billing_position_id=membership.billing_position_id,
        warnings=warnings,
    )


@router.put("/{project_id}/memberships/{membership_id}", response_model=MembershipWithWarnings)
def update_membership(project_id: int, membership_id: int, body: MembershipUpdate, session: SessionDep):
    m = session.get(ProjectMembership, membership_id)
    if not m or m.project_id != project_id:
        raise HTTPException(404, "Membership not found.")
    _validate_membership_position(project_id, body.billing_position_id, session)
    m.from_date = date.fromisoformat(body.from_date)
    m.to_date = date.fromisoformat(body.to_date)
    m.weekly_capacity_hours = body.weekly_capacity_hours
    m.billing_rate_per_hour = body.billing_rate_per_hour
    m.priority = body.priority
    m.vacation_days_taken = body.vacation_days_taken
    m.billing_position_id = body.billing_position_id
    session.add(m)
    session.commit()
    session.refresh(m)
    # Referential action (V11): drop this member's budgets from open milestones that no
    # longer overlap the (possibly shrunk) membership range. Recomputing changed weekly
    # hours into remaining months is the resync path (WP4/WP5), not done here.
    prune_member_budgets_to_range(project_id, m.person_id, m.from_date, m.to_date, session)
    session.commit()
    warnings = _membership_overbooking_warnings(m, session)
    return MembershipWithWarnings(
        id=m.id,
        project_id=m.project_id,
        person_id=m.person_id,
        from_date=m.from_date,
        to_date=m.to_date,
        weekly_capacity_hours=m.weekly_capacity_hours,
        billing_rate_per_hour=m.billing_rate_per_hour,
        priority=m.priority,
        vacation_days_taken=m.vacation_days_taken,
        billing_position_id=m.billing_position_id,
        warnings=warnings,
    )


@router.delete("/{project_id}/memberships/{membership_id}", status_code=204)
def delete_membership(project_id: int, membership_id: int, session: SessionDep):
    m = session.get(ProjectMembership, membership_id)
    if not m or m.project_id != project_id:
        raise HTTPException(404, "Membership not found.")
    person_id = m.person_id
    session.delete(m)
    session.flush()
    # Referential action (V11, BUG-7): drop the member's budgets from open milestones so
    # no orphaned rows keep counting toward milestone totals. Locked months are protected.
    remove_member_budgets(project_id, person_id, session)
    session.commit()


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------


class BookingOut(BaseModel):
    id: int
    booking_date: date
    person_id: int
    person_name: str
    import_batch_id: int
    sage_project_name: str
    sage_project_level: str
    net_hours: float
    duration_raw: str
    break_duration: str
    note: str
    is_excluded: bool
    exclusion_reason: str | None
    exclusion_note: str | None


@router.get("/{project_id}/bookings", response_model=list[BookingOut])
def list_project_bookings(
    project_id: int,
    session: SessionDep,
    person_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
    week: int | None = None,
):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")

    q = select(TimeBooking).where(TimeBooking.project_id == project_id)

    if person_id is not None:
        q = q.where(TimeBooking.person_id == person_id)

    if year is not None and month is not None:
        from calendar import monthrange
        last_day = monthrange(year, month)[1]
        q = q.where(
            TimeBooking.booking_date >= date(year, month, 1),
            TimeBooking.booking_date <= date(year, month, last_day),
        )
    elif year is not None and week is not None:
        # ISO week: compute monday and sunday
        from datetime import datetime
        monday = datetime.strptime(f"{year}-W{week:02d}-1", "%G-W%V-%u").date()
        sunday = datetime.strptime(f"{year}-W{week:02d}-7", "%G-W%V-%u").date()
        q = q.where(
            TimeBooking.booking_date >= monday,
            TimeBooking.booking_date <= sunday,
        )
    elif year is not None:
        q = q.where(
            TimeBooking.booking_date >= date(year, 1, 1),
            TimeBooking.booking_date <= date(year, 12, 31),
        )

    q = q.order_by(TimeBooking.booking_date.desc(), TimeBooking.person_id)
    bookings = session.exec(q).all()

    person_cache: dict[int, str] = {}
    result = []
    for b in bookings:
        if b.person_id not in person_cache:
            p = session.get(Person, b.person_id)
            person_cache[b.person_id] = p.name if p else f"Person {b.person_id}"
        result.append(BookingOut(
            id=b.id,  # type: ignore[arg-type]
            booking_date=b.booking_date,
            person_id=b.person_id,
            person_name=person_cache[b.person_id],
            import_batch_id=b.import_batch_id,
            sage_project_name=b.sage_project_name,
            sage_project_level=b.sage_project_level,
            net_hours=b.net_hours,
            duration_raw=b.duration_raw,
            break_duration=b.break_duration,
            note=b.note,
            is_excluded=b.is_excluded,
            exclusion_reason=b.exclusion_reason,
            exclusion_note=b.exclusion_note,
        ))
    return result
