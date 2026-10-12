"""tickets: el agente asignado pasa de texto libre a un usuario real

Revision ID: 0003
Revises: 0002
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tickets', sa.Column('agente_asignado_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_tickets_agente_asignado', 'tickets', 'usuarios',
                          ['agente_asignado_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_tickets_agente_asignado_id', 'tickets', ['agente_asignado_id'])
    # los nombres que coincidan con un usuario de la misma empresa se conservan; el resto queda sin asignar
    op.execute("""
        UPDATE tickets t SET agente_asignado_id = u.id
        FROM usuarios u
        WHERE t.agente_asignado IS NOT NULL AND u.empresa_id = t.empresa_id AND u.nombre = t.agente_asignado
    """)
    op.drop_column('tickets', 'agente_asignado')


def downgrade() -> None:
    op.add_column('tickets', sa.Column('agente_asignado', sa.String(length=120), nullable=True))
    op.execute("UPDATE tickets t SET agente_asignado = u.nombre FROM usuarios u WHERE u.id = t.agente_asignado_id")
    op.drop_index('ix_tickets_agente_asignado_id', table_name='tickets')
    op.drop_constraint('fk_tickets_agente_asignado', 'tickets', type_='foreignkey')
    op.drop_column('tickets', 'agente_asignado_id')
