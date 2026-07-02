"""Milestone rework: membership priority + budget manual-override flag

Revision ID: d1a4f7c20933
Revises: c9d2e1f3a456
Create Date: 2026-07-02

Adds:
  * project_membership.priority        — B6, project-specific budget-distribution priority
  * milestone_person_budget.is_manual_override — V5, preserve manual edits on resync
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d1a4f7c20933"
down_revision: Union[str, None] = "c9d2e1f3a456"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    pm_cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(project_membership)"))}
    if "priority" not in pm_cols:
        op.add_column(
            "project_membership",
            sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        )

    mpb_cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(milestone_person_budget)"))}
    if "is_manual_override" not in mpb_cols:
        op.add_column(
            "milestone_person_budget",
            sa.Column("is_manual_override", sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    op.drop_column("milestone_person_budget", "is_manual_override")
    op.drop_column("project_membership", "priority")
