"""Person holiday-region override — per-MA country/state (§22 WP6)

Revision ID: f7a3b9c14d20
Revises: e5b9d2c73a41
Create Date: 2026-07-16
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f7a3b9c14d20"
down_revision: Union[str, None] = "e5b9d2c73a41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def upgrade() -> None:
    conn = op.get_bind()
    existing = _cols(conn, "person")
    if "holiday_country" not in existing:
        op.add_column("person", sa.Column("holiday_country", sa.String(), nullable=True))
    if "holiday_state" not in existing:
        op.add_column("person", sa.Column("holiday_state", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("person", "holiday_state")
    op.drop_column("person", "holiday_country")
