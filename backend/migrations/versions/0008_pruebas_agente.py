"""Pruebas del agente: conjuntos (golden sets), casos, ejecuciones y resultados

Revision ID: 0008
Revises: 0007
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _empresa():
    return sa.Column('empresa_id', UUID, sa.ForeignKey('empresas.id', ondelete='CASCADE'), nullable=False)


def upgrade() -> None:
    op.create_table(
        'conjuntos_prueba',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('nombre', sa.String(length=120), nullable=False),
        sa.Column('descripcion', sa.Text(), nullable=True),
        sa.Column('creado_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('actualizado_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_conjuntos_prueba_empresa_id', 'conjuntos_prueba', ['empresa_id'])

    op.create_table(
        'casos_prueba',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('conjunto_id', UUID, sa.ForeignKey('conjuntos_prueba.id', ondelete='CASCADE'), nullable=False),
        sa.Column('orden', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('pregunta', sa.Text(), nullable=False),
        sa.Column('respuesta_esperada', sa.Text(), nullable=True),
        sa.Column('documento_esperado', sa.String(length=255), nullable=True),
        sa.Column('debe_derivar', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('origen', sa.String(length=10), nullable=False, server_default='manual'),
        sa.Column('creado_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_casos_prueba_empresa_id', 'casos_prueba', ['empresa_id'])
    op.create_index('ix_casos_prueba_conjunto_id', 'casos_prueba', ['conjunto_id'])

    op.create_table(
        'ejecuciones_prueba',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('conjunto_id', UUID, sa.ForeignKey('conjuntos_prueba.id', ondelete='CASCADE'), nullable=False),
        sa.Column('conjunto_nombre', sa.String(length=120), nullable=False),
        sa.Column('modelo_ia', sa.String(length=40), nullable=False),
        sa.Column('umbral_rag', sa.Float(), nullable=False),
        sa.Column('estado', sa.String(length=12), nullable=False, server_default='ejecutando'),
        sa.Column('total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('completados', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('kb', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('resumen', postgresql.JSONB(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('creada_por', sa.String(length=160), nullable=True),
        sa.Column('iniciada_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('terminada_en', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_ejecuciones_prueba_empresa_id', 'ejecuciones_prueba', ['empresa_id'])
    op.create_index('ix_ejecuciones_prueba_conjunto_id', 'ejecuciones_prueba', ['conjunto_id'])

    op.create_table(
        'resultados_prueba',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('ejecucion_id', UUID, sa.ForeignKey('ejecuciones_prueba.id', ondelete='CASCADE'), nullable=False),
        sa.Column('caso_id', UUID, sa.ForeignKey('casos_prueba.id', ondelete='SET NULL'), nullable=True),
        sa.Column('orden', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('pregunta', sa.Text(), nullable=False),
        sa.Column('respuesta_esperada', sa.Text(), nullable=True),
        sa.Column('documento_esperado', sa.String(length=255), nullable=True),
        sa.Column('debe_derivar', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('respuesta', sa.Text(), nullable=False, server_default=''),
        sa.Column('derivo', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('fuentes', postgresql.JSONB(), nullable=True),
        sa.Column('confianza', sa.Float(), nullable=True),
        sa.Column('latencia_ms', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tokens_entrada', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tokens_salida', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('costo_usd', sa.Numeric(12, 6), nullable=False, server_default='0'),
        sa.Column('fuente_ok', sa.Boolean(), nullable=True),
        sa.Column('derivacion_ok', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('puntaje', sa.Float(), nullable=True),
        sa.Column('veredicto', sa.String(length=10), nullable=False, server_default='fallido'),
        sa.Column('motivo', sa.Text(), nullable=True),
    )
    op.create_index('ix_resultados_prueba_empresa_id', 'resultados_prueba', ['empresa_id'])
    op.create_index('ix_resultados_prueba_ejecucion_id', 'resultados_prueba', ['ejecucion_id'])
    op.create_index('ix_resultados_prueba_caso_id', 'resultados_prueba', ['caso_id'])


def downgrade() -> None:
    op.drop_table('resultados_prueba')
    op.drop_table('ejecuciones_prueba')
    op.drop_table('casos_prueba')
    op.drop_table('conjuntos_prueba')
