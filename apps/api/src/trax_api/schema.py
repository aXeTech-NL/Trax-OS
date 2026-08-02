"""SQLAlchemy Core schema used by repositories."""

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

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
