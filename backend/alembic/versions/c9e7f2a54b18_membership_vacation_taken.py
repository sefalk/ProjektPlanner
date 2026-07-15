"""Per-membership already-taken vacation days

Revision ID: c9e7f2a54b18
Revises: b8f2a1e34d05
Create Date: 2026-07-15

Adds:
  * project_membership.vacation_days_taken — flat project-specific already-taken vacation
    days, subtracted from the yearly contingent in this project's vacation estimate.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9e7f2a54b18"
down_revision: Union[str, None] = "b8f2a1e34d05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(project_membership)"))}
    if "vacation_days_taken" not in cols:
        op.add_column(
            "project_membership",
            sa.Column("vacation_days_taken", sa.Float(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    op.drop_column("project_membership", "vacation_days_taken")
