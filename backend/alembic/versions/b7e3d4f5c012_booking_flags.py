"""Add booking flag/exclusion fields to time_booking

Revision ID: b7e3d4f5c012
Revises: a3f2c1e9b847
Create Date: 2026-04-28 08:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b7e3d4f5c012'
down_revision: Union[str, None] = 'a3f2c1e9b847'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    tb_cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(time_booking)"))}

    if 'note' not in tb_cols:
        op.add_column('time_booking', sa.Column('note', sa.String(), nullable=False, server_default=''))
    if 'is_excluded' not in tb_cols:
        op.add_column('time_booking', sa.Column('is_excluded', sa.Boolean(), nullable=False, server_default='0'))
    if 'exclusion_reason' not in tb_cols:
        op.add_column('time_booking', sa.Column('exclusion_reason', sa.String(), nullable=True))
    if 'exclusion_note' not in tb_cols:
        op.add_column('time_booking', sa.Column('exclusion_note', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('time_booking', 'exclusion_note')
    op.drop_column('time_booking', 'exclusion_reason')
    op.drop_column('time_booking', 'is_excluded')
    op.drop_column('time_booking', 'note')
