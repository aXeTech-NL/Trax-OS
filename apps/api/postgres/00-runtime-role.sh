#!/bin/sh
set -eu

# Development/CI bootstrap only. Production deployments provision the fixed
# runtime role out of band and never reuse these example credentials.
: "${TRAX_RUNTIME_DB_USER:?TRAX_RUNTIME_DB_USER is required}"
: "${TRAX_RUNTIME_DB_PASSWORD:?TRAX_RUNTIME_DB_PASSWORD is required}"

if [ "$TRAX_RUNTIME_DB_USER" != "trax_app" ]; then
  echo "The runtime database role must be the fixed trax_app role." >&2
  exit 2
fi

umask 077
runtime_password_file=$(mktemp)
trap 'rm -f "$runtime_password_file"' EXIT HUP INT TERM
printf '%s' "$TRAX_RUNTIME_DB_PASSWORD" > "$runtime_password_file"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=runtime_user="$TRAX_RUNTIME_DB_USER" \
  --set=runtime_password_file="$runtime_password_file" <<'SQL'
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
SQL
