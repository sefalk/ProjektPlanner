"""BillingPosition.overrunnable — asymmetric position overrun (doc 23, WP3)

Adds a boolean flag: False (default) = hard-capped position (never planned past budget),
True = cheap/overrunnable position (the automatic distribution may fund it beyond budget).

Note: runtime/tests build the schema via SQLModel.metadata.create_all; this migration keeps
the Alembic chain in sync for migration-built databases.

Revision ID: c3e0a6b28d71
Revises: b2d9f4a17c60
Create Date: 2026-07-17
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3e0a6b28d71"
down_revision: Union[str, None] = "b2d9f4a17c60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def upgrade() -> None:
    conn = op.get_bind()
    if "overrunnable" not in _cols(conn, "billing_position"):
        op.add_column(
            "billing_position",
            sa.Column("overrunnable", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    op.drop_column("billing_position", "overrunnable")
