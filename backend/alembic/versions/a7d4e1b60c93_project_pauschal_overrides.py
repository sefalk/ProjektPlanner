"""Per-project sick/training richtwert overrides

Revision ID: a7d4e1b60c93
Revises: f3c6d0a92e18
Create Date: 2026-07-15

Adds:
  * project.sick_days_per_year_override      — None = global setting, value (0 = off) overrides
  * project.training_days_per_year_override  — None = global setting, value (0 = off) overrides
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a7d4e1b60c93"
down_revision: Union[str, None] = "f3c6d0a92e18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(project)"))}
    if "sick_days_per_year_override" not in cols:
        op.add_column("project", sa.Column("sick_days_per_year_override", sa.Float(), nullable=True))
    if "training_days_per_year_override" not in cols:
        op.add_column("project", sa.Column("training_days_per_year_override", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("project", "training_days_per_year_override")
    op.drop_column("project", "sick_days_per_year_override")
