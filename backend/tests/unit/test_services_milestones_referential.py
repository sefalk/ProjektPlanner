"""Tests for WP3 referential actions (V11) and the null-milestone guard (§8.1).

Covers:
  * remove_member_budgets       — MA deletion drops open-milestone budgets, keeps locked.
  * prune_member_budgets_to_range — membership date change drops out-of-range budgets.
  * apply_project_range_change  — project date change removes open out-of-range milestones,
                                  keeps locked ones and reports a warning.
  * _resync_milestone_totals    — V10 baseline/current caches stay consistent.
"""
from datetime import date

from sqlmodel import select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import (
    apply_project_range_change,
    initialize_milestones,
    prune_member_budgets_to_range,
    remove_member_budgets,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project(session, start=date(2026, 1, 1), end=date(2026, 3, 31), number="PR0001"):
    p = Project(
        project_number=number, name=f"Project {number}",
        start_date=start, end_date=end, total_budget_euros=500000.0,
    )
    session.add(p)
    session.flush()
    return p


def _person(session, name):
    p = Person(name=name, sage_employee_name=name, default_weekly_hours=40.0)
    session.add(p)
    session.flush()
    return p


def _membership(session, project_id, person_id, weekly=40.0,
                from_date=date(2026, 1, 1), to_date=date(2026, 3, 31)):
    m = ProjectMembership(
        project_id=project_id, person_id=person_id,
        from_date=from_date, to_date=to_date,
        weekly_capacity_hours=weekly, billing_rate_per_hour=90.0,
    )
    session.add(m)
    session.flush()
    return m


def _milestones(session, project_id):
    return {
        (m.year, m.month): m
        for m in session.exec(select(Milestone).where(Milestone.project_id == project_id)).all()
    }


def _budgets(session, milestone_id):
    return session.exec(
        select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == milestone_id)
    ).all()


# ---------------------------------------------------------------------------
# remove_member_budgets (MA deletion)
# ---------------------------------------------------------------------------


def test_remove_member_budgets_drops_open_rows_and_resyncs(session):
    proj = _project(session)
    a = _person(session, "Alice")
    b = _person(session, "Bob")
    _membership(session, proj.id, a.id)
    _membership(session, proj.id, b.id)
    session.commit()
    initialize_milestones(proj.id, session)

    affected = remove_member_budgets(proj.id, b.id, session)
    session.commit()

    assert len(affected) == 3  # three open months touched
    for ms in _milestones(session, proj.id).values():
        rows = _budgets(session, ms.id)
        assert all(r.person_id != b.id for r in rows)  # Bob gone
        # V10: caches equal the sum of remaining rows
        assert ms.current_hours == sum(r.current_hours for r in rows)
        assert ms.initial_hours == sum(r.initial_hours for r in rows)


def test_remove_member_budgets_protects_locked_month(session):
    proj = _project(session)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)

    jan = _milestones(session, proj.id)[(2026, 1)]
    jan.is_locked = True
    session.add(jan)
    session.commit()

    remove_member_budgets(proj.id, a.id, session)
    session.commit()

    # Locked January keeps Alice's row; open months lose it.
    jan_rows = _budgets(session, jan.id)
    assert any(r.person_id == a.id for r in jan_rows)
    feb = _milestones(session, proj.id)[(2026, 2)]
    assert all(r.person_id != a.id for r in _budgets(session, feb.id))


# ---------------------------------------------------------------------------
# prune_member_budgets_to_range (membership date change)
# ---------------------------------------------------------------------------


def test_prune_removes_budgets_outside_new_range(session):
    proj = _project(session)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)

    # Membership shrinks to February only.
    prune_member_budgets_to_range(proj.id, a.id, date(2026, 2, 1), date(2026, 2, 28), None, session)
    session.commit()

    ms = _milestones(session, proj.id)
    assert _budgets(session, ms[(2026, 1)].id) == []  # Jan pruned
    assert len(_budgets(session, ms[(2026, 2)].id)) == 1  # Feb kept
    assert _budgets(session, ms[(2026, 3)].id) == []  # Mar pruned
    # Pruned milestone totals re-synced to zero.
    assert ms[(2026, 1)].current_hours == 0.0
    assert ms[(2026, 1)].initial_hours == 0.0


def test_prune_protects_locked_month(session):
    proj = _project(session)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)

    jan = _milestones(session, proj.id)[(2026, 1)]
    jan.is_locked = True
    session.add(jan)
    session.commit()

    # New range excludes January, but it is locked → protected.
    prune_member_budgets_to_range(proj.id, a.id, date(2026, 2, 1), date(2026, 3, 31), None, session)
    session.commit()

    assert len(_budgets(session, jan.id)) == 1


# ---------------------------------------------------------------------------
# apply_project_range_change (project date change)
# ---------------------------------------------------------------------------


def test_project_range_shrink_deletes_open_out_of_range(session):
    proj = _project(session, date(2026, 1, 1), date(2026, 3, 31))
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)

    # Shrink to February only.
    proj.start_date = date(2026, 2, 1)
    proj.end_date = date(2026, 2, 28)
    session.add(proj)
    session.flush()
    warnings = apply_project_range_change(proj, session)
    session.commit()

    ms = _milestones(session, proj.id)
    assert set(ms.keys()) == {(2026, 2)}
    assert warnings == []
    # Orphaned budgets removed along with the milestones.
    assert session.exec(select(MilestonePersonBudget)).all()  # Feb rows remain
    remaining = {b.milestone_id for b in session.exec(select(MilestonePersonBudget)).all()}
    assert remaining == {ms[(2026, 2)].id}


def test_project_range_change_keeps_locked_and_warns(session):
    proj = _project(session, date(2026, 1, 1), date(2026, 3, 31))
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)

    jan = _milestones(session, proj.id)[(2026, 1)]
    jan.is_locked = True
    session.add(jan)
    session.commit()

    # Shrink to March; January is now out of range but locked.
    proj.start_date = date(2026, 3, 1)
    session.add(proj)
    session.flush()
    warnings = apply_project_range_change(proj, session)
    session.commit()

    ms = _milestones(session, proj.id)
    assert (2026, 1) in ms  # locked January survives
    assert (2026, 2) not in ms  # open February deleted
    assert (2026, 3) in ms
    assert any("2026-01" in w for w in warnings)
