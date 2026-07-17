"""Multi-assignment (doc 23, WP2): one MA on several positions of one project.

Verifies the engine keys budget rows by (person, position): one MilestonePersonBudget
per assignment, each funded from its own position budget at the position's rate, with the
milestone-total invariant preserved.
"""
from datetime import date

from app.models.billing import BillingPosition
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import initialize_milestones
from sqlmodel import select


def _setup(session, budget_a: float, budget_b: float, b_overrunnable: bool = False):
    """Position-mode project, one person assigned to two positions (20h each)."""
    proj = Project(
        project_number="P09001", name="Multi", start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 31), total_budget_euros=budget_a + budget_b,
        total_budget_hours=None, position_mode=True,
    )
    session.add(proj)
    session.flush()
    pos_a = BillingPosition(project_id=proj.id, position_number="A", budget_euros=budget_a, billing_rate_per_hour=100.0)
    pos_b = BillingPosition(
        project_id=proj.id, position_number="B", budget_euros=budget_b,
        billing_rate_per_hour=50.0, overrunnable=b_overrunnable,
    )
    session.add(pos_a)
    session.add(pos_b)
    session.flush()
    person = Person(name="Multi MA", sage_employee_name="Multi MA", default_weekly_hours=40.0)
    session.add(person)
    session.flush()
    for pos in (pos_a, pos_b):
        session.add(ProjectMembership(
            project_id=proj.id, person_id=person.id,
            from_date=date(2026, 1, 1), to_date=date(2026, 1, 31),
            weekly_capacity_hours=20.0, billing_rate_per_hour=0.0,
            billing_position_id=pos.id,
        ))
    session.commit()
    return proj, pos_a, pos_b, person


def _budgets(session, project_id):
    ms = session.exec(select(Milestone).where(Milestone.project_id == project_id)).first()
    rows = session.exec(
        select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
    ).all()
    return ms, {b.billing_position_id: b for b in rows}


def test_one_budget_row_per_position(session):
    """A person on two positions gets one budget row per position, each tagged with it."""
    proj, pos_a, pos_b, person = _setup(session, budget_a=1_000_000.0, budget_b=1_000_000.0)
    initialize_milestones(proj.id, session)

    ms, by_pos = _budgets(session, proj.id)
    assert set(by_pos) == {pos_a.id, pos_b.id}
    assert all(b.person_id == person.id for b in by_pos.values())
    # Both positions have huge budgets → each row funded to full (equal) capacity.
    assert by_pos[pos_a.id].current_hours > 0
    assert abs(by_pos[pos_a.id].current_hours - by_pos[pos_b.id].current_hours) < 1e-6
    # Milestone-total invariant holds across the two rows.
    assert abs(ms.current_hours - sum(b.current_hours for b in by_pos.values())) < 1e-6


def test_positions_capped_independently(session):
    """Each position's budget caps its own row; buckets never borrow from one another."""
    # Position A is tiny (200 € @ 100 €/h → 2 h fundable); B is effectively uncapped.
    proj, pos_a, pos_b, person = _setup(session, budget_a=200.0, budget_b=1_000_000.0)
    initialize_milestones(proj.id, session)

    ms, by_pos = _budgets(session, proj.id)
    row_a, row_b = by_pos[pos_a.id], by_pos[pos_b.id]
    # A is capped by its own budget (cost ≤ 200 €), strictly below its full capacity (= B's hours).
    assert row_a.current_hours * pos_a.billing_rate_per_hour <= pos_a.budget_euros + 1e-6
    assert row_a.current_hours < row_b.current_hours
    assert abs(row_a.current_hours - 2.0) < 1e-6  # 200 € / 100 €·h⁻¹


def test_overrunnable_position_funds_beyond_budget(session):
    """WP3: a cheap OVERRUNNABLE position is funded to full capacity even past its budget,
    while a hard position stays capped. So cheaper hours absorb what the expensive one can't."""
    # A hard, tiny (2 h cap). B overrunnable with a tiny nominal budget (100 € @ 50/h = 2 h)
    # but must fund to full capacity regardless.
    proj, pos_a, pos_b, person = _setup(session, budget_a=200.0, budget_b=100.0, b_overrunnable=True)
    initialize_milestones(proj.id, session)

    ms, by_pos = _budgets(session, proj.id)
    row_a, row_b = by_pos[pos_a.id], by_pos[pos_b.id]
    # A hard-capped at its budget (2 h); B funded far beyond its 2 h nominal budget.
    assert abs(row_a.current_hours - 2.0) < 1e-6
    assert row_b.current_hours > 2.0 + 1e-6
    # B's planned cost exceeds its nominal budget — the allowed overrun.
    assert row_b.current_hours * pos_b.billing_rate_per_hour > pos_b.budget_euros + 1e-6
