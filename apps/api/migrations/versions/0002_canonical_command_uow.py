"""Canonical Journey update command, receipts and change sets.

Revision ID: 0002_canonical_command_uow
Revises: 0001_server_backed_web
Create Date: 2026-08-10
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002_canonical_command_uow"
down_revision = "0001_server_backed_web"
branch_labels = None
depends_on = None


def _selected_workspace_policy(table: str, journey_join: bool = False) -> str:
    selected = "NULLIF(current_setting('trax.workspace_id', true), '')::uuid"
    user = "NULLIF(current_setting('trax.user_id', true), '')::uuid"
    if not journey_join:
        scope = f"{table}.workspace_id = {selected}"
        membership_workspace = f"{table}.workspace_id"
    else:
        scope = f"journey.workspace_id = {selected}"
        membership_workspace = "journey.workspace_id"
    exists = (
        "EXISTS (SELECT 1 FROM workspace_memberships membership "
        f"WHERE membership.workspace_id = {membership_workspace} "
        f"AND membership.user_id = {user})"
    )
    if journey_join:
        return (
            "EXISTS (SELECT 1 FROM journeys journey WHERE journey.id = "
            f"{table}.journey_id AND {scope} AND {exists})"
        )
    return f"({scope} AND {exists})"


def upgrade() -> None:
    # The runtime login is provisioned out of band (development Compose/CI or
    # production operations). Migrations fail closed rather than creating a
    # login or embedding a secret in repository history.
    op.execute(
        """
        DO $$
        DECLARE runtime_role record;
        BEGIN
          SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
                 rolinherit, rolreplication
            INTO runtime_role
            FROM pg_roles WHERE rolname = 'trax_app';
          IF NOT FOUND THEN
            RAISE EXCEPTION 'required runtime role trax_app is missing';
          END IF;
          IF NOT runtime_role.rolcanlogin OR runtime_role.rolsuper OR runtime_role.rolbypassrls
             OR runtime_role.rolcreatedb OR runtime_role.rolcreaterole
             OR runtime_role.rolinherit OR runtime_role.rolreplication THEN
            RAISE EXCEPTION 'runtime role trax_app is privileged';
          END IF;
          IF EXISTS (
            SELECT 1 FROM pg_auth_members membership
            JOIN pg_roles checked_role
              ON checked_role.oid IN (membership.member, membership.roleid)
            WHERE checked_role.rolname = 'trax_app'
          ) THEN
            RAISE EXCEPTION 'runtime role trax_app must not inherit any role membership';
          END IF;
        END $$
        """
    )
    op.create_table(
        "command_change_sets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("command_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("command_type", sa.String(100), nullable=False),
        sa.Column("command_version", sa.Integer(), nullable=False),
        sa.Column("origin", sa.String(32), nullable=False),
        sa.Column("reversibility", sa.String(20), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
        sa.UniqueConstraint(
            "workspace_id",
            "actor_user_id",
            "command_id",
            name="command_change_set_command_unique",
        ),
        sa.UniqueConstraint(
            "id",
            "workspace_id",
            "actor_user_id",
            "entity_type",
            "entity_id",
            name="command_change_set_scope_unique",
        ),
        sa.UniqueConstraint(
            "id",
            "workspace_id",
            "actor_user_id",
            "command_id",
            "entity_type",
            "entity_id",
            name="command_change_set_receipt_scope_unique",
        ),
        sa.CheckConstraint("command_type = 'journey.update'", name="command_change_set_type_valid"),
        sa.CheckConstraint("command_version = 1", name="command_change_set_version_valid"),
        sa.CheckConstraint("entity_type = 'journey'", name="command_change_set_entity_valid"),
        sa.CheckConstraint(
            "origin IN ('web','agent','sync','system')", name="command_change_set_origin_valid"
        ),
        sa.CheckConstraint(
            "reversibility IN ('full','compensatable','partial','none')",
            name="command_change_set_reversibility_valid",
        ),
    )
    op.create_table(
        "command_change_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("change_set_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("before_state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("after_state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["change_set_id", "workspace_id", "actor_user_id", "entity_type", "entity_id"],
            [
                "command_change_sets.id",
                "command_change_sets.workspace_id",
                "command_change_sets.actor_user_id",
                "command_change_sets.entity_type",
                "command_change_sets.entity_id",
            ],
            ondelete="CASCADE",
            name="command_change_event_scope_fk",
        ),
        sa.UniqueConstraint(
            "change_set_id", "sequence", name="command_change_event_sequence_unique"
        ),
        sa.CheckConstraint("sequence >= 1", name="command_change_event_sequence_positive"),
        sa.CheckConstraint("entity_type = 'journey'", name="command_change_event_entity_valid"),
        sa.CheckConstraint("action = 'updated'", name="command_change_event_action_valid"),
    )
    op.create_table(
        "command_receipts",
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("command_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("command_type", sa.String(100), nullable=False),
        sa.Column("command_version", sa.Integer(), nullable=False),
        sa.Column("digest_version", sa.Integer(), nullable=False),
        sa.Column("request_digest", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(32), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("result_record_version", sa.BigInteger(), nullable=True),
        sa.Column("change_set_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(
            [
                "change_set_id",
                "workspace_id",
                "actor_user_id",
                "command_id",
                "entity_type",
                "entity_id",
            ],
            [
                "command_change_sets.id",
                "command_change_sets.workspace_id",
                "command_change_sets.actor_user_id",
                "command_change_sets.command_id",
                "command_change_sets.entity_type",
                "command_change_sets.entity_id",
            ],
            name="command_receipt_change_set_scope_fk",
        ),
        sa.CheckConstraint("command_type = 'journey.update'", name="command_receipt_type_valid"),
        sa.CheckConstraint("command_version = 1", name="command_receipt_version_valid"),
        sa.CheckConstraint("digest_version = 1", name="command_receipt_digest_version_valid"),
        sa.CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'", name="command_receipt_digest_shape_valid"
        ),
        sa.CheckConstraint("entity_type = 'journey'", name="command_receipt_entity_valid"),
        sa.CheckConstraint(
            "result_record_version IS NULL OR result_record_version >= 1",
            name="command_receipt_result_version_positive",
        ),
        sa.CheckConstraint(
            "outcome IN ('applied','version_conflict','resource_not_found')",
            name="command_receipt_outcome_valid",
        ),
        sa.CheckConstraint(
            "(outcome='applied' AND result_record_version IS NOT NULL "
            "AND change_set_id IS NOT NULL) "
            "OR (outcome<>'applied' AND result_record_version IS NULL AND change_set_id IS NULL)",
            name="command_receipt_result_shape_valid",
        ),
    )
    op.create_index(
        "ix_command_change_sets_workspace_created",
        "command_change_sets",
        ["workspace_id", "created_at", "id"],
    )
    op.create_index(
        "ix_command_change_events_workspace_created",
        "command_change_events",
        ["workspace_id", "created_at", "id"],
    )

    op.execute("GRANT USAGE ON SCHEMA public TO trax_app")
    op.execute(
        "GRANT SELECT, INSERT ON users, auth_password_credentials, workspaces, "
        "workspace_memberships TO trax_app"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE ON auth_refresh_sessions TO trax_app")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON journeys, journey_segments, "
        "packing_items TO trax_app"
    )
    op.execute(
        "GRANT SELECT, INSERT ON command_change_sets, command_change_events, "
        "command_receipts TO trax_app"
    )
    # SELECT ... FOR SHARE requires UPDATE privilege on the selected table.
    # Keep membership mutation unavailable to the runtime login and expose only
    # this GUC-bound lock primitive. SECURITY DEFINER bypasses membership RLS,
    # but cannot be used to inspect a scope other than the caller's selected
    # transaction-local workspace and user.
    op.execute(
        """
        CREATE FUNCTION trax_lock_membership(p_workspace_id uuid, p_user_id uuid)
        RETURNS text
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = pg_catalog, public
        AS $function$
          SELECT membership.role::text
          FROM public.workspace_memberships membership
          WHERE membership.workspace_id = p_workspace_id
            AND membership.user_id = p_user_id
            AND p_workspace_id =
              NULLIF(current_setting('trax.workspace_id', true), '')::uuid
            AND p_user_id =
              NULLIF(current_setting('trax.user_id', true), '')::uuid
          FOR SHARE
        $function$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION trax_lock_membership(uuid, uuid) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION trax_lock_membership(uuid, uuid) TO trax_app")

    for table in ("command_change_sets", "command_change_events", "command_receipts"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        selected = "NULLIF(current_setting('trax.workspace_id', true), '')::uuid"
        user = "NULLIF(current_setting('trax.user_id', true), '')::uuid"
        op.execute(
            f"""
            CREATE POLICY {table}_selected_actor_policy ON {table}
            USING ({table}.workspace_id = {selected} AND {table}.actor_user_id = {user}
              AND EXISTS (SELECT 1 FROM workspace_memberships membership
                WHERE membership.workspace_id = {table}.workspace_id
                  AND membership.user_id = {user}))
            WITH CHECK ({table}.workspace_id = {selected} AND {table}.actor_user_id = {user}
              AND EXISTS (SELECT 1 FROM workspace_memberships membership
                WHERE membership.workspace_id = {table}.workspace_id
                  AND membership.user_id = {user}))
            """
        )

    op.execute("DROP POLICY journey_workspace_policy ON journeys")
    journey_policy = _selected_workspace_policy("journeys")
    op.execute(
        "CREATE POLICY journey_workspace_policy ON journeys "
        f"USING ({journey_policy}) WITH CHECK ({journey_policy})"
    )
    for table in ("journey_segments", "packing_items"):
        op.execute(f"DROP POLICY {table}_workspace_policy ON {table}")
        policy = _selected_workspace_policy(table, journey_join=True)
        op.execute(
            f"CREATE POLICY {table}_workspace_policy ON {table} "
            f"USING ({policy}) WITH CHECK ({policy})"
        )


def downgrade() -> None:
    op.execute("DROP POLICY journey_workspace_policy ON journeys")
    old_journey = (
        "EXISTS (SELECT 1 FROM workspace_memberships membership "
        "WHERE membership.workspace_id = journeys.workspace_id "
        "AND membership.user_id = NULLIF(current_setting('trax.user_id', true), '')::uuid)"
    )
    op.execute(
        "CREATE POLICY journey_workspace_policy ON journeys "
        f"USING ({old_journey}) WITH CHECK ({old_journey})"
    )
    for table in ("journey_segments", "packing_items"):
        op.execute(f"DROP POLICY {table}_workspace_policy ON {table}")
        old_child = (
            "EXISTS (SELECT 1 FROM journeys journey "
            "JOIN workspace_memberships membership "
            "ON membership.workspace_id = journey.workspace_id "
            f"WHERE journey.id = {table}.journey_id "
            "AND membership.user_id = "
            "NULLIF(current_setting('trax.user_id', true), '')::uuid)"
        )
        op.execute(
            f"CREATE POLICY {table}_workspace_policy ON {table} "
            f"USING ({old_child}) WITH CHECK ({old_child})"
        )
    op.execute("REVOKE EXECUTE ON FUNCTION trax_lock_membership(uuid, uuid) FROM trax_app")
    op.execute("DROP FUNCTION trax_lock_membership(uuid, uuid)")
    op.execute(
        "REVOKE SELECT, INSERT ON command_change_sets, command_change_events, "
        "command_receipts FROM trax_app"
    )
    op.execute(
        "REVOKE SELECT, INSERT, UPDATE, DELETE ON journeys, journey_segments, "
        "packing_items FROM trax_app"
    )
    op.execute("REVOKE SELECT, INSERT, UPDATE ON auth_refresh_sessions FROM trax_app")
    op.execute(
        "REVOKE SELECT, INSERT ON users, auth_password_credentials, workspaces, "
        "workspace_memberships FROM trax_app"
    )
    op.execute("REVOKE USAGE ON SCHEMA public FROM trax_app")
    op.drop_table("command_receipts")
    op.drop_table("command_change_events")
    op.drop_table("command_change_sets")
