"""remove vestigial deleted_at

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-06 00:21:14.229767
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Account deletion is a hard delete (S11): every remaining row is live by
    # construction, so the partial "WHERE deleted_at IS NULL" index is replaced
    # by a plain unique index on identity_pk (Phase 5 security review, finding 2).
    # Drop the old partial index by hand first — a batch-mode table recreate on
    # SQLite would otherwise try to recreate it against the soon-to-be-gone column.
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_users_identity_pk_live",
            sqlite_where=sa.text("deleted_at IS NULL"),
            postgresql_where=sa.text("deleted_at IS NULL"),
        )
        batch_op.drop_column("deleted_at")
        batch_op.create_index("uq_users_identity_pk_live", ["identity_pk"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index("uq_users_identity_pk_live")
        batch_op.add_column(sa.Column("deleted_at", sa.DATETIME(), nullable=True))
        batch_op.create_index(
            "uq_users_identity_pk_live",
            ["identity_pk"],
            unique=True,
            sqlite_where=sa.text("deleted_at IS NULL"),
            postgresql_where=sa.text("deleted_at IS NULL"),
        )
