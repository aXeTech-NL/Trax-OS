\set ON_ERROR_STOP on

-- Disposable Issue #8 identities. These credentials and records must never be
-- copied into production configuration or migrations.
CREATE ROLE ps8_replication WITH LOGIN PASSWORD 'trax-ps8-replication-only' REPLICATION;
CREATE ROLE ps8_storage WITH LOGIN PASSWORD 'trax-ps8-storage-only';
CREATE ROLE ps8_token_reader WITH LOGIN PASSWORD 'trax-ps8-token-reader-only';
CREATE ROLE ps8_command_writer WITH LOGIN PASSWORD 'trax-ps8-command-writer-only';
GRANT CONNECT ON DATABASE powersync_spike TO ps8_replication, ps8_storage, ps8_token_reader, ps8_command_writer;
GRANT CREATE ON DATABASE powersync_spike TO ps8_storage;
-- SECURITY DEFINER helpers must not resolve attacker-created temporary objects.
-- PowerSync storage demonstrably needs TEMPORARY; command/token/replication roles do not.
REVOKE TEMPORARY ON DATABASE powersync_spike FROM PUBLIC;
GRANT TEMPORARY ON DATABASE powersync_spike TO ps8_storage;

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
    resource_incarnation_id uuid NOT NULL UNIQUE,
    workspace_id uuid NOT NULL,
    journey_id uuid NOT NULL,
    audience text NOT NULL,
    party_id uuid,
    payload text,
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
    replica_id uuid NOT NULL,
    replica_epoch bigint NOT NULL CHECK (replica_epoch > 0),
    resource_id uuid NOT NULL,
    digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    result_state text NOT NULL CHECK (result_state IN ('applied', 'conflict', 'denied')),
    result_code text NOT NULL CHECK (result_code IN ('applied', 'optimistic_conflict', 'stale_incarnation', 'command_denied')),
    previous_version bigint NOT NULL CHECK (previous_version > 0),
    current_version bigint NOT NULL CHECK (current_version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, command_id)
);

CREATE TABLE ps8_command_change_events (
    event_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    command_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    event_ordinal integer NOT NULL CHECK (event_ordinal >= 0),
    event_type text NOT NULL CHECK (event_type IN ('ps8.resource.update.v1', 'ps8.resource.soft_delete.v1')),
    resulting_version bigint NOT NULL CHECK (resulting_version > 1),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, command_id, event_ordinal)
);

-- This server-maintained projection makes every contributing active flag
-- explicit while keeping clients unable to supply scope. It is spike-only
-- policy evidence, not a proposed production authorization table.
-- Experimental M3b-R1 retention state is server-only. It intentionally does
-- not model trusted replica registration/checkpoints; that remains an R2 gate.
CREATE TABLE ps8_resource_graveyard (
    resource_id uuid PRIMARY KEY,
    resource_incarnation_id uuid NOT NULL UNIQUE,
    final_version bigint NOT NULL CHECK (final_version > 1),
    workspace_id uuid NOT NULL,
    journey_id uuid NOT NULL,
    audience text NOT NULL CHECK (audience IN ('journey', 'party')),
    party_id uuid,
    deleted_at timestamptz NOT NULL,
    deletion_sequence bigint NOT NULL UNIQUE CHECK (deletion_sequence > 0),
    CHECK (
        (audience = 'journey' AND party_id IS NULL)
        OR (audience = 'party' AND party_id IS NOT NULL)
    )
);

CREATE TABLE ps8_retention_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    effective_now timestamptz NOT NULL,
    graveyard_retention interval NOT NULL DEFAULT interval '90 days'
        CHECK (graveyard_retention >= interval '90 days'),
    retained_graveyard_floor bigint NOT NULL DEFAULT 1
        CHECK (retained_graveyard_floor > 0),
    next_deletion_sequence bigint NOT NULL DEFAULT 1
        CHECK (next_deletion_sequence > 0)
);
INSERT INTO ps8_retention_state (singleton, effective_now)
VALUES (true, '2026-01-01T00:00:00Z');

-- M3b-R2 server-registered replicas. Credentials are generated by the command
-- service; only SHA-256 digests are persisted. A client-observed checkpoint is
-- an honest-client lifecycle signal, never PowerSync server attestation.
CREATE TABLE ps8_replicas (
    replica_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_digest text NOT NULL CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
    replica_epoch bigint NOT NULL DEFAULT 1 CHECK (replica_epoch > 0),
    registered_at timestamptz NOT NULL,
    last_client_observed_ack_at timestamptz,
    acknowledged_sequence bigint,
    reset_at timestamptz,
    disabled_at timestamptz,
    previous_credential_digest text CHECK (previous_credential_digest IS NULL OR previous_credential_digest ~ '^[0-9a-f]{64}$'),
    staged_reset_request_id uuid,
    last_acknowledged_reset_request_id uuid,
    CHECK ((last_client_observed_ack_at IS NULL) = (acknowledged_sequence IS NULL)),
    CHECK ((previous_credential_digest IS NULL) = (staged_reset_request_id IS NULL))
);
CREATE INDEX ps8_replicas_user_idx ON ps8_replicas(user_id, replica_id);

CREATE TABLE ps8_replica_challenges (
    challenge_id uuid PRIMARY KEY,
    replica_id uuid NOT NULL REFERENCES ps8_replicas(replica_id) ON DELETE CASCADE,
    replica_epoch bigint NOT NULL CHECK (replica_epoch > 0),
    target_sequence bigint NOT NULL CHECK (target_sequence > 0),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    acknowledged_at timestamptz,
    CHECK (expires_at > issued_at)
);
CREATE UNIQUE INDEX ps8_replica_challenges_current_idx
    ON ps8_replica_challenges(replica_id, replica_epoch);

-- One bounded mutable rate-window row per registered replica. This is a
-- disposable single-node feasibility limiter, not production sizing/fairness.
CREATE TABLE ps8_command_rate_windows (
    replica_id uuid PRIMARY KEY REFERENCES ps8_replicas(replica_id) ON DELETE CASCADE,
    replica_epoch bigint NOT NULL CHECK (replica_epoch > 0),
    window_started_at timestamptz NOT NULL,
    request_count integer NOT NULL CHECK (request_count > 0 AND request_count <= 64)
);
CREATE INDEX ps8_command_rate_windows_expiry_idx ON ps8_command_rate_windows(window_started_at);

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

INSERT INTO resources (id, resource_incarnation_id, workspace_id, journey_id, audience, party_id, payload) VALUES
    ('55555555-5555-4555-8555-555555555501', '75555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'journey', NULL, 'MARKER_W1_J1_SHARED'),
    ('55555555-5555-4555-8555-555555555502', '75555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'party', '33333333-3333-4333-8333-333333333301', 'MARKER_PARTY_ALPHA_PRIVATE'),
    ('55555555-5555-4555-8555-555555555503', '75555555-5555-4555-8555-555555555503', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'party', '33333333-3333-4333-8333-333333333302', 'MARKER_PARTY_BRAVO_PRIVATE'),
    ('55555555-5555-4555-8555-555555555504', '75555555-5555-4555-8555-555555555504', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111103', 'journey', NULL, 'MARKER_W1_SECOND_JOURNEY_ALICE_ONLY'),
    ('66666666-6666-4666-8666-666666666601', '76666666-6666-4666-8666-666666666601', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222102', 'journey', NULL, 'MARKER_W2_FORBIDDEN_SHARED'),
    ('66666666-6666-4666-8666-666666666602', '76666666-6666-4666-8666-666666666602', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222102', 'party', '44444444-4444-4444-8444-444444444303', 'MARKER_W2_FORBIDDEN_PRIVATE');

CREATE FUNCTION ps8_now() RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT state.effective_now
      FROM public.ps8_retention_state AS state
     WHERE state.singleton
$$;
REVOKE ALL ON FUNCTION ps8_now() FROM PUBLIC;

CREATE FUNCTION ps8_test_set_time(next_time timestamptz) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE previous_effective_now timestamptz;
BEGIN
    IF next_time IS NULL THEN
        RAISE EXCEPTION 'test time is required';
    END IF;
    SELECT state.effective_now
      INTO previous_effective_now
      FROM public.ps8_retention_state AS state
     WHERE state.singleton
     FOR UPDATE;
    IF next_time < previous_effective_now THEN
        RAISE EXCEPTION 'test time cannot move backwards';
    END IF;
    UPDATE public.ps8_retention_state AS state
       SET effective_now = next_time
     WHERE state.singleton;
END;
$$;
REVOKE ALL ON FUNCTION ps8_test_set_time(timestamptz) FROM PUBLIC;

CREATE FUNCTION ps8_test_set_graveyard_retention(next_retention interval) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF next_retention IS NULL OR next_retention < interval '90 days' THEN
        RAISE EXCEPTION 'graveyard retention cannot be shorter than P90D';
    END IF;
    UPDATE public.ps8_retention_state AS state
       SET graveyard_retention = next_retention
     WHERE state.singleton;
END;
$$;
REVOKE ALL ON FUNCTION ps8_test_set_graveyard_retention(interval) FROM PUBLIC;

CREATE FUNCTION ps8_guard_resource_lifecycle() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF EXISTS (
            SELECT 1
              FROM public.ps8_resource_graveyard AS graveyard
             WHERE graveyard.resource_id = NEW.id
        ) THEN
            RAISE EXCEPTION 'resource UUID remains in the retained graveyard'
                USING ERRCODE = 'unique_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.resource_incarnation_id IS DISTINCT FROM OLD.resource_incarnation_id THEN
        RAISE EXCEPTION 'resource incarnation is immutable';
    END IF;
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        RAISE EXCEPTION 'resource tombstone time is immutable';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ps8_guard_resource_lifecycle() FROM PUBLIC;

CREATE FUNCTION ps8_record_resource_graveyard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    allocated_sequence bigint;
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        -- The singleton counter row serializes allocation through transaction
        -- commit. The resource row is already locked before this trigger, so the
        -- retention job must likewise touch state only after resource deletion.
        UPDATE public.ps8_retention_state AS state
           SET next_deletion_sequence = state.next_deletion_sequence + 1
         WHERE state.singleton
         RETURNING state.next_deletion_sequence - 1 INTO allocated_sequence;
        IF allocated_sequence IS NULL THEN
            RAISE EXCEPTION 'retention state is absent';
        END IF;
        INSERT INTO public.ps8_resource_graveyard (
            resource_id, resource_incarnation_id, final_version, workspace_id,
            journey_id, audience, party_id, deleted_at, deletion_sequence
        ) VALUES (
            NEW.id, NEW.resource_incarnation_id, NEW.version, NEW.workspace_id,
            NEW.journey_id, NEW.audience, NEW.party_id, NEW.deleted_at,
            allocated_sequence
        );
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION ps8_record_resource_graveyard() FROM PUBLIC;

CREATE TRIGGER ps8_guard_resource_insert
BEFORE INSERT ON resources
FOR EACH ROW EXECUTE FUNCTION public.ps8_guard_resource_lifecycle();
CREATE TRIGGER ps8_guard_resource_update
BEFORE UPDATE ON resources
FOR EACH ROW EXECUTE FUNCTION public.ps8_guard_resource_lifecycle();
CREATE TRIGGER ps8_record_resource_delete
AFTER UPDATE OF deleted_at ON resources
FOR EACH ROW EXECUTE FUNCTION public.ps8_record_resource_graveyard();

CREATE FUNCTION ps8_run_retention() RETURNS TABLE (
    payloads_cleared bigint,
    markers_purged bigint,
    retained_floor bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    cleared bigint;
    purged bigint;
    next_retained_floor bigint;
BEGIN
    -- Match command/revocation order: grant projection first, then the
    -- retention-job mutex, then resource rows, and only then the counter/state
    -- row. Graveyard triggers use resource -> state and never take this mutex,
    -- so a limited writer cannot invert retention -> resource ordering.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('trax-ps8-sync-grants', 0)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('trax-ps8-retention', 0)
    );

    UPDATE public.resources AS resource
       SET payload = NULL
     WHERE resource.deleted_at IS NOT NULL
       AND resource.payload IS NOT NULL
       AND public.ps8_now() > resource.deleted_at + interval '30 days';
    GET DIAGNOSTICS cleared = ROW_COUNT;

    WITH expired AS (
        SELECT graveyard.resource_id, graveyard.resource_incarnation_id
          FROM public.ps8_resource_graveyard AS graveyard
          CROSS JOIN public.ps8_retention_state AS state
         WHERE state.singleton
           AND public.ps8_now() > graveyard.deleted_at + state.graveyard_retention
         FOR UPDATE OF graveyard
    ), removed_resources AS (
        DELETE FROM public.resources AS resource
         USING expired
         WHERE resource.id = expired.resource_id
           AND resource.resource_incarnation_id = expired.resource_incarnation_id
        RETURNING resource.id
    ), removed_markers AS (
        DELETE FROM public.ps8_resource_graveyard AS graveyard
         USING expired
         WHERE graveyard.resource_id = expired.resource_id
           AND graveyard.resource_incarnation_id = expired.resource_incarnation_id
        RETURNING graveyard.deletion_sequence
    )
    SELECT pg_catalog.count(*)
      INTO purged
      FROM removed_markers;

    IF purged > 0 THEN
        -- Read and update state only after resource/marker deletion. A concurrent
        -- soft delete serializes on this row; either its marker is visible to
        -- this statement or its allocated value is the next safe floor.
        SELECT coalesce(
                   pg_catalog.min(graveyard.deletion_sequence),
                   state.next_deletion_sequence
               )
          INTO next_retained_floor
          FROM public.ps8_retention_state AS state
          LEFT JOIN public.ps8_resource_graveyard AS graveyard ON true
         WHERE state.singleton
         GROUP BY state.next_deletion_sequence;
        UPDATE public.ps8_retention_state AS state
           SET retained_graveyard_floor = greatest(
               state.retained_graveyard_floor,
               next_retained_floor
           )
         WHERE state.singleton;
    END IF;

    RETURN QUERY
    SELECT cleared, purged, state.retained_graveyard_floor
      FROM public.ps8_retention_state AS state
     WHERE state.singleton;
END;
$$;
REVOKE ALL ON FUNCTION ps8_run_retention() FROM PUBLIC;

-- R1 deliberately evaluates only server-owned state. R2 must bind the two
-- checkpoint arguments to an authenticated registered replica; device
-- self-report is not trusted by this function or claimed by this spike slice.
CREATE FUNCTION ps8_replica_reset_required(
    last_successful_sync_at timestamptz,
    checkpoint_sequence bigint
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT last_successful_sync_at IS NULL
        OR checkpoint_sequence IS NULL
        OR public.ps8_now() > last_successful_sync_at + interval '90 days'
        OR checkpoint_sequence < state.retained_graveyard_floor
      FROM public.ps8_retention_state AS state
     WHERE state.singleton
$$;
REVOKE ALL ON FUNCTION ps8_replica_reset_required(timestamptz, bigint) FROM PUBLIC;

CREATE FUNCTION refresh_sync_grants() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('trax-ps8-sync-grants', 0)
    );
    DELETE FROM public.sync_grants;
    INSERT INTO public.sync_grants (
        resource_id, user_id, grant_path, workspace_id, journey_id, party_id,
        user_active, workspace_active, journey_active, party_active
    )
    SELECT
        resource.id, membership.user_id, 'journey', resource.workspace_id,
        resource.journey_id, NULL, users.active, workspace_membership.active,
        membership.active, true
    FROM public.resources AS resource
    JOIN public.journey_memberships AS membership
      ON membership.workspace_id = resource.workspace_id
     AND membership.journey_id = resource.journey_id
    JOIN public.workspace_memberships AS workspace_membership
      ON workspace_membership.workspace_id = membership.workspace_id
     AND workspace_membership.user_id = membership.user_id
    JOIN public.users AS users ON users.id = membership.user_id
    WHERE resource.audience = 'journey'
    UNION ALL
    SELECT
        resource.id, party_membership.user_id,
        'party:' || party_membership.party_id::text, resource.workspace_id,
        resource.journey_id, party_membership.party_id, users.active,
        workspace_membership.active, journey_membership.active,
        party_membership.active
    FROM public.resources AS resource
    JOIN public.party_memberships AS party_membership
      ON party_membership.workspace_id = resource.workspace_id
     AND party_membership.journey_id = resource.journey_id
     AND party_membership.party_id = resource.party_id
    JOIN public.journey_memberships AS journey_membership
      ON journey_membership.workspace_id = party_membership.workspace_id
     AND journey_membership.journey_id = party_membership.journey_id
     AND journey_membership.user_id = party_membership.user_id
    JOIN public.workspace_memberships AS workspace_membership
      ON workspace_membership.workspace_id = journey_membership.workspace_id
     AND workspace_membership.user_id = journey_membership.user_id
    JOIN public.users AS users ON users.id = journey_membership.user_id
    WHERE resource.audience = 'party';
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION refresh_sync_grants() FROM PUBLIC;

CREATE TRIGGER refresh_sync_grants_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_workspaces
AFTER INSERT OR UPDATE OR DELETE ON workspace_memberships
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_journeys
AFTER INSERT OR UPDATE OR DELETE ON journey_memberships
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_parties
AFTER INSERT OR UPDATE OR DELETE ON party_memberships
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_resources_insert_delete
AFTER INSERT OR DELETE ON resources
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_sync_grants();
CREATE TRIGGER refresh_sync_grants_resources_scope_update
AFTER UPDATE OF workspace_id, journey_id, audience, party_id ON resources
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_sync_grants();

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
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT pg_catalog.pg_advisory_xact_lock_shared(
        pg_catalog.hashtextextended('trax-ps8-sync-grants', 0)
    )
$$;
REVOKE ALL ON FUNCTION ps8_acquire_grant_read_lock() FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO ps8_replication, ps8_token_reader, ps8_command_writer;
GRANT EXECUTE ON FUNCTION ps8_acquire_grant_read_lock(), ps8_now(), ps8_replica_reset_required(timestamptz, bigint) TO ps8_command_writer;
GRANT SELECT ON resources, sync_grants TO ps8_replication;
GRANT SELECT (id, active) ON users TO ps8_token_reader;
GRANT SELECT ON resources, sync_grants, ps8_command_receipts TO ps8_command_writer;
GRANT SELECT ON ps8_retention_state TO ps8_command_writer;
GRANT SELECT, INSERT, UPDATE ON ps8_replicas TO ps8_command_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ps8_replica_challenges TO ps8_command_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ps8_command_rate_windows TO ps8_command_writer;
GRANT UPDATE (payload, version, deleted_at) ON resources TO ps8_command_writer;
GRANT INSERT ON ps8_command_receipts, ps8_command_change_events TO ps8_command_writer;

CREATE PUBLICATION powersync FOR TABLE resources, sync_grants;
