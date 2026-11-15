"""Pruebas del agente: modelo juez (LLM as a Judge) por corrida y modelo generador por conjunto

Revision ID: 0009
Revises: 0008
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # las corridas que ya existen se evaluaron con Haiku 5.5 (el juez por defecto)
    op.add_column('ejecuciones_prueba', sa.Column('modelo_juez', sa.String(length=40), nullable=False, server_default='haiku-5-5'))
    op.add_column('conjuntos_prueba', sa.Column('generado_con', sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column('conjuntos_prueba', 'generado_con')
    op.drop_column('ejecuciones_prueba', 'modelo_juez')
