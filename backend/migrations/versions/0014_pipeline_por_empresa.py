"""Ajustes del pipeline de ingesta y recuperación por empresa (chunking, top-k, búsqueda híbrida, OCR)

Revision ID: 0014
Revises: 0013
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0014'
down_revision: Union[str, Sequence[str], None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('empresas', sa.Column('pipeline', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'))


def downgrade() -> None:
    op.drop_column('empresas', 'pipeline')
