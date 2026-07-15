"""Milestone planning lock (frozen but not closed)

Revision ID: b8f2a1e34d05
Revises: a7d4e1b60c93
Create Date: 2026-07-15

Adds:
  * milestone.is_planning_locked — when True the recompute ("Neu berechnen") leaves the
    whole month untouched, without it being invoiced/closed.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8f2a1e34d05"
down_revision: Union[str, None] = "a7d4e1b60c93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(milestone)"))}
    if "is_planning_locked" not in cols:
        op.add_column(
            "milestone",
            sa.Column("is_planning_locked", sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    op.drop_column("milestone", "is_planning_locked")
