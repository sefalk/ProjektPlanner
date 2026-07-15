"""Estimated-absence override on milestone person budget

Revision ID: f3c6d0a92e18
Revises: e2b5c9d81f47
Create Date: 2026-07-15

Adds:
  * milestone_person_budget.estimated_absence_days_override — manual (locked) override
    for the estimated unplanned absence days of a person/month (None = auto-estimate).
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f3c6d0a92e18"
down_revision: Union[str, None] = "e2b5c9d81f47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(milestone_person_budget)"))}
    if "estimated_absence_days_override" not in cols:
        op.add_column(
            "milestone_person_budget",
            sa.Column("estimated_absence_days_override", sa.Float(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("milestone_person_budget", "estimated_absence_days_override")
