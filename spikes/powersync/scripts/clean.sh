#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${COMPOSE_PROJECT_NAME:-}"
RUN_ID="${PS8_RUN_ID:-}"
OWNER_FILE="${PS8_OWNER_FILE:-$SPIKE_DIR/.runtime/$RUN_ID/owner}"

case "$PROJECT" in
  trax-ps8-*) ;;
  *)
    echo "Refusing destructive cleanup: COMPOSE_PROJECT_NAME must start with trax-ps8-." >&2
    exit 2
    ;;
esac

if [[ ! "$RUN_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
  echo "Refusing destructive cleanup: PS8_RUN_ID must be a version-4 UUID." >&2
  exit 2
fi
if [[ ! -f "$OWNER_FILE" ]]; then
  echo "Refusing destructive cleanup: ownership marker is absent." >&2
  exit 2
fi
expected_owner="$PROJECT|$RUN_ID"
actual_owner="$(cat "$OWNER_FILE")"
if [[ "$actual_owner" != "$expected_owner" ]]; then
  echo "Refusing destructive cleanup: ownership marker does not match project/run." >&2
  exit 2
fi

verify_resources() {
  local kind="$1"
  shift
  local ids id owner run
  ids="$(docker "$@" -q --filter "label=com.docker.compose.project=$PROJECT")"
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    if [[ "$kind" == "container" ]]; then
      owner="$(docker container inspect --format '{{index .Config.Labels "com.trax-os.spike.owner"}}' "$id")"
      run="$(docker container inspect --format '{{index .Config.Labels "com.trax-os.spike.run"}}' "$id")"
    else
      owner="$(docker "$kind" inspect --format '{{index .Labels "com.trax-os.spike.owner"}}' "$id")"
      run="$(docker "$kind" inspect --format '{{index .Labels "com.trax-os.spike.run"}}' "$id")"
    fi
    if [[ "$owner" != "issue-8-powersync" || "$run" != "$RUN_ID" ]]; then
      echo "Refusing destructive cleanup: $kind resource $id is not owned by run $RUN_ID." >&2
      exit 2
    fi
  done <<<"$ids"
}

verify_resources container ps -a
verify_resources volume volume ls
verify_resources network network ls

# Compose requires this interpolation value even for `down`; it is never sent to
# an already-running service during cleanup.
if [[ -z "${PS8_TOKEN_CREDENTIALS_JSON:-}" ]]; then
  export PS8_TOKEN_CREDENTIALS_JSON='{"alice":"cleanup-only-not-a-runtime-secret-0001","bob":"cleanup-only-not-a-runtime-secret-0002","casey":"cleanup-only-not-a-runtime-secret-0003","eve":"cleanup-only-not-a-runtime-secret-0004"}'
fi
if [[ -z "${PS8_POST_COMMIT_FAULT_SECRET:-}" ]]; then
  export PS8_POST_COMMIT_FAULT_SECRET='cleanup-only-not-a-runtime-secret-0000000000000000'
fi

COMPOSE=(
  docker compose
  --project-name "$PROJECT"
  --env-file "$SPIKE_DIR/versions.env"
  --env-file "$SPIKE_DIR/.env.example"
  -f "$SPIKE_DIR/compose.yaml"
)

"${COMPOSE[@]}" down --volumes --remove-orphans
rm -rf "$(dirname "$OWNER_FILE")"
