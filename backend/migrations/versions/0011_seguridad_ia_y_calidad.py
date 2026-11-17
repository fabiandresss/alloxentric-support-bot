"""Seguridad de la IA (config y eventos), valoración de respuestas, fuentes con fragmento, resumen del ticket y horario de atención

Revision ID: 0011
Revises: 0010
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0011'
down_revision: Union[str, Sequence[str], None] = '0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column('empresas', sa.Column('seguridad', postgresql.JSONB(), nullable=False, server_default='{}'))
    op.add_column('empresas', sa.Column('horario', postgresql.JSONB(), nullable=False, server_default='{}'))
    op.add_column('mensajes', sa.Column('fuentes_detalle', postgresql.JSONB(), nullable=True))
    op.add_column('mensajes', sa.Column('valoracion', sa.String(length=6), nullable=True))
    op.add_column('mensajes', sa.Column('valoracion_comentario', sa.String(length=500), nullable=True))
    op.add_column('mensajes', sa.Column('valoracion_en', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tickets', sa.Column('resumen_ia', postgresql.JSONB(), nullable=True))
    op.create_table(
        'eventos_seguridad',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('empresa_id', UUID, sa.ForeignKey('empresas.id', ondelete='CASCADE'), nullable=False),
        sa.Column('conversacion_id', UUID, sa.ForeignKey('conversaciones.id', ondelete='SET NULL'), nullable=True),
        sa.Column('tipo', sa.String(length=28), nullable=False),
        sa.Column('severidad', sa.String(length=6), nullable=False, server_default='media'),
        sa.Column('detalle', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('senales', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('creado_en', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_eventos_seguridad_empresa_id', 'eventos_seguridad', ['empresa_id'])
    op.create_index('ix_eventos_seguridad_conversacion_id', 'eventos_seguridad', ['conversacion_id'])
    op.create_index('ix_eventos_seguridad_creado_en', 'eventos_seguridad', ['creado_en'])


def downgrade() -> None:
    op.drop_table('eventos_seguridad')
    op.drop_column('tickets', 'resumen_ia')
    for c in ('valoracion_en', 'valoracion_comentario', 'valoracion', 'fuentes_detalle'):
        op.drop_column('mensajes', c)
    op.drop_column('empresas', 'horario')
    op.drop_column('empresas', 'seguridad')
