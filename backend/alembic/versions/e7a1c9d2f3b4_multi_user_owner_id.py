"""Multi-user tenancy: user + invite_token tables, owner_id on ownable entities (doc 25, WP1)

Introduces application identity (`user`) and the one-time registration gate
(`invite_token`), and adds a nullable `owner_id` FK → user.id to every ownable
entity (root + denormalised children) so the central owner-filter (WP3) can be
applied uniformly without a join. The four formerly-global unique keys become
unique PER OWNER:
    program.program_number        → (owner_id, program_number)
    project.project_number        → (owner_id, project_number)
    person.sage_employee_name     → (owner_id, sage_employee_name)
    sage_project_mapping.sage_project_name → (owner_id, sage_project_name)

owner_id is nullable for now: WP3 sets it on insert and enforces the filter; a
later migration can tighten it to NOT NULL once every row is provably owned.
`holiday` (reference data) stays global; `setting` stays global in WP1 and is
converted to per-owner in WP3 (needs a user context for per-account seeding).

Note: runtime/tests build the schema via SQLModel.metadata.create_all; the
hosted deployment builds it via `alembic upgrade head` — so this migration is
the schema-of-record for production and must be complete.

Revision ID: e7a1c9d2f3b4
Revises: d4f1c7e93a20
Create Date: 2026-07-22
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7a1c9d2f3b4"
down_revision: Union[str, None] = "d4f1c7e93a20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Ownable child tables that only need a denormalised owner_id (+ FK + index).
_CHILD_TABLES = [
    "vacation_contingent",
    "person_absence",
    "billing_position",
    "project_membership",
    "milestone",
    "milestone_person_budget",
    "monthly_invoice",
    "invoice_person_entry",
    "import_batch",
    "sage_position_mapping",
    "time_booking",
]


def _tables(conn) -> set[str]:
    return {
        row[0]
        for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'"))
    }


def _cols(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def _add_owner_id(table: str) -> None:
    """Add a denormalised owner_id column (+ FK + index) to a child table."""
    with op.batch_alter_table(table) as batch_op:
        batch_op.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(f"fk_{table}_owner", "user", ["owner_id"], ["id"])
        batch_op.create_index(f"ix_{table}_owner_id", ["owner_id"], unique=False)


def upgrade() -> None:
    conn = op.get_bind()
    tables = _tables(conn)

    # 1. Auth / identity tables ────────────────────────────────────────────────
    if "user" not in tables:
        op.create_table(
            "user",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("email", sa.String(), nullable=False),
            sa.Column("hashed_password", sa.String(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column("is_superuser", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )
        op.create_index("ix_user_email", "user", ["email"], unique=True)

    if "invite_token" not in tables:
        op.create_table(
            "invite_token",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("token", sa.String(), nullable=False),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
            sa.Column("used_by", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_invite_token_token", "invite_token", ["token"], unique=True)

    # 2. Root tables: add owner_id + swap the global unique for a per-owner one ──
    if "owner_id" not in _cols(conn, "program"):
        with op.batch_alter_table("program") as b:
            b.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_program_owner", "user", ["owner_id"], ["id"])
            b.drop_index("ix_program_program_number")
            b.create_index("ix_program_program_number", ["program_number"], unique=False)
            b.create_index("ix_program_owner_id", ["owner_id"], unique=False)
            b.create_unique_constraint("uq_program_owner_number", ["owner_id", "program_number"])

    if "owner_id" not in _cols(conn, "project"):
        with op.batch_alter_table("project") as b:
            b.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_project_owner", "user", ["owner_id"], ["id"])
            b.drop_index("ix_project_project_number")
            b.create_index("ix_project_project_number", ["project_number"], unique=False)
            b.create_index("ix_project_owner_id", ["owner_id"], unique=False)
            b.create_unique_constraint("uq_project_owner_number", ["owner_id", "project_number"])

    if "owner_id" not in _cols(conn, "person"):
        with op.batch_alter_table("person") as b:
            b.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_person_owner", "user", ["owner_id"], ["id"])
            b.drop_index("ix_person_sage_employee_name")
            b.create_index("ix_person_sage_employee_name", ["sage_employee_name"], unique=False)
            b.create_index("ix_person_owner_id", ["owner_id"], unique=False)
            b.create_unique_constraint("uq_person_owner_sage_name", ["owner_id", "sage_employee_name"])

    if "owner_id" not in _cols(conn, "sage_project_mapping"):
        with op.batch_alter_table("sage_project_mapping") as b:
            b.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_sage_project_mapping_owner", "user", ["owner_id"], ["id"])
            b.drop_index("ix_sage_project_mapping_sage_project_name")
            b.create_index("ix_sage_project_mapping_sage_project_name", ["sage_project_name"], unique=False)
            b.create_index("ix_sage_project_mapping_owner_id", ["owner_id"], unique=False)
            b.create_unique_constraint("uq_sage_mapping_owner_name", ["owner_id", "sage_project_name"])

    # 3. Child tables: denormalised owner_id only ────────────────────────────────
    for table in _CHILD_TABLES:
        if "owner_id" not in _cols(conn, table):
            _add_owner_id(table)


def _drop_owner_id(table: str) -> None:
    with op.batch_alter_table(table) as batch_op:
        batch_op.drop_index(f"ix_{table}_owner_id")
        batch_op.drop_constraint(f"fk_{table}_owner", type_="foreignkey")
        batch_op.drop_column("owner_id")


def downgrade() -> None:
    for table in reversed(_CHILD_TABLES):
        _drop_owner_id(table)

    with op.batch_alter_table("sage_project_mapping") as b:
        b.drop_constraint("uq_sage_mapping_owner_name", type_="unique")
        b.drop_index("ix_sage_project_mapping_owner_id")
        b.drop_index("ix_sage_project_mapping_sage_project_name")
        b.create_index("ix_sage_project_mapping_sage_project_name", ["sage_project_name"], unique=True)
        b.drop_constraint("fk_sage_project_mapping_owner", type_="foreignkey")
        b.drop_column("owner_id")

    with op.batch_alter_table("person") as b:
        b.drop_constraint("uq_person_owner_sage_name", type_="unique")
        b.drop_index("ix_person_owner_id")
        b.drop_index("ix_person_sage_employee_name")
        b.create_index("ix_person_sage_employee_name", ["sage_employee_name"], unique=True)
        b.drop_constraint("fk_person_owner", type_="foreignkey")
        b.drop_column("owner_id")

    with op.batch_alter_table("project") as b:
        b.drop_constraint("uq_project_owner_number", type_="unique")
        b.drop_index("ix_project_owner_id")
        b.drop_index("ix_project_project_number")
        b.create_index("ix_project_project_number", ["project_number"], unique=True)
        b.drop_constraint("fk_project_owner", type_="foreignkey")
        b.drop_column("owner_id")

    with op.batch_alter_table("program") as b:
        b.drop_constraint("uq_program_owner_number", type_="unique")
        b.drop_index("ix_program_owner_id")
        b.drop_index("ix_program_program_number")
        b.create_index("ix_program_program_number", ["program_number"], unique=True)
        b.drop_constraint("fk_program_owner", type_="foreignkey")
        b.drop_column("owner_id")

    op.drop_index("ix_invite_token_token", table_name="invite_token")
    op.drop_table("invite_token")
    op.drop_index("ix_user_email", table_name="user")
    op.drop_table("user")
