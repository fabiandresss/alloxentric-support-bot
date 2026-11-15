"""FinOps: plan de gasto por empresa y registro de consumo de IA (usos_ia)

Revision ID: 0007
Revises: 0006
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('empresas', sa.Column('plan_gasto', sa.String(length=12), nullable=False, server_default='sin_limite'))
    op.add_column('empresas', sa.Column('limite_mensual_usd', sa.Numeric(10, 2), nullable=True))
    op.create_table(
        'usos_ia',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('empresa_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('empresas.id', ondelete='CASCADE'), nullable=False),
        sa.Column('conversacion_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('conversaciones.id', ondelete='SET NULL'), nullable=True),
        sa.Column('modelo', sa.String(length=40), nullable=False),
        sa.Column('tipo', sa.String(length=12), nullable=False, server_default='respuesta'),
        sa.Column('tokens_entrada', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tokens_salida', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('costo_usd', sa.Numeric(12, 6), nullable=False, server_default='0'),
        sa.Column('creado_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_usos_ia_empresa_id', 'usos_ia', ['empresa_id'])
    op.create_index('ix_usos_ia_conversacion_id', 'usos_ia', ['conversacion_id'])
    op.create_index('ix_usos_ia_empresa_fecha', 'usos_ia', ['empresa_id', 'creado_en'])


def downgrade() -> None:
    op.drop_table('usos_ia')
    op.drop_column('empresas', 'limite_mensual_usd')
    op.drop_column('empresas', 'plan_gasto')
