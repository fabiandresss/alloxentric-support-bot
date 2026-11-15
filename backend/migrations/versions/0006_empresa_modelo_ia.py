"""empresas.modelo_ia: modelo de IA (Bedrock) que usa el agente de cada empresa

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # las empresas existentes quedan con el modelo por defecto (Claude Haiku 5.5)
    op.add_column('empresas', sa.Column('modelo_ia', sa.String(length=40), nullable=False, server_default='haiku-5-5'))


def downgrade() -> None:
    op.drop_column('empresas', 'modelo_ia')
