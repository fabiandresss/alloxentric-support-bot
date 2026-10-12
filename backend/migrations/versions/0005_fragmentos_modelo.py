"""fragmentos_embeddings.modelo: qué embedder generó cada vector

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('fragmentos_embeddings', sa.Column('modelo', sa.String(length=80), nullable=True))
    # los vectores que existan (si los hubiera) no tienen modelo conocido: se regeneran con `python reindexar.py`


def downgrade() -> None:
    op.drop_column('fragmentos_embeddings', 'modelo')
