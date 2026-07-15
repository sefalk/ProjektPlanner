"""Milestone target budget: explicit monthly € target synced with external billing

Revision ID: e2b5c9d81f47
Revises: d1a4f7c20933
Create Date: 2026-07-14

Adds:
  * milestone.target_budget_euros — explicit monthly € target (None = derived from the
    global budget distribution). When set, the month's hours are redistributed to hit it.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2b5c9d81f47"
down_revision: Union[str, None] = "d1a4f7c20933"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(milestone)"))}
    if "target_budget_euros" not in cols:
        op.add_column(
            "milestone",
            sa.Column("target_budget_euros", sa.Float(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("milestone", "target_budget_euros")
