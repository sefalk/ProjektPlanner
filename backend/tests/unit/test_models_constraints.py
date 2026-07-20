"""DB-level uniqueness constraints for multi-assignment (doc 23, WP1).

A person may be assigned to several line items (Projektposten) of the same
project — one ProjectMembership and one MilestonePersonBudget per position —
so the unique keys span billing_position_id.
"""

from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget


@pytest.fixture
def mem_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    SQLModel.metadata.drop_all(engine)


def _mem(session, position_id):
    return ProjectMembership(
        project_id=1, person_id=1,
        from_date=date(2026, 1, 1), to_date=date(2026, 12, 31),
        weekly_capacity_hours=20.0, billing_rate_per_hour=100.0,
        billing_position_id=position_id,
    )


# ── ProjectMembership ────────────────────────────────────────────────────────

def test_membership_same_person_different_positions_allowed(mem_session):
    """The whole point of WP1: one MA on two positions of the same project."""
    mem_session.add(_mem(mem_session, 10))
    mem_session.add(_mem(mem_session, 20))
    mem_session.commit()
    rows = mem_session.query(ProjectMembership).all()
    assert {r.billing_position_id for r in rows} == {10, 20}


def test_membership_same_person_same_position_rejected(mem_session):
    mem_session.add(_mem(mem_session, 10))
    mem_session.commit()
    mem_session.add(_mem(mem_session, 10))
    with pytest.raises(IntegrityError):
        mem_session.commit()


def test_membership_simple_mode_null_position_relies_on_app_logic(mem_session):
    """SQLite treats NULLs as distinct, so the DB does not block two NULL-position
    rows for one (person, project). Simple mode keeps a single membership at the
    application layer; this test documents the DB behaviour."""
    mem_session.add(_mem(mem_session, None))
    mem_session.add(_mem(mem_session, None))
    mem_session.commit()  # no IntegrityError
    assert mem_session.query(ProjectMembership).count() == 2


# ── MilestonePersonBudget ────────────────────────────────────────────────────

def _mpb(position_id):
    return MilestonePersonBudget(
        milestone_id=1, person_id=1, initial_hours=10.0, current_hours=10.0,
        billing_position_id=position_id,
    )


def test_mpb_same_person_different_positions_allowed(mem_session):
    mem_session.add(Milestone(project_id=1, year=2026, month=6, initial_hours=0, current_hours=0))
    mem_session.add(_mpb(10))
    mem_session.add(_mpb(20))
    mem_session.commit()
    assert mem_session.query(MilestonePersonBudget).count() == 2


def test_mpb_same_person_same_position_rejected(mem_session):
    mem_session.add(_mpb(10))
    mem_session.commit()
    mem_session.add(_mpb(10))
    with pytest.raises(IntegrityError):
        mem_session.commit()
