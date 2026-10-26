"""Operators, their sessions and audit log; college applications; campus partner flag.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("campuses", schema=None) as batch_op:
        batch_op.add_column(sa.Column("partner_verified_at", sa.DateTime(), nullable=True))

    op.create_table(
        "operators",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("username", sa.String(40), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(200), nullable=False),
        sa.Column("campus_id", sa.String(36), sa.ForeignKey("campuses.id", ondelete="CASCADE")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("disabled_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "operator_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "operator_id",
            sa.String(36),
            sa.ForeignKey("operators.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("csrf", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "admin_audit",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("operator", sa.String(40), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("target", sa.String(253), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_admin_audit_created", "admin_audit", ["created_at"])
    op.create_table(
        "college_applications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("college_name", sa.String(120), nullable=False),
        sa.Column("domain", sa.String(253), nullable=False),
        sa.Column("contact_name", sa.String(80), nullable=False),
        sa.Column("contact_role", sa.String(80), nullable=False),
        sa.Column("contact_email", sa.String(254), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=True),
        sa.Column("code_expires_at", sa.DateTime(), nullable=True),
        sa.Column("code_attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by", sa.String(40), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("college_applications")
    op.drop_index("ix_admin_audit_created", table_name="admin_audit")
    op.drop_table("admin_audit")
    op.drop_table("operator_sessions")
    op.drop_table("operators")
    with op.batch_alter_table("campuses", schema=None) as batch_op:
        batch_op.drop_column("partner_verified_at")
