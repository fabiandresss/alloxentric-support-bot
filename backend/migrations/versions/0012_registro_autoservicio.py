"""Registro de usuarios y empresas en autoservicio: rol `registrado` (cuenta sin empresa) y `empresas.chatbot_pendiente` (un chatbot por empresa)

Revision ID: 0012
Revises: 0011
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0012'
down_revision: Union[str, Sequence[str], None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('empresas', sa.Column('chatbot_pendiente', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.drop_constraint('ck_usuarios_superadmin_sin_empresa', 'usuarios', type_='check')
    op.drop_constraint('ck_usuarios_rol', 'usuarios', type_='check')
    op.create_check_constraint('ck_usuarios_rol', 'usuarios',
                               "rol IN ('superadmin','admin_empresa','encargado_tickets','encargado_agente','registrado')")
    op.create_check_constraint('ck_usuarios_sin_empresa', 'usuarios', "(rol IN ('superadmin','registrado')) = (empresa_id IS NULL)")


def downgrade() -> None:
    # las cuentas `registrado` (sin empresa) no caben en el esquema anterior: se eliminan
    op.execute("DELETE FROM usuarios WHERE rol = 'registrado'")
    op.drop_constraint('ck_usuarios_sin_empresa', 'usuarios', type_='check')
    op.drop_constraint('ck_usuarios_rol', 'usuarios', type_='check')
    op.create_check_constraint('ck_usuarios_rol', 'usuarios', "rol IN ('superadmin','admin_empresa','encargado_tickets','encargado_agente')")
    op.create_check_constraint('ck_usuarios_superadmin_sin_empresa', 'usuarios', "(rol = 'superadmin') = (empresa_id IS NULL)")
    op.drop_column('empresas', 'chatbot_pendiente')
