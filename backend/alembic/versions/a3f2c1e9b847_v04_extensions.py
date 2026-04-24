"""v0.4 data model extensions

Revision ID: a3f2c1e9b847
Revises: 70f1bb6b1257
Create Date: 2026-04-23 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = 'a3f2c1e9b847'
down_revision: Union[str, None] = '70f1bb6b1257'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project', sa.Column('total_budget_euros', sa.Float(), nullable=True))
    op.add_column('person', sa.Column('work_week_pattern', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('person', sa.Column('default_billing_rate', sa.Float(), nullable=True))
    op.create_table(
        'setting',
        sa.Column('key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('value', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )
    op.execute("INSERT INTO setting (key, value) VALUES ('default_vacation_days', '30')")


def downgrade() -> None:
    op.drop_table('setting')
    op.drop_column('person', 'default_billing_rate')
    op.drop_column('person', 'work_week_pattern')
    op.drop_column('project', 'total_budget_euros')
