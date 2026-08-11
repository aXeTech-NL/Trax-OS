#!/bin/sh
set -eu

# Explicit one-time development-volume upgrade. This is intentionally separate
# from normal Compose startup: production roles are provisioned out of band.
if [ "${TRAX_ROLE_UPGRADE_IN_CONTAINER:-0}" != "1" ]; then
  : "${TRAX_LEGACY_ADMIN_USER:?TRAX_LEGACY_ADMIN_USER is required}"
  : "${TRAX_LEGACY_ADMIN_PASSWORD:?TRAX_LEGACY_ADMIN_PASSWORD is required}"
  : "${COMPOSE_ENV_FILE:=.env.example}"

  # Credentials travel only over stdin. Remove them from the environment
  # inherited by the Docker CLI so they cannot appear in argv or container
  # inspection output.
  printf '%s\n%s\n' "$TRAX_LEGACY_ADMIN_USER" "$TRAX_LEGACY_ADMIN_PASSWORD" |
    env -u TRAX_LEGACY_ADMIN_USER -u TRAX_LEGACY_ADMIN_PASSWORD \
      docker compose --env-file "$COMPOSE_ENV_FILE" exec -T --user postgres \
      -e TRAX_ROLE_UPGRADE_IN_CONTAINER=1 database \
      /opt/trax/upgrade-development-roles.sh
  exit $?
fi

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${TRAX_RUNTIME_DB_USER:?TRAX_RUNTIME_DB_USER is required}"
: "${TRAX_RUNTIME_DB_PASSWORD:?TRAX_RUNTIME_DB_PASSWORD is required}"

if [ "$POSTGRES_USER" != "trax_admin" ] || [ "$TRAX_RUNTIME_DB_USER" != "trax_app" ]; then
  echo "The development upgrade only provisions fixed trax_admin and trax_app roles." >&2
  exit 2
fi

IFS= read -r legacy_admin_user
IFS= read -r legacy_admin_password
if [ -z "$legacy_admin_user" ] || [ -z "$legacy_admin_password" ]; then
  echo "Legacy administrator credentials must be supplied over stdin." >&2
  exit 2
fi

umask 077
admin_password_file=$(mktemp)
runtime_password_file=$(mktemp)
trap 'rm -f "$admin_password_file" "$runtime_password_file"' EXIT HUP INT TERM
printf '%s' "$POSTGRES_PASSWORD" > "$admin_password_file"
printf '%s' "$TRAX_RUNTIME_DB_PASSWORD" > "$runtime_password_file"

PGPASSWORD=$legacy_admin_password
export PGPASSWORD
psql --set=ON_ERROR_STOP=1 \
  --username "$legacy_admin_user" \
  --dbname "$POSTGRES_DB" \
  --set=legacy_admin_user="$legacy_admin_user" \
  --set=admin_user="$POSTGRES_USER" \
  --set=admin_password_file="$admin_password_file" \
  --set=runtime_user="$TRAX_RUNTIME_DB_USER" \
  --set=runtime_password_file="$runtime_password_file" <<'SQL'
BEGIN;

SELECT current_user = :'legacy_admin_user' AS connected_as_legacy_admin
\gset
\if :connected_as_legacy_admin
\else
  \echo 'Legacy administrator identity mismatch.'
  \quit 3
\endif

SELECT format(
  'CREATE ROLE %I LOGIN SUPERUSER CREATEDB CREATEROLE INHERIT NOREPLICATION BYPASSRLS PASSWORD %L',
  :'admin_user',
  pg_read_file(:'admin_password_file')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'admin_user')
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN SUPERUSER CREATEDB CREATEROLE INHERIT NOREPLICATION BYPASSRLS PASSWORD %L',
  :'admin_user',
  pg_read_file(:'admin_password_file')
)
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'runtime_user',
  pg_read_file(:'runtime_password_file')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user')
\gexec

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_auth_members membership
  JOIN pg_roles runtime_role
    ON runtime_role.oid IN (membership.member, membership.roleid)
  WHERE runtime_role.rolname = :'runtime_user'
) AS runtime_role_has_no_memberships
\gset
\if :runtime_role_has_no_memberships
\else
  \echo 'The runtime database role must not have any role memberships.'
  \quit 3
\endif

SELECT format(
  'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'runtime_user',
  pg_read_file(:'runtime_password_file')
)
\gexec

COMMIT;
SQL
