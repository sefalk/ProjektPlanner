"""Multi-user tenancy schema (doc 25, WP1).

Verifies that ownable entities carry owner_id, that the four formerly-global
unique fields are now unique PER OWNER (same value allowed across owners,
rejected within one owner), and that reference/auth tables stay as designed.
"""

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from app.models.invite_token import InviteToken
from app.models.person import Person
from app.models.program import Program
from app.models.project import Project
from app.models.timebooking import SageProjectMapping
from app.models.user import User

OWNABLE_TABLES = [
    "program", "project", "person", "vacation_contingent", "person_absence",
    "billing_position", "project_membership", "milestone", "milestone_person_budget",
    "monthly_invoice", "invoice_person_entry", "import_batch",
    "sage_project_mapping", "sage_position_mapping", "time_booking",
]
NON_OWNABLE_TABLES = ["holiday", "user", "invite_token"]


@pytest.fixture(name="engine")
def engine_fixture():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    SQLModel.metadata.drop_all(engine)


# ── owner_id presence ─────────────────────────────────────────────────────────

def test_ownable_tables_have_owner_id(engine):
    insp = inspect(engine)
    for table in OWNABLE_TABLES:
        cols = {c["name"] for c in insp.get_columns(table)}
        assert "owner_id" in cols, f"{table} must carry owner_id"


def test_reference_and_auth_tables_have_no_owner_id(engine):
    insp = inspect(engine)
    for table in NON_OWNABLE_TABLES:
        cols = {c["name"] for c in insp.get_columns(table)}
        assert "owner_id" not in cols, f"{table} must NOT carry owner_id"


# ── per-owner uniqueness ────────────────────────────────────────────────────────

def _two_owners(session: Session) -> tuple[int, int]:
    a = User(email="a@example.com", hashed_password="x")
    b = User(email="b@example.com", hashed_password="x")
    session.add(a)
    session.add(b)
    session.commit()
    return a.id, b.id  # type: ignore[return-value]


def test_program_number_unique_per_owner_not_globally(engine):
    with Session(engine) as session:
        o1, o2 = _two_owners(session)
        session.add(Program(owner_id=o1, program_number="P1", name="A", customer="C"))
        session.add(Program(owner_id=o2, program_number="P1", name="B", customer="C"))
        session.commit()  # same number, different owners → allowed
        assert len(session.exec(select(Program)).all()) == 2

        session.add(Program(owner_id=o1, program_number="P1", name="dup", customer="C"))
        with pytest.raises(IntegrityError):
            session.commit()  # same number, same owner → rejected


def test_project_number_unique_per_owner_not_globally(engine):
    with Session(engine) as session:
        o1, o2 = _two_owners(session)
        from datetime import date
        common = dict(name="X", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), total_budget_euros=1000.0)
        session.add(Project(owner_id=o1, project_number="PR1", **common))
        session.add(Project(owner_id=o2, project_number="PR1", **common))
        session.commit()
        assert len(session.exec(select(Project)).all()) == 2

        session.add(Project(owner_id=o1, project_number="PR1", **common))
        with pytest.raises(IntegrityError):
            session.commit()


def test_person_sage_name_unique_per_owner_not_globally(engine):
    with Session(engine) as session:
        o1, o2 = _two_owners(session)
        session.add(Person(owner_id=o1, name="A", sage_employee_name="Meier", default_weekly_hours=40))
        session.add(Person(owner_id=o2, name="B", sage_employee_name="Meier", default_weekly_hours=40))
        session.commit()
        assert len(session.exec(select(Person)).all()) == 2

        session.add(Person(owner_id=o1, name="C", sage_employee_name="Meier", default_weekly_hours=40))
        with pytest.raises(IntegrityError):
            session.commit()


def test_sage_project_mapping_name_unique_per_owner_not_globally(engine):
    with Session(engine) as session:
        o1, o2 = _two_owners(session)
        session.add(SageProjectMapping(owner_id=o1, sage_project_name="Sage-A", project_id=1))
        session.add(SageProjectMapping(owner_id=o2, sage_project_name="Sage-A", project_id=1))
        session.commit()
        assert len(session.exec(select(SageProjectMapping)).all()) == 2

        session.add(SageProjectMapping(owner_id=o1, sage_project_name="Sage-A", project_id=1))
        with pytest.raises(IntegrityError):
            session.commit()


# ── auth tables ─────────────────────────────────────────────────────────────────

def test_user_email_unique(engine):
    with Session(engine) as session:
        session.add(User(email="dup@example.com", hashed_password="x"))
        session.commit()
        session.add(User(email="dup@example.com", hashed_password="y"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_invite_token_unique(engine):
    with Session(engine) as session:
        session.add(InviteToken(token="abc"))
        session.commit()
        session.add(InviteToken(token="abc"))
        with pytest.raises(IntegrityError):
            session.commit()
