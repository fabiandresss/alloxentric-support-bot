"""ciclo de vida del ticket con encuesta de resolución

Estados nuevos: esperando_cliente, cerrado, escalado (el antiguo `resuelto` pasa a `cerrado`).

Revision ID: 0004
Revises: 0003
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tickets', sa.Column('encuesta_enviada_en', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tickets', sa.Column('cierre_motivo', sa.String(length=30), nullable=True))
    op.create_index('ix_tickets_estado_encuesta', 'tickets', ['estado', 'encuesta_enviada_en'])
    # lo que estaba "resuelto" bajo el modelo anterior queda cerrado
    op.execute("""
        UPDATE tickets
        SET estado = 'cerrado', cierre_motivo = 'migrado', encuesta_enviada_en = actualizado_en
        WHERE estado = 'resuelto'
    """)


def downgrade() -> None:
    op.execute("UPDATE tickets SET estado = 'resuelto' WHERE estado IN ('cerrado', 'esperando_cliente', 'escalado')")
    op.drop_index('ix_tickets_estado_encuesta', table_name='tickets')
    op.drop_column('tickets', 'cierre_motivo')
    op.drop_column('tickets', 'encuesta_enviada_en')
