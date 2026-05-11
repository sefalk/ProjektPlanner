"""swap budget required: hours optional, euros required

Revision ID: c9d2e1f3a456
Revises: b7e3d4f5c012
Create Date: 2026-04-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "c9d2e1f3a456"
down_revision = "b7e3d4f5c012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("project") as batch_op:
        # total_budget_hours becomes optional
        batch_op.alter_column(
            "total_budget_hours",
            existing_type=sa.Float(),
            nullable=True,
        )

    # Backfill any NULLs in total_budget_euros before enforcing NOT NULL
    op.execute("UPDATE project SET total_budget_euros = 0 WHERE total_budget_euros IS NULL")

    with op.batch_alter_table("project") as batch_op:
        batch_op.alter_column(
            "total_budget_euros",
            existing_type=sa.Float(),
            nullable=False,
        )


def downgrade() -> None:
    # Backfill total_budget_hours NULLs before re-enforcing NOT NULL
    op.execute("UPDATE project SET total_budget_hours = 0 WHERE total_budget_hours IS NULL")

    with op.batch_alter_table("project") as batch_op:
        batch_op.alter_column(
            "total_budget_hours",
            existing_type=sa.Float(),
            nullable=False,
        )
        batch_op.alter_column(
            "total_budget_euros",
            existing_type=sa.Float(),
            nullable=True,
        )
