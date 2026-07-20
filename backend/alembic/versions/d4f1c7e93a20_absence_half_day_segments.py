"""PersonAbsence half-day segments (start_segment/end_segment) — doc #40

Adds two columns to person_absence so an absence can cover only part of its start
and/or end day (half days). Values: 'full' (default), 'morning' (Vormittag),
'afternoon' (Nachmittag). A half segment counts 0.5 working days.

Note: runtime/tests build the schema via SQLModel.metadata.create_all; this migration
keeps the Alembic chain in sync for migration-built databases. Existing rows default
to 'full' (unchanged behaviour).

Revision ID: d4f1c7e93a20
Revises: c3e0a6b28d71
Create Date: 2026-07-20
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4f1c7e93a20"
down_revision: Union[str, None] = "c3e0a6b28d71"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def upgrade() -> None:
    conn = op.get_bind()
    existing = _cols(conn, "person_absence")
    if "start_segment" not in existing:
        op.add_column(
            "person_absence",
            sa.Column("start_segment", sa.String(), nullable=False, server_default="full"),
        )
    if "end_segment" not in existing:
        op.add_column(
            "person_absence",
            sa.Column("end_segment", sa.String(), nullable=False, server_default="full"),
        )


def downgrade() -> None:
    op.drop_column("person_absence", "end_segment")
    op.drop_column("person_absence", "start_segment")
