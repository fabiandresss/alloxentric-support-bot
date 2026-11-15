"""Ciclo de calidad: notificaciones, límite diario, dominios del widget, versiones de documentos, comparativas y calibración del juez

Revision ID: 0010
Revises: 0009
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0010'
down_revision: Union[str, Sequence[str], None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _empresa():
    return sa.Column('empresa_id', UUID, sa.ForeignKey('empresas.id', ondelete='CASCADE'), nullable=False)


def upgrade() -> None:
    op.add_column('empresas', sa.Column('limite_diario_usd', sa.Numeric(10, 2), nullable=True))
    op.add_column('empresas', sa.Column('dominios_permitidos', postgresql.JSONB(), nullable=False, server_default='[]'))
    op.add_column('documentos', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('conjuntos_prueba', sa.Column('auto_ejecutar', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('casos_prueba', sa.Column('conversacion_id', UUID, sa.ForeignKey('conversaciones.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_casos_prueba_conversacion_id', 'casos_prueba', ['conversacion_id'])
    op.add_column('ejecuciones_prueba', sa.Column('grupo_id', UUID, nullable=True))
    op.create_index('ix_ejecuciones_prueba_grupo_id', 'ejecuciones_prueba', ['grupo_id'])
    op.add_column('ejecuciones_prueba', sa.Column('origen', sa.String(length=12), nullable=False, server_default='manual'))
    op.add_column('ejecuciones_prueba', sa.Column('disparador', sa.Text(), nullable=True))
    op.add_column('resultados_prueba', sa.Column('etiqueta_humana', sa.String(length=10), nullable=True))

    op.create_table(
        'notificaciones',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('tipo', sa.String(length=24), nullable=False),
        sa.Column('titulo', sa.String(length=160), nullable=False),
        sa.Column('mensaje', sa.Text(), nullable=False),
        sa.Column('vista', sa.String(length=20), nullable=True),
        sa.Column('ref', sa.String(length=60), nullable=True),
        sa.Column('clave', sa.String(length=120), nullable=False),
        sa.Column('creada_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('vista_en', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_notificaciones_empresa_id', 'notificaciones', ['empresa_id'])
    op.create_index('uq_notificaciones_clave', 'notificaciones', ['empresa_id', 'clave'], unique=True)

    op.create_table(
        'documento_versiones',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('documento_id', UUID, sa.ForeignKey('documentos.id', ondelete='CASCADE'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=255), nullable=False),
        sa.Column('tipo', sa.String(length=10), nullable=False),
        sa.Column('tamano_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('ruta_local', sa.String(length=500), nullable=False),
        sa.Column('num_fragmentos', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('subido_en', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reemplazada_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_documento_versiones_empresa_id', 'documento_versiones', ['empresa_id'])
    op.create_index('ix_documento_versiones_documento_id', 'documento_versiones', ['documento_id'])

    op.create_table(
        'calibraciones_juez',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('estado', sa.String(length=12), nullable=False, server_default='ejecutando'),
        sa.Column('modelos', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('etiquetados', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('completados', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('resumen', postgresql.JSONB(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('creada_por', sa.String(length=160), nullable=True),
        sa.Column('iniciada_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('terminada_en', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_calibraciones_juez_empresa_id', 'calibraciones_juez', ['empresa_id'])


def downgrade() -> None:
    op.drop_table('calibraciones_juez')
    op.drop_table('documento_versiones')
    op.drop_table('notificaciones')
    op.drop_column('resultados_prueba', 'etiqueta_humana')
    op.drop_column('ejecuciones_prueba', 'disparador')
    op.drop_column('ejecuciones_prueba', 'origen')
    op.drop_index('ix_ejecuciones_prueba_grupo_id', table_name='ejecuciones_prueba')
    op.drop_column('ejecuciones_prueba', 'grupo_id')
    op.drop_index('ix_casos_prueba_conversacion_id', table_name='casos_prueba')
    op.drop_column('casos_prueba', 'conversacion_id')
    op.drop_column('conjuntos_prueba', 'auto_ejecutar')
    op.drop_column('documentos', 'version')
    op.drop_column('empresas', 'dominios_permitidos')
    op.drop_column('empresas', 'limite_diario_usd')
