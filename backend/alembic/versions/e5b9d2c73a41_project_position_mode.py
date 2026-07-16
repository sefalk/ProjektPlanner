"""Project.position_mode — explicit Projektposten-Modus toggle (§21 WP8)

Revision ID: e5b9d2c73a41
Revises: d4a8c1f60e29
Create Date: 2026-07-16
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5b9d2c73a41"
down_revision: Union[str, None] = "d4a8c1f60e29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def upgrade() -> None:
    conn = op.get_bind()
    if "position_mode" not in _cols(conn, "project"):
        op.add_column(
            "project",
            sa.Column("position_mode", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    op.drop_column("project", "position_mode")
