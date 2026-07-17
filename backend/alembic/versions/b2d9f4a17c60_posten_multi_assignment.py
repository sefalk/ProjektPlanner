"""Posten multi-assignment — MA may hold multiple positions per project (doc 23, WP1)

Adds milestone_person_budget.billing_position_id and widens the per-row unique key
to (milestone_id, person_id, billing_position_id); adds the composite unique key
(project_id, person_id, billing_position_id) on project_membership so a person can be
assigned to several line items of the same project.

Note: runtime/tests build the schema via SQLModel.metadata.create_all; this migration
keeps the Alembic chain (schema-of-record) in sync for migration-built databases.

Revision ID: b2d9f4a17c60
Revises: f7a3b9c14d20
Create Date: 2026-07-17
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2d9f4a17c60"
down_revision: Union[str, None] = "f7a3b9c14d20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def _index_names(conn) -> set[str]:
    return {
        row[0]
        for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='index'"))
    }


def upgrade() -> None:
    conn = op.get_bind()

    # milestone_person_budget: add billing_position_id + widen unique key.
    if "billing_position_id" not in _cols(conn, "milestone_person_budget"):
        with op.batch_alter_table("milestone_person_budget") as batch_op:
            batch_op.add_column(
                sa.Column("billing_position_id", sa.Integer(), nullable=True)
            )
            batch_op.create_foreign_key(
                "fk_mpb_billing_position", "billing_position",
                ["billing_position_id"], ["id"],
            )
            batch_op.drop_constraint("uq_mpb_milestone_person", type_="unique")
            batch_op.create_unique_constraint(
                "uq_mpb_milestone_person_position",
                ["milestone_id", "person_id", "billing_position_id"],
            )
        op.create_index(
            op.f("ix_milestone_person_budget_billing_position_id"),
            "milestone_person_budget", ["billing_position_id"], unique=False,
        )

    # project_membership: add the composite unique key (none existed before).
    if "uq_membership_project_person_position" not in _index_names(conn):
        with op.batch_alter_table("project_membership") as batch_op:
            batch_op.create_unique_constraint(
                "uq_membership_project_person_position",
                ["project_id", "person_id", "billing_position_id"],
            )


def downgrade() -> None:
    with op.batch_alter_table("project_membership") as batch_op:
        batch_op.drop_constraint(
            "uq_membership_project_person_position", type_="unique"
        )
    op.drop_index(
        op.f("ix_milestone_person_budget_billing_position_id"),
        table_name="milestone_person_budget",
    )
    with op.batch_alter_table("milestone_person_budget") as batch_op:
        batch_op.drop_constraint("uq_mpb_milestone_person_position", type_="unique")
        batch_op.drop_constraint("fk_mpb_billing_position", type_="foreignkey")
        batch_op.create_unique_constraint(
            "uq_mpb_milestone_person", ["milestone_id", "person_id"]
        )
        batch_op.drop_column("billing_position_id")
