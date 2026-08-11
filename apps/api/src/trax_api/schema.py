"""SQLAlchemy Core schema used by repositories."""

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("email", String(320), nullable=False, unique=True),
    Column("display_name", String(120), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
password_credentials = Table(
    "auth_password_credentials",
    metadata,
    Column(
        "user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    ),
    Column("password_hash", Text, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)
sessions = Table(
    "auth_refresh_sessions",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column(
        "user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    ),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("csrf_hash", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True)),
)
workspaces = Table(
    "workspaces",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("type", String(16), nullable=False),
    Column("name", String(160), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint("type IN ('PERSONAL', 'AGENCY')", name="workspace_type_valid"),
)
memberships = Table(
    "workspace_memberships",
    metadata,
    Column(
        "workspace_id",
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    ),
    Column("role", String(32), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint("role IN ('OWNER', 'EDITOR', 'VIEWER')", name="membership_role_valid"),
)
journeys = Table(
    "journeys",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column(
        "workspace_id",
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("name", String(200), nullable=False),
    Column("start_date", Date),
    Column("end_date", Date),
    Column("status", String(16), nullable=False),
    Column("record_version", BigInteger, nullable=False, default=1),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("workspace_id", "id", name="journey_workspace_identity"),
    CheckConstraint(
        "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
        name="journey_dates_valid",
    ),
    CheckConstraint(
        "status IN ('planning','active','completed','archived')", name="journey_status_valid"
    ),
    CheckConstraint("record_version >= 1", name="journey_version_positive"),
)
segments = Table(
    "journey_segments",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column(
        "journey_id",
        UUID(as_uuid=True),
        ForeignKey("journeys.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("kind", String(8), nullable=False),
    Column("position", Integer, nullable=False),
    Column("start_date", Date),
    Column("end_date", Date),
    Column("place_name", String(200)),
    Column("origin_name", String(200)),
    Column("destination_name", String(200)),
    Column("transport_mode", String(100), nullable=False, server_default=""),
    Column("notes", Text, nullable=False, server_default=""),
    Column("record_version", BigInteger, nullable=False, default=1),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("journey_id", "position", name="segment_position_unique"),
    CheckConstraint("kind IN ('stay','move')", name="segment_kind_valid"),
    CheckConstraint(
        "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
        name="segment_dates_valid",
    ),
    CheckConstraint("record_version >= 1", name="segment_version_positive"),
    CheckConstraint(
        "(kind='stay' AND place_name IS NOT NULL) OR "
        "(kind='move' AND origin_name IS NOT NULL AND destination_name IS NOT NULL)",
        name="segment_details_valid",
    ),
)
command_change_sets = Table(
    "command_change_sets",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("workspace_id", UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False),
    Column("actor_user_id", UUID(as_uuid=True), ForeignKey("users.id"), nullable=False),
    Column("command_id", UUID(as_uuid=True), nullable=False),
    Column("command_type", String(100), nullable=False),
    Column("command_version", Integer, nullable=False),
    Column("origin", String(32), nullable=False),
    Column("reversibility", String(20), nullable=False),
    Column("entity_type", String(100), nullable=False),
    Column("entity_id", UUID(as_uuid=True), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint(
        "workspace_id", "actor_user_id", "command_id", name="command_change_set_command_unique"
    ),
    UniqueConstraint(
        "id",
        "workspace_id",
        "actor_user_id",
        "entity_type",
        "entity_id",
        name="command_change_set_scope_unique",
    ),
    UniqueConstraint(
        "id",
        "workspace_id",
        "actor_user_id",
        "command_id",
        "entity_type",
        "entity_id",
        name="command_change_set_receipt_scope_unique",
    ),
    CheckConstraint("command_type = 'journey.update'", name="command_change_set_type_valid"),
    CheckConstraint("command_version = 1", name="command_change_set_version_valid"),
    CheckConstraint("entity_type = 'journey'", name="command_change_set_entity_valid"),
    CheckConstraint(
        "origin IN ('web','agent','sync','system')", name="command_change_set_origin_valid"
    ),
    CheckConstraint(
        "reversibility IN ('full','compensatable','partial','none')",
        name="command_change_set_reversibility_valid",
    ),
)
command_change_events = Table(
    "command_change_events",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("change_set_id", UUID(as_uuid=True), nullable=False),
    Column("workspace_id", UUID(as_uuid=True), nullable=False),
    Column("actor_user_id", UUID(as_uuid=True), nullable=False),
    Column("sequence", Integer, nullable=False),
    Column("entity_type", String(100), nullable=False),
    Column("entity_id", UUID(as_uuid=True), nullable=False),
    Column("action", String(32), nullable=False),
    Column("before_state", JSONB, nullable=False),
    Column("after_state", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    ForeignKeyConstraint(
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
    UniqueConstraint("change_set_id", "sequence", name="command_change_event_sequence_unique"),
    CheckConstraint("sequence >= 1", name="command_change_event_sequence_positive"),
    CheckConstraint("entity_type = 'journey'", name="command_change_event_entity_valid"),
    CheckConstraint("action = 'updated'", name="command_change_event_action_valid"),
)
command_receipts = Table(
    "command_receipts",
    metadata,
    Column("workspace_id", UUID(as_uuid=True), ForeignKey("workspaces.id"), primary_key=True),
    Column("actor_user_id", UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True),
    Column("command_id", UUID(as_uuid=True), primary_key=True),
    Column("command_type", String(100), nullable=False),
    Column("command_version", Integer, nullable=False),
    Column("digest_version", Integer, nullable=False),
    Column("request_digest", String(64), nullable=False),
    Column("outcome", String(32), nullable=False),
    Column("entity_type", String(100), nullable=False),
    Column("entity_id", UUID(as_uuid=True), nullable=False),
    Column("result_record_version", BigInteger),
    Column("change_set_id", UUID(as_uuid=True)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    ForeignKeyConstraint(
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
    CheckConstraint("command_type = 'journey.update'", name="command_receipt_type_valid"),
    CheckConstraint("command_version = 1", name="command_receipt_version_valid"),
    CheckConstraint("digest_version = 1", name="command_receipt_digest_version_valid"),
    CheckConstraint("request_digest ~ '^[0-9a-f]{64}$'", name="command_receipt_digest_shape_valid"),
    CheckConstraint("entity_type = 'journey'", name="command_receipt_entity_valid"),
    CheckConstraint(
        "result_record_version IS NULL OR result_record_version >= 1",
        name="command_receipt_result_version_positive",
    ),
    CheckConstraint(
        "outcome IN ('applied','version_conflict','resource_not_found')",
        name="command_receipt_outcome_valid",
    ),
    CheckConstraint(
        "(outcome='applied' AND result_record_version IS NOT NULL "
        "AND change_set_id IS NOT NULL) OR "
        "(outcome<>'applied' AND result_record_version IS NULL AND change_set_id IS NULL)",
        name="command_receipt_result_shape_valid",
    ),
)
Index(
    "ix_command_change_sets_workspace_created",
    command_change_sets.c.workspace_id,
    command_change_sets.c.created_at,
    command_change_sets.c.id,
)
Index(
    "ix_command_change_events_workspace_created",
    command_change_events.c.workspace_id,
    command_change_events.c.created_at,
    command_change_events.c.id,
)

packing_items = Table(
    "packing_items",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column(
        "journey_id",
        UUID(as_uuid=True),
        ForeignKey("journeys.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("label", String(200), nullable=False),
    Column("category", String(32), nullable=False),
    Column("quantity", Integer, nullable=False),
    Column("packed_quantity", Integer, nullable=False, default=0),
    Column("essential", Boolean, nullable=False, default=False),
    Column("record_version", BigInteger, nullable=False, default=1),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    CheckConstraint(
        "category IN ('documents','clothing','toiletries','electronics','other')",
        name="packing_category_valid",
    ),
    CheckConstraint("quantity BETWEEN 1 AND 99", name="packing_quantity_valid"),
    CheckConstraint("packed_quantity BETWEEN 0 AND quantity", name="packing_progress_valid"),
    CheckConstraint("record_version >= 1", name="packing_version_positive"),
)
