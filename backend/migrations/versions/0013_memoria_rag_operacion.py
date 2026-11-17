"""Memoria del agente (resumen, cliente que vuelve, propuestas de FAQ), RAG (página del fragmento, texto completo), advertencia de documentos,
caché de respuestas y trazas de latencia/errores en usos_ia

Revision ID: 0013
Revises: 0012
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector

revision: str = '0013'
down_revision: Union[str, Sequence[str], None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _empresa():
    return sa.Column('empresa_id', UUID, sa.ForeignKey('empresas.id', ondelete='CASCADE'), nullable=False)


def upgrade() -> None:
    op.add_column('conversaciones', sa.Column('visitante_id', sa.String(length=64), nullable=True))
    op.create_index('ix_conversaciones_visitante_id', 'conversaciones', ['visitante_id'])
    op.add_column('conversaciones', sa.Column('resumen_memoria', sa.Text(), nullable=True))
    op.add_column('conversaciones', sa.Column('memoria_hasta', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('fragmentos_embeddings', sa.Column('pagina', sa.Integer(), nullable=True))
    op.add_column('documentos', sa.Column('advertencia', sa.String(length=200), nullable=True))
    op.add_column('usos_ia', sa.Column('latencia_ms', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('usos_ia', sa.Column('exito', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('usos_ia', sa.Column('error', sa.String(length=60), nullable=True))
    op.add_column('usos_ia', sa.Column('respaldo', sa.Boolean(), nullable=False, server_default=sa.false()))

    op.create_table(
        'perfiles_cliente',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('visitante_id', sa.String(length=64), nullable=False),
        sa.Column('nombre', sa.String(length=80), nullable=True),
        sa.Column('temas', postgresql.JSONB(), nullable=False),
        sa.Column('conversaciones', sa.Integer(), nullable=False),
        sa.Column('creado_en', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ultima_en', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_perfiles_cliente_empresa_id', 'perfiles_cliente', ['empresa_id'])
    op.create_index('uq_perfiles_cliente', 'perfiles_cliente', ['empresa_id', 'visitante_id'], unique=True)

    op.create_table(
        'propuestas_faq',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('ticket_id', UUID, sa.ForeignKey('tickets.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('pregunta', sa.Text(), nullable=False),
        sa.Column('respuesta', sa.Text(), nullable=False),
        sa.Column('estado', sa.String(length=10), nullable=False),
        sa.Column('documento_id', UUID, sa.ForeignKey('documentos.id', ondelete='SET NULL'), nullable=True),
        sa.Column('creada_en', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resuelta_en', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_propuestas_faq_empresa_id', 'propuestas_faq', ['empresa_id'])

    op.create_table(
        'cache_respuestas',
        sa.Column('id', UUID, primary_key=True), _empresa(),
        sa.Column('modelo', sa.String(length=40), nullable=False),
        sa.Column('version', sa.String(length=80), nullable=False),
        sa.Column('pregunta', sa.Text(), nullable=False),
        sa.Column('embedding', Vector(384), nullable=False),
        sa.Column('respuesta', sa.Text(), nullable=False),
        sa.Column('fuentes', postgresql.JSONB(), nullable=True),
        sa.Column('fuentes_detalle', postgresql.JSONB(), nullable=True),
        sa.Column('confianza', sa.Float(), nullable=False),
        sa.Column('aciertos', sa.Integer(), nullable=False),
        sa.Column('creada_en', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_cache_respuestas_empresa_id', 'cache_respuestas', ['empresa_id'])
    op.create_index('ix_cache_respuestas_creada_en', 'cache_respuestas', ['creada_en'])

    # búsqueda por palabras clave (RAG híbrido): texto completo en español, sin tildes (la misma expresión que usa services/hibrido.py)
    op.execute("CREATE INDEX ix_fragmentos_fts ON fragmentos_embeddings USING gin "
               "(to_tsvector('spanish', translate(lower(texto), 'áéíóúüñ', 'aeiouun')))")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_fragmentos_fts")
    op.drop_table('cache_respuestas')
    op.drop_table('propuestas_faq')
    op.drop_table('perfiles_cliente')
    for c in ('respaldo', 'error', 'exito', 'latencia_ms'):
        op.drop_column('usos_ia', c)
    op.drop_column('documentos', 'advertencia')
    op.drop_column('fragmentos_embeddings', 'pagina')
    for c in ('memoria_hasta', 'resumen_memoria'):
        op.drop_column('conversaciones', c)
    op.drop_index('ix_conversaciones_visitante_id', table_name='conversaciones')
    op.drop_column('conversaciones', 'visitante_id')
