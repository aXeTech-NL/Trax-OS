"""Authenticated server-backed web baseline.

Revision ID: 0001_server_backed_web
Revises:
Create Date: 2026-08-02
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_server_backed_web"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email", name="users_email_key"),
    )
    op.create_table(
        "auth_password_credentials",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "auth_refresh_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("csrf_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token_hash", name="auth_refresh_sessions_token_hash_key"),
    )
    op.create_index(
        "ix_auth_refresh_sessions_active_user",
        "auth_refresh_sessions",
        ["user_id", "expires_at"],
    )
    op.create_table(
        "workspaces",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('PERSONAL', 'AGENCY')",
            name="workspace_type_valid",
        ),
    )
    op.create_table(
        "workspace_memberships",
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "role IN ('OWNER', 'EDITOR', 'VIEWER')",
            name="membership_role_valid",
        ),
    )
    op.create_index(
        "ix_workspace_memberships_user",
        "workspace_memberships",
        ["user_id", "workspace_id"],
    )
    op.create_table(
        "journeys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "record_version",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("workspace_id", "id", name="journey_workspace_identity"),
        sa.CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="journey_dates_valid",
        ),
        sa.CheckConstraint(
            "status IN ('planning','active','completed','archived')",
            name="journey_status_valid",
        ),
        sa.CheckConstraint("record_version >= 1", name="journey_version_positive"),
    )
    op.create_index(
        "ix_journeys_workspace_updated",
        "journeys",
        ["workspace_id", "updated_at", "id"],
    )
    op.create_table(
        "journey_segments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "journey_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("journeys.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("place_name", sa.String(200), nullable=True),
        sa.Column("origin_name", sa.String(200), nullable=True),
        sa.Column("destination_name", sa.String(200), nullable=True),
        sa.Column(
            "transport_mode",
            sa.String(100),
            nullable=False,
            server_default=sa.text("''"),
        ),
        sa.Column("notes", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "record_version",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("journey_id", "position", name="segment_position_unique"),
        sa.CheckConstraint("kind IN ('stay','move')", name="segment_kind_valid"),
        sa.CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="segment_dates_valid",
        ),
        sa.CheckConstraint("record_version >= 1", name="segment_version_positive"),
        sa.CheckConstraint(
            "(kind='stay' AND place_name IS NOT NULL) OR "
            "(kind='move' AND origin_name IS NOT NULL AND destination_name IS NOT NULL)",
            name="segment_details_valid",
        ),
    )
    op.create_index(
        "ix_journey_segments_journey_position",
        "journey_segments",
        ["journey_id", "position"],
    )
    op.create_table(
        "packing_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "journey_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("journeys.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column(
            "packed_quantity",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "essential",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "record_version",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "category IN ('documents','clothing','toiletries','electronics','other')",
            name="packing_category_valid",
        ),
        sa.CheckConstraint("quantity BETWEEN 1 AND 99", name="packing_quantity_valid"),
        sa.CheckConstraint(
            "packed_quantity BETWEEN 0 AND quantity",
            name="packing_progress_valid",
        ),
        sa.CheckConstraint("record_version >= 1", name="packing_version_positive"),
    )
    op.create_index(
        "ix_packing_items_journey_category",
        "packing_items",
        ["journey_id", "category", "label"],
    )

    for table in ("journeys", "journey_segments", "packing_items"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY journey_workspace_policy ON journeys
        USING (EXISTS (
          SELECT 1 FROM workspace_memberships membership
          WHERE membership.workspace_id = journeys.workspace_id
            AND membership.user_id = NULLIF(current_setting('trax.user_id', true), '')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM workspace_memberships membership
          WHERE membership.workspace_id = journeys.workspace_id
            AND membership.user_id = NULLIF(current_setting('trax.user_id', true), '')::uuid
        ))
        """
    )
    for table in ("journey_segments", "packing_items"):
        op.execute(
            f"""
            CREATE POLICY {table}_workspace_policy ON {table}
            USING (EXISTS (
              SELECT 1 FROM journeys journey
              JOIN workspace_memberships membership
                ON membership.workspace_id = journey.workspace_id
              WHERE journey.id = {table}.journey_id
                AND membership.user_id = NULLIF(current_setting('trax.user_id', true), '')::uuid
            ))
            WITH CHECK (EXISTS (
              SELECT 1 FROM journeys journey
              JOIN workspace_memberships membership
                ON membership.workspace_id = journey.workspace_id
              WHERE journey.id = {table}.journey_id
                AND membership.user_id = NULLIF(current_setting('trax.user_id', true), '')::uuid
            ))
            """
        )


def downgrade() -> None:
    op.drop_table("packing_items")
    op.drop_table("journey_segments")
    op.drop_table("journeys")
    op.drop_table("workspace_memberships")
    op.drop_table("workspaces")
    op.drop_table("auth_refresh_sessions")
    op.drop_table("auth_password_credentials")
    op.drop_table("users")
