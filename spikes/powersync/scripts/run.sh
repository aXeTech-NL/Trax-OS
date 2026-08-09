#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_DIR="$SPIKE_DIR/harness"
NPM10=(npx --yes npm@10.9.4)

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" == "22" ]] || {
  echo "Issue #8 harness requires Node.js 22; found $(node --version)." >&2
  exit 2
}
[[ "$("${NPM10[@]}" --version)" == "10.9.4" ]] || {
  echo "Unable to execute the pinned npm 10.9.4 toolchain." >&2
  exit 2
}

export PS8_RUN_ID="${PS8_RUN_ID:-$(node -e 'console.log(crypto.randomUUID())')}"
if [[ ! "$PS8_RUN_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
  echo "PS8_RUN_ID must be a version-4 UUID." >&2
  exit 2
fi
safe_user="$(tr -cd 'a-z0-9-' <<<"${USER:-user}" | head -c 16)"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-trax-ps8-${safe_user:-user}-$PS8_RUN_ID}"
case "$COMPOSE_PROJECT_NAME" in
  trax-ps8-*) ;;
  *)
    echo "COMPOSE_PROJECT_NAME must start with trax-ps8-." >&2
    exit 2
    ;;
esac

for existing in \
  "$(docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")" \
  "$(docker volume ls -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")" \
  "$(docker network ls -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")"; do
  if [[ -n "$existing" ]]; then
    echo "Refusing to reuse existing Compose project $COMPOSE_PROJECT_NAME." >&2
    exit 2
  fi
done

export PS8_POSTGRES_PORT="${PS8_POSTGRES_PORT:-15432}"
export PS8_TOKEN_PORT="${PS8_TOKEN_PORT:-16060}"
export PS8_POWERSYNC_PORT="${PS8_POWERSYNC_PORT:-18080}"
node - "$PS8_POSTGRES_PORT" "$PS8_TOKEN_PORT" "$PS8_POWERSYNC_PORT" <<'NODE'
const net = require('node:net');
const ports = process.argv.slice(2).map(Number);
const servers = [];
Promise.all(ports.map((port) => new Promise((resolve, reject) => {
  const server = net.createServer();
  servers.push(server);
  server.once('error', (error) => reject(new Error(`Loopback port ${port} is unavailable: ${error.message}`)));
  server.listen(port, '127.0.0.1', resolve);
}))).then(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))))
  .catch((error) => { console.error(error.message); for (const server of servers) server.close(); process.exit(2); });
NODE

export PS8_TOKEN_CREDENTIALS_JSON="$(node - <<'NODE'
const { randomBytes } = require('node:crypto');
console.log(JSON.stringify(Object.fromEntries(['alice','bob','casey','eve'].map((name) => [name, randomBytes(32).toString('hex')]))));
NODE
)"

RUN_DIRECTORY="$SPIKE_DIR/.runtime/$PS8_RUN_ID"
EVIDENCE_DIRECTORY="$SPIKE_DIR/.evidence/$PS8_RUN_ID"
export PS8_OWNER_FILE="$RUN_DIRECTORY/owner"
export PS8_WRAPPER_COMMAND="COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME PS8_RUN_ID=$PS8_RUN_ID spikes/powersync/scripts/run.sh"
mkdir -p "$RUN_DIRECTORY" "$EVIDENCE_DIRECTORY"
printf '%s|%s' "$COMPOSE_PROJECT_NAME" "$PS8_RUN_ID" > "$PS8_OWNER_FILE"
chmod 600 "$PS8_OWNER_FILE"

COMPOSE=(
  docker compose
  --project-name "$COMPOSE_PROJECT_NAME"
  --env-file "$SPIKE_DIR/versions.env"
  --env-file "$SPIKE_DIR/.env.example"
  -f "$SPIKE_DIR/compose.yaml"
)

CLEANED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$CLEANED" != "1" && "${PS8_KEEP_STACK:-0}" != "1" ]]; then
    if ! "$SPIKE_DIR/scripts/clean.sh"; then
      echo "Mandatory Issue #8 cleanup failed." >&2
      status=1
    fi
  elif [[ "${PS8_KEEP_STACK:-0}" == "1" ]]; then
    echo "Retaining isolated stack $COMPOSE_PROJECT_NAME because PS8_KEEP_STACK=1."
  fi
  exit "$status"
}
trap cleanup_on_exit EXIT

"$SPIKE_DIR/scripts/verify-provenance.sh"
"${NPM10[@]}" ci --prefix "$HARNESS_DIR"
"${NPM10[@]}" run check --prefix "$HARNESS_DIR"
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull source-db powersync
"${COMPOSE[@]}" up --build --detach --wait
"${COMPOSE[@]}" images --format json > "$EVIDENCE_DIRECTORY/compose-images.json"
"${COMPOSE[@]}" ps --format json > "$EVIDENCE_DIRECTORY/compose-ps.json"

export PS8_PINNED_RUN=1
export PS8_TOKEN_URL="http://127.0.0.1:$PS8_TOKEN_PORT"
export PS8_POWERSYNC_URL="http://127.0.0.1:$PS8_POWERSYNC_PORT"
export PS8_DATABASE_URL="postgres://${PS8_POSTGRES_USER:-postgres}:${PS8_POSTGRES_PASSWORD:-trax-ps8-postgres-only}@127.0.0.1:$PS8_POSTGRES_PORT/${PS8_POSTGRES_DB:-powersync_spike}"
export PS8_RUNTIME_DIR="$RUN_DIRECTORY/replicas"
export PS8_EVIDENCE_DIR="$EVIDENCE_DIRECTORY"
INTEGRATION_TRANSCRIPT="$EVIDENCE_DIRECTORY/integration-test.tap.log"
: > "$INTEGRATION_TRANSCRIPT"
chmod 600 "$INTEGRATION_TRANSCRIPT"
set +e
"${NPM10[@]}" run test:integration --prefix "$HARNESS_DIR" 2>&1 | tee "$INTEGRATION_TRANSCRIPT"
pipeline_status=("${PIPESTATUS[@]}")
set -e
node - "$INTEGRATION_TRANSCRIPT" <<'NODE'
const fs = require('node:fs');
const target = process.argv[2];
let transcript = fs.readFileSync(target, 'utf8');
for (const secret of Object.values(JSON.parse(process.env.PS8_TOKEN_CREDENTIALS_JSON))) {
  transcript = transcript.replaceAll(secret, '[redacted-credential]');
}
transcript = transcript.replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]');
fs.writeFileSync(target, transcript, { mode: 0o600 });
NODE
chmod 600 "$INTEGRATION_TRANSCRIPT"
if [[ "${pipeline_status[1]}" != "0" ]]; then
  echo "Unable to retain the sanitized Issue #8 integration transcript." >&2
  exit "${pipeline_status[1]}"
fi
if [[ "${pipeline_status[0]}" != "0" ]]; then
  echo "Issue #8 integration failed; sanitized transcript retained at $INTEGRATION_TRANSCRIPT." >&2
  exit "${pipeline_status[0]}"
fi

CONTEXT_FILE="$EVIDENCE_DIRECTORY/run-context.json"
node - \
  "$CONTEXT_FILE" \
  "$EVIDENCE_DIRECTORY/compose-images.json" \
  "$EVIDENCE_DIRECTORY/compose-ps.json" \
  "$(node --version)" \
  "$("${NPM10[@]}" --version)" \
  "$(docker version --format '{{.Client.Version}}')" \
  "$(docker version --format '{{.Server.Version}}')" \
  "$(docker compose version --short)" <<'NODE'
const fs = require('node:fs');
const [
  target,
  imagesFile,
  psFile,
  nodeVersion,
  npmVersion,
  dockerClientVersion,
  dockerServerVersion,
  dockerComposeVersion,
] = process.argv.slice(2);
function parseJsonOrLines(filename) {
  const raw = fs.readFileSync(filename, 'utf8').trim();
  try { return JSON.parse(raw); }
  catch { return raw.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line)); }
}
const context = {
  runId: process.env.PS8_RUN_ID,
  composeProject: process.env.COMPOSE_PROJECT_NAME,
  wrapperCommand: process.env.PS8_WRAPPER_COMMAND,
  environment: {
    platform: `${process.platform}-${process.arch}`,
    nodeVersion,
    npmVersion,
    dockerClientVersion,
    dockerServerVersion,
    dockerComposeVersion,
  },
  serviceMetadata: {
    tokenEndpoint: process.env.PS8_TOKEN_URL,
    powerSyncEndpoint: process.env.PS8_POWERSYNC_URL,
    images: parseJsonOrLines(imagesFile),
    containers: parseJsonOrLines(psFile),
  },
};
fs.writeFileSync(target, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
NODE

"$SPIKE_DIR/scripts/clean.sh"
CLEANED=1

PS8_EVIDENCE_CHECK="scoped-replication-and-hierarchical-online-revocation" \
PS8_EVIDENCE_STATE="executed-uncommitted" \
PS8_EVIDENCE_COMMAND="$PS8_WRAPPER_COMMAND" \
PS8_EVIDENCE_EXECUTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
PS8_EVIDENCE_EXIT_CODE=0 \
PS8_EVIDENCE_DETAILS="Pinned npm 10 static/unit checks and the real isolated PowerSync service completed exact identity, same-workspace Journey, cross-workspace/party and user/workspace/Journey/party online revocation assertions. Destructive cleanup succeeded before this non-immutable candidate observation was recorded." \
PS8_EVIDENCE_CONTEXT_FILE="$CONTEXT_FILE" \
PS8_EVIDENCE_OBSERVATIONS_FILE="$EVIDENCE_DIRECTORY/integration-observations.json" \
PS8_EVIDENCE_DIR="$EVIDENCE_DIRECTORY" \
"${NPM10[@]}" run record:evidence --prefix "$HARNESS_DIR"

printf 'Issue #8 candidate evidence retained under %s\n' "$EVIDENCE_DIRECTORY"
