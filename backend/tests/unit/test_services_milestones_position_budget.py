"""Position-mode budget guard (#50): project total is a HARD cap and überschreitbare
Posten share the remaining project budget by member priority ('Reserviert + Priorität').

Rules verified here:
  * The project's total_budget_euros is never exceeded in position mode.
  * A non-überschreitbarer (fester) Posten is reserved at its own budget (capped by capacity).
  * Überschreitbare Posten absorb the capacity a fixed Posten could not use (they may exceed
    their OWN budget), but only up to the project total.
  * When the shared pool cannot fill everyone, higher-priority members are funded first; the
    Posten with the lowest-priority member is the one left underfilled.
"""
from datetime import date

from app.models.billing import BillingPosition
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import initialize_milestones, resync_milestones
from sqlmodel import select

RATE = 100.0


def _setup(
    session,
    *,
    budget1: float,
    budget2: float,
    total: float,
    p1_overrunnable: bool,
    p2_overrunnable: bool,
    weekly1: float = 40.0,
    weekly2: float = 40.0,
    prio1: int = 0,
    prio2: int = 0,
):
    """Position-mode project with two Posten, one member each (the user's scenario)."""
    proj = Project(
        project_number="P50001", name="Cap", start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 31), total_budget_euros=total,
        total_budget_hours=None, position_mode=True,
    )
    session.add(proj)
    session.flush()
    pos1 = BillingPosition(
        project_id=proj.id, position_number="P1", budget_euros=budget1,
        billing_rate_per_hour=RATE, overrunnable=p1_overrunnable,
    )
    pos2 = BillingPosition(
        project_id=proj.id, position_number="P2", budget_euros=budget2,
        billing_rate_per_hour=RATE, overrunnable=p2_overrunnable,
    )
    session.add(pos1)
    session.add(pos2)
    session.flush()
    ma1 = Person(name="MA1", sage_employee_name="MA1", default_weekly_hours=40.0)
    ma2 = Person(name="MA2", sage_employee_name="MA2", default_weekly_hours=40.0)
    session.add(ma1)
    session.add(ma2)
    session.flush()
    session.add(ProjectMembership(
        project_id=proj.id, person_id=ma1.id, from_date=date(2026, 1, 1),
        to_date=date(2026, 1, 31), weekly_capacity_hours=weekly1,
        billing_rate_per_hour=0.0, billing_position_id=pos1.id, priority=prio1,
    ))
    session.add(ProjectMembership(
        project_id=proj.id, person_id=ma2.id, from_date=date(2026, 1, 1),
        to_date=date(2026, 1, 31), weekly_capacity_hours=weekly2,
        billing_rate_per_hour=0.0, billing_position_id=pos2.id, priority=prio2,
    ))
    session.commit()
    return proj, pos1, pos2, ma1, ma2


def _cost_by_position(session, project_id, positions):
    rate = {p.id: p.billing_rate_per_hour for p in positions}
    ms = session.exec(select(Milestone).where(Milestone.project_id == project_id)).all()
    rows = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id.in_([m.id for m in ms])
        )
    ).all()
    cost: dict[int, float] = {}
    for b in rows:
        cost[b.billing_position_id] = cost.get(b.billing_position_id, 0.0) + b.current_hours * rate.get(b.billing_position_id, 0.0)
    return cost


def test_project_total_is_hard_cap_in_position_mode(session):
    """P1 überschreitbar (MA1), P2 fest (MA2), Σ Posten-Budget = Gesamtbudget, große
    Kapazität. Ohne Deckel würde der überschreitbare Posten auf volle Kapazität (>>Budget)
    laufen. Mit Deckel bleibt die Projektsumme = Gesamtbudget."""
    proj, pos1, pos2, ma1, ma2 = _setup(
        session, budget1=1000.0, budget2=1000.0, total=2000.0,
        p1_overrunnable=True, p2_overrunnable=False,
    )
    initialize_milestones(proj.id, session)
    cost = _cost_by_position(session, proj.id, [pos1, pos2])

    total = sum(cost.values())
    assert total <= proj.total_budget_euros + 1e-6           # HARD cap
    assert abs(total - 2000.0) < 1e-6                          # budget fully used, binds
    assert cost[pos2.id] <= pos2.budget_euros + 1e-6           # fixed reserved at own budget


def test_freed_headroom_flows_to_overrunnable(session):
    """MA2 (fester Posten) kann sein Budget wegen Kapazität nicht ausschöpfen; der frei
    gewordene Rest fließt in den überschreitbaren P1, der so sein eigenes Budget übersteigt
    — aber die Projektsumme bleibt gedeckelt. (Genau der vom Nutzer beschriebene Fall.)"""
    proj, pos1, pos2, ma1, ma2 = _setup(
        session, budget1=500.0, budget2=1500.0, total=2000.0,
        p1_overrunnable=True, p2_overrunnable=False,
        weekly1=40.0, weekly2=1.0,  # MA2 kapazitätsbegrenzt << P2-Budget
    )
    initialize_milestones(proj.id, session)
    cost = _cost_by_position(session, proj.id, [pos1, pos2])

    total = sum(cost.values())
    assert total <= proj.total_budget_euros + 1e-6                 # HARD cap
    assert cost[pos2.id] < pos2.budget_euros - 1e-6                # fixed underfilled (capacity)
    assert cost[pos1.id] > pos1.budget_euros + 1e-6               # overrunnable exceeds OWN budget
    assert cost[pos1.id] > cost[pos2.id]                          # freed headroom went to P1


def test_priority_fills_across_overrunnable_positions(session):
    """Zwei überschreitbare Posten, knappes Gesamtbudget: gefüllt wird nach MA-Priorität.
    Der Posten mit dem niedrigst-priorisierten MA bleibt ungefüllt."""
    proj, pos1, pos2, ma1, ma2 = _setup(
        session, budget1=1500.0, budget2=1500.0, total=3000.0,
        p1_overrunnable=True, p2_overrunnable=True,
        prio1=0, prio2=1,  # MA1 höhere Priorität (kleiner = höher)
    )
    initialize_milestones(proj.id, session)
    cost = _cost_by_position(session, proj.id, [pos1, pos2])

    total = sum(cost.values())
    assert total <= proj.total_budget_euros + 1e-6
    assert cost.get(pos1.id, 0.0) > 0.0                          # high priority funded
    assert cost.get(pos2.id, 0.0) < 1e-6                         # lowest priority left unfilled


def test_cap_reason_names_project_budget_for_overrunnable(session):
    """Ein überschreitbarer Posten, der wegen des Gesamtbudget-Deckels unter seiner Kapazität
    bleibt, weist das PROJEKTBUDGET als Grund aus (nicht das eigene Posten-Budget)."""
    from app.routers.milestones import list_milestones_detail

    proj, pos1, pos2, ma1, ma2 = _setup(
        session, budget1=1500.0, budget2=1500.0, total=3000.0,
        p1_overrunnable=True, p2_overrunnable=True,
        prio1=0, prio2=1,
    )
    initialize_milestones(proj.id, session)

    detail = list_milestones_detail(proj.id, session)
    p2_rows = [p for ms in detail for p in ms.persons if p.billing_position_id == pos2.id]
    assert p2_rows and all(
        r.cap_reason and "Projektbudget" in r.cap_reason for r in p2_rows
    )


def test_resync_respects_project_total_cap(session):
    """Der 'Neu berechnen'-Pfad (resync) darf das Gesamtbudget ebenfalls nicht überschreiten
    — das war der ursprüngliche Bug."""
    proj, pos1, pos2, ma1, ma2 = _setup(
        session, budget1=500.0, budget2=1500.0, total=2000.0,
        p1_overrunnable=True, p2_overrunnable=False,
        weekly1=40.0, weekly2=1.0,
    )
    initialize_milestones(proj.id, session)
    resync_milestones(proj.id, session)
    cost = _cost_by_position(session, proj.id, [pos1, pos2])

    total = sum(cost.values())
    assert total <= proj.total_budget_euros + 1e-6
    assert cost[pos1.id] > pos1.budget_euros + 1e-6              # overrun via freed headroom
