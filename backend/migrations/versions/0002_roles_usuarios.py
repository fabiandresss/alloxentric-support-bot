"""roles de usuario: superadmin, admin_empresa, encargado_tickets, encargado_agente

Revision ID: 0002
Revises: 0001
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('usuarios', sa.Column('nombre', sa.String(120), nullable=False, server_default=''))
    op.add_column('usuarios', sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('usuarios', sa.Column('creado_en', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.alter_column('usuarios', 'empresa_id', existing_type=sa.UUID(), nullable=True)
    op.execute("UPDATE usuarios SET rol = 'admin_empresa' WHERE rol = 'admin'")
    op.alter_column('usuarios', 'rol', server_default=None)
    op.create_check_constraint('ck_usuarios_rol', 'usuarios',
        "rol IN ('superadmin','admin_empresa','encargado_tickets','encargado_agente')")
    op.create_check_constraint('ck_usuarios_superadmin_sin_empresa', 'usuarios',
        "(rol = 'superadmin') = (empresa_id IS NULL)")


def downgrade() -> None:
    op.drop_constraint('ck_usuarios_superadmin_sin_empresa', 'usuarios', type_='check')
    op.drop_constraint('ck_usuarios_rol', 'usuarios', type_='check')
    op.execute("DELETE FROM usuarios WHERE empresa_id IS NULL")
    op.execute("UPDATE usuarios SET rol = 'admin'")
    op.alter_column('usuarios', 'empresa_id', existing_type=sa.UUID(), nullable=False)
    op.drop_column('usuarios', 'creado_en')
    op.drop_column('usuarios', 'activo')
    op.drop_column('usuarios', 'nombre')
