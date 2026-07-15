"""Project line items (Projektposten): position rate, member/booking links, level mapping

Revision ID: d4a8c1f60e29
Revises: c9e7f2a54b18
Create Date: 2026-07-15

Adds (WP1 of docs/implementation/21-project-line-items.md):
  * billing_position.billing_rate_per_hour   — hourly rate of the line item (0 = none)
  * project_membership.billing_position_id   — member → assigned line item (nullable)
  * time_booking.billing_position_id         — booking → line item (nullable)
  * table sage_position_mapping              — (project, sage_project_level) → line item
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4a8c1f60e29"
down_revision: Union[str, None] = "c9e7f2a54b18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def upgrade() -> None:
    conn = op.get_bind()

    if "billing_rate_per_hour" not in _cols(conn, "billing_position"):
        op.add_column(
            "billing_position",
            sa.Column("billing_rate_per_hour", sa.Float(), nullable=False, server_default="0"),
        )
    # NB: FKs are omitted on ALTER ADD COLUMN — SQLite cannot add a constraint to an
    # existing table (batch mode would rebuild it). The relationship is declared on the
    # SQLModel classes; SQLite does not enforce these FKs at the DB level regardless.
    if "billing_position_id" not in _cols(conn, "project_membership"):
        op.add_column(
            "project_membership",
            sa.Column("billing_position_id", sa.Integer(), nullable=True),
        )
    if "billing_position_id" not in _cols(conn, "time_booking"):
        op.add_column(
            "time_booking",
            sa.Column("billing_position_id", sa.Integer(), nullable=True),
        )

    existing = {row[0] for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'"))}
    if "sage_position_mapping" not in existing:
        op.create_table(
            "sage_position_mapping",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id"), nullable=False, index=True),
            sa.Column("sage_project_level", sa.String(), nullable=False),
            sa.Column("billing_position_id", sa.Integer(), sa.ForeignKey("billing_position.id"), nullable=False, index=True),
            sa.UniqueConstraint("project_id", "sage_project_level", name="uq_sage_position_project_level"),
        )


def downgrade() -> None:
    op.drop_table("sage_position_mapping")
    op.drop_column("time_booking", "billing_position_id")
    op.drop_column("project_membership", "billing_position_id")
    op.drop_column("billing_position", "billing_rate_per_hour")
