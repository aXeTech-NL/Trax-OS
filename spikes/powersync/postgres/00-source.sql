\set ON_ERROR_STOP on

-- Disposable Issue #8 identities. These credentials and records must never be
-- copied into production configuration or migrations.
CREATE ROLE ps8_replication WITH LOGIN PASSWORD 'trax-ps8-replication-only' REPLICATION;
CREATE ROLE ps8_storage WITH LOGIN PASSWORD 'trax-ps8-storage-only';
CREATE ROLE ps8_token_reader WITH LOGIN PASSWORD 'trax-ps8-token-reader-only';
CREATE ROLE ps8_command_writer WITH LOGIN PASSWORD 'trax-ps8-command-writer-only';
GRANT CONNECT ON DATABASE powersync_spike TO ps8_replication, ps8_storage, ps8_token_reader, ps8_command_writer;
GRANT CREATE ON DATABASE powersync_spike TO ps8_storage;

CREATE TABLE users (
    id uuid PRIMARY KEY,
    handle text NOT NULL UNIQUE,
    active boolean NOT NULL DEFAULT true
);

CREATE TABLE workspaces (
    id uuid PRIMARY KEY,
    label text NOT NULL
);

CREATE TABLE workspace_memberships (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE journeys (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    label text NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (workspace_id, id)
);

CREATE TABLE journey_memberships (
    workspace_id uuid NOT NULL,
    journey_id uuid NOT NULL,
    user_id uuid NOT NULL,
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (workspace_id, journey_id, user_id),
    FOREIGN KEY (workspace_id, journey_id)
        REFERENCES journeys(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE parties (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    journey_id uuid NOT NULL,
    label text NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (workspace_id, journey_id, id),
    FOREIGN KEY (workspace_id, journey_id)
        REFERENCES journeys(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE party_memberships (
    workspace_id uuid NOT NULL,
    journey_id uuid NOT NULL,
    party_id uuid NOT NULL,
    user_id uuid NOT NULL,
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (workspace_id, journey_id, party_id, user_id),
    FOREIGN KEY (workspace_id, journey_id, party_id)
        REFERENCES parties(workspace_id, journey_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, journey_id, user_id)
        REFERENCES journey_memberships(workspace_id, journey_id, user_id) ON DELETE CASCADE
);

CREATE TABLE resources (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    journey_id uuid NOT NULL,
    audience text NOT NULL,
    party_id uuid,
    payload text NOT NULL,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    deleted_at timestamptz,

    CHECK (
        (audience = 'journey' AND party_id IS NULL)
        OR (audience = 'party' AND party_id IS NOT NULL)
    ),
    FOREIGN KEY (workspace_id, journey_id)
        REFERENCES journeys(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, journey_id, party_id)
        REFERENCES parties(workspace_id, journey_id, id) ON DELETE CASCADE
);

-- Experimental M3a receipts and events are deliberately narrow facsimiles.
-- They are not Issue #14 command, unit-of-work, audit, or production schemas.
CREATE TABLE ps8_command_receipts (
    user_id uuid NOT NULL REFERENCES users(id),
    command_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    result_state text NOT NULL CHECK (result_state IN ('applied', 'conflict', 'denied')),
    result_code text NOT NULL CHECK (result_code IN ('applied', 'optimistic_conflict', 'command_denied')),
    previous_version bigint NOT NULL CHECK (previous_version > 0),
    current_version bigint NOT NULL CHECK (current_version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, command_id)
);

CREATE TABLE ps8_command_change_events (
    event_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    command_id uuid NOT NULL,
    resource_id uuid NOT NULL REFERENCES resources(id),
    event_ordinal integer NOT NULL CHECK (event_ordinal >= 0),
    event_type text NOT NULL CHECK (event_type IN ('ps8.resource.update.v1', 'ps8.resource.soft_delete.v1')),
    resulting_version bigint NOT NULL CHECK (resulting_version > 1),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, command_id, event_ordinal)
);

-- This server-maintained projection makes every contributing active flag
-- explicit while keeping clients unable to supply scope. It is spike-only
-- policy evidence, not a proposed production authorization table.
CREATE TABLE sync_grants (
    resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grant_path text NOT NULL,
    workspace_id uuid NOT NULL,
    journey_id uuid NOT NULL,
    party_id uuid,
    user_active boolean NOT NULL,
    workspace_active boolean NOT NULL,
    journey_active boolean NOT NULL,
    party_active boolean NOT NULL,
    PRIMARY KEY (resource_id, user_id, grant_path)
);

INSERT INTO users (id, handle) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'alice'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'bob'),
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'casey'),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'eve');

INSERT INTO workspaces (id, label) VALUES
    ('11111111-1111-4111-8111-111111111111', 'workspace-one'),
    ('22222222-2222-4222-8222-222222222222', 'workspace-two');

INSERT INTO workspace_memberships (workspace_id, user_id) VALUES
    ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
    ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'),
    ('22222222-2222-4222-8222-222222222222', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4');

INSERT INTO journeys (id, workspace_id, label) VALUES
    ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'journey-one'),
    ('11111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111111', 'journey-one-private-to-alice'),
    ('22222222-2222-4222-8222-222222222102', '22222222-2222-4222-8222-222222222222', 'journey-two');

INSERT INTO journey_memberships (workspace_id, journey_id, user_id) VALUES
    ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
    ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'),
    ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111103', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222102', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4');

INSERT INTO parties (id, workspace_id, journey_id, label) VALUES
    ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'party-alpha'),
    ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'party-bravo'),
    ('44444444-4444-4444-8444-444444444303', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222102', 'party-charlie');

INSERT INTO party_memberships (workspace_id, journey_id, party_id, user_id) VALUES
    ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', '33333333-3333-4333-8333-333333333301', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', '33333333-3333-4333-8333-333333333301', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'),
    ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', '33333333-3333-4333-8333-333333333302', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
    ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', '33333333-3333-4333-8333-333333333302', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'),
    ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222102', '44444444-4444-4444-8444-444444444303', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4');

INSERT INTO resources (id, workspace_id, journey_id, audience, party_id, payload) VALUES
    ('55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'journey', NULL, 'MARKER_W1_J1_SHARED'),
    ('55555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'party', '33333333-3333-4333-8333-333333333301', 'MARKER_PARTY_ALPHA_PRIVATE'),
    ('55555555-5555-4555-8555-555555555503', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'party', '33333333-3333-4333-8333-333333333302', 'MARKER_PARTY_BRAVO_PRIVATE'),
    ('55555555-5555-4555-8555-555555555504', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111103', 'journey', NULL, 'MARKER_W1_SECOND_JOURNEY_ALICE_ONLY'),
    ('66666666-6666-4666-8666-666666666601', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222102', 'journey', NULL, 'MARKER_W2_FORBIDDEN_SHARED'),
    ('66666666-6666-4666-8666-666666666602', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222102', 'party', '44444444-4444-4444-8444-444444444303', 'MARKER_W2_FORBIDDEN_PRIVATE');

CREATE FUNCTION refresh_sync_grants() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('trax-ps8-sync-grants', 0));
    DELETE FROM sync_grants;
    INSERT INTO sync_grants (
        resource_id, user_id, grant_path, workspace_id, journey_id, party_id,
        user_active, workspace_active, journey_active, party_active
    )
    SELECT
        resource.id, membership.user_id, 'journey', resource.workspace_id,
        resource.journey_id, NULL, users.active, workspace_membership.active,
        membership.active, true
    FROM resources AS resource
    JOIN journey_memberships AS membership
      ON membership.workspace_id = resource.workspace_id
     AND membership.journey_id = resource.journey_id
    JOIN workspace_memberships AS workspace_membership
      ON workspace_membership.workspace_id = membership.workspace_id
     AND workspace_membership.user_id = membership.user_id
    JOIN users ON users.id = membership.user_id
    WHERE resource.audience = 'journey'
    UNION ALL
    SELECT
        resource.id, party_membership.user_id,
        'party:' || party_membership.party_id::text, resource.workspace_id,
        resource.journey_id, party_membership.party_id, users.active,
        workspace_membership.active, journey_membership.active,
        party_membership.active
    FROM resources AS resource
    JOIN party_memberships AS party_membership
      ON party_membership.workspace_id = resource.workspace_id
     AND party_membership.journey_id = resource.journey_id
     AND party_membership.party_id = resource.party_id
    JOIN journey_memberships AS journey_membership
      ON journey_membership.workspace_id = party_membership.workspace_id
     AND journey_membership.journey_id = party_membership.journey_id
     AND journey_membership.user_id = party_membership.user_id
    JOIN workspace_memberships AS workspace_membership
      ON workspace_membership.workspace_id = journey_membership.workspace_id
     AND workspace_membership.user_id = journey_membership.user_id
    JOIN users ON users.id = journey_membership.user_id
    WHERE resource.audience = 'party';
    RETURN NULL;
END;
$$;

CREATE TRIGGER refresh_sync_grants_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH STATEMENT EXECUTE FUNCTION refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_workspaces
AFTER INSERT OR UPDATE OR DELETE ON workspace_memberships
FOR EACH STATEMENT EXECUTE FUNCTION refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_journeys
AFTER INSERT OR UPDATE OR DELETE ON journey_memberships
FOR EACH STATEMENT EXECUTE FUNCTION refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_parties
AFTER INSERT OR UPDATE OR DELETE ON party_memberships
FOR EACH STATEMENT EXECUTE FUNCTION refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_resources_insert_delete
AFTER INSERT OR DELETE ON resources
FOR EACH STATEMENT EXECUTE FUNCTION refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_resources_scope_update
AFTER UPDATE OF workspace_id, journey_id, audience, party_id ON resources
FOR EACH STATEMENT EXECUTE FUNCTION refresh_sync_grants();

-- Populate the projection once after fixture creation through the same trigger
-- path exercised by revocation updates.
UPDATE users SET active = active;

-- Serialize grant evaluation against a projection rebuild without granting the
-- command role mutation rights. The command acquires this shared transaction
-- lock in one statement, then reads grants in the next READ COMMITTED snapshot;
-- every relationship-triggered rebuild takes the matching exclusive lock.
CREATE FUNCTION ps8_acquire_grant_read_lock()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT pg_advisory_xact_lock_shared(hashtextextended('trax-ps8-sync-grants', 0))
$$;
REVOKE ALL ON FUNCTION ps8_acquire_grant_read_lock() FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO ps8_replication, ps8_token_reader, ps8_command_writer;
GRANT EXECUTE ON FUNCTION ps8_acquire_grant_read_lock() TO ps8_command_writer;
GRANT SELECT ON resources, sync_grants TO ps8_replication;
GRANT SELECT (id, active) ON users TO ps8_token_reader;
GRANT SELECT ON resources, sync_grants, ps8_command_receipts TO ps8_command_writer;
GRANT UPDATE (payload, version, deleted_at) ON resources TO ps8_command_writer;
GRANT INSERT ON ps8_command_receipts, ps8_command_change_events TO ps8_command_writer;

CREATE PUBLICATION powersync FOR TABLE resources, sync_grants;
