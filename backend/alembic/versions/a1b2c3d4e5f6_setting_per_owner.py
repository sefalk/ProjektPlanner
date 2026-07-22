"""Per-owner settings: rebuild `setting` with a surrogate id + owner_id (doc 25, WP3 step 3b)

Settings become per-user. The `setting` table is rebuilt from a globally-unique
``key`` PK to:
    id      INTEGER PRIMARY KEY
    owner_id INTEGER  -> user.id  (nullable, indexed)
    key     TEXT NOT NULL (indexed)
    value   TEXT NOT NULL
    UNIQUE(owner_id, key)

so every owner keeps their own copy of the defaults. Per the multi-user epic's
fresh-DB decision, any pre-existing global rows are dropped — they are just the
re-seedable defaults and are re-created per owner on first access
(``db.ensure_owner_settings``). No global startup seeding remains.

Note: runtime/tests build the schema via SQLModel.metadata.create_all; the hosted
deployment builds it via `alembic upgrade head`, so this migration is the
schema-of-record for production.

Revision ID: a1b2c3d4e5f6
Revises: e7a1c9d2f3b4
Create Date: 2026-07-22
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "e7a1c9d2f3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables(conn) -> set[str]:
    return {
        row[0]
        for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'"))
    }


def upgrade() -> None:
    conn = op.get_bind()
    if "setting" in _tables(conn):
        op.drop_table("setting")
    op.create_table(
        "setting",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], name="fk_setting_owner"),
        sa.UniqueConstraint("owner_id", "key", name="uq_setting_owner_key"),
    )
    op.create_index("ix_setting_owner_id", "setting", ["owner_id"])
    op.create_index("ix_setting_key", "setting", ["key"])


def downgrade() -> None:
    conn = op.get_bind()
    if "setting" in _tables(conn):
        op.drop_index("ix_setting_key", table_name="setting")
        op.drop_index("ix_setting_owner_id", table_name="setting")
        op.drop_table("setting")
    op.create_table(
        "setting",
        sa.Column("key", sa.String(), primary_key=True, nullable=False),
        sa.Column("value", sa.String(), nullable=False),
    )
