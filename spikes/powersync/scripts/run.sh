#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SPIKE_DIR/../.." && pwd)"
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
export PS8_COMMAND_PORT="${PS8_COMMAND_PORT:-17070}"
export PS8_POWERSYNC_PORT="${PS8_POWERSYNC_PORT:-18080}"
node - "$PS8_POSTGRES_PORT" "$PS8_TOKEN_PORT" "$PS8_COMMAND_PORT" "$PS8_POWERSYNC_PORT" <<'NODE'
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
export PS8_POST_COMMIT_FAULT_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"

RUN_DIRECTORY="$SPIKE_DIR/.runtime/$PS8_RUN_ID"
EVIDENCE_DIRECTORY="$SPIKE_DIR/.evidence/$PS8_RUN_ID"
if [[ -e "$RUN_DIRECTORY" || -e "$EVIDENCE_DIRECTORY" ]]; then
  echo "Refusing to reuse Issue #8 run/evidence directory for $PS8_RUN_ID." >&2
  exit 2
fi
export PS8_OWNER_FILE="$RUN_DIRECTORY/owner"
export PS8_WRAPPER_COMMAND="COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME PS8_RUN_ID=$PS8_RUN_ID spikes/powersync/scripts/run.sh"
export PS8_SOURCE_REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
PS8_EXECUTABLE_SOURCE_PATHS=(
  spikes/powersync/.env.example
  spikes/powersync/compose.yaml
  spikes/powersync/config
  spikes/powersync/harness/Dockerfile
  spikes/powersync/harness/package-lock.json
  spikes/powersync/harness/package.json
  spikes/powersync/harness/src
  spikes/powersync/harness/tests
  spikes/powersync/harness/tsconfig.json
  spikes/powersync/postgres
  spikes/powersync/scripts
  spikes/powersync/versions.env
)
export PS8_SOURCE_SCOPE="spike executable, configuration, schema and test sources; documentation and generated/runtime artifacts excluded"
export PS8_SOURCE_DIRTY="$([[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=all -- "${PS8_EXECUTABLE_SOURCE_PATHS[@]}")" ]] && echo true || echo false)"
export PS8_SOURCE_TREE_DIGEST="$(python - "$REPO_ROOT" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys
root = Path(sys.argv[1])
paths = [
    root / "spikes/powersync/.env.example",
    root / "spikes/powersync/compose.yaml",
    root / "spikes/powersync/config",
    root / "spikes/powersync/harness/Dockerfile",
    root / "spikes/powersync/harness/package-lock.json",
    root / "spikes/powersync/harness/package.json",
    root / "spikes/powersync/harness/src",
    root / "spikes/powersync/harness/tests",
    root / "spikes/powersync/harness/tsconfig.json",
    root / "spikes/powersync/postgres",
    root / "spikes/powersync/scripts",
    root / "spikes/powersync/versions.env",
]
excluded = {".evidence", ".runtime", "node_modules", "lib", "__pycache__"}
files = []
for target in paths:
    if target.is_file(): files.append(target)
    elif target.exists(): files.extend(path for path in target.rglob("*") if path.is_file() and not excluded.intersection(path.relative_to(root).parts))
digest = sha256()
for path in sorted(set(files)):
    relative = path.relative_to(root).as_posix().encode()
    digest.update(len(relative).to_bytes(4, "big")); digest.update(relative)
    content = path.read_bytes(); digest.update(len(content).to_bytes(8, "big")); digest.update(content)
print(digest.hexdigest())
PY
)"
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
export PS8_COMMAND_URL="http://127.0.0.1:$PS8_COMMAND_PORT"
export PS8_POWERSYNC_URL="http://127.0.0.1:$PS8_POWERSYNC_PORT"
export PS8_DATABASE_URL="postgres://${PS8_POSTGRES_USER:-postgres}:${PS8_POSTGRES_PASSWORD:-trax-ps8-postgres-only}@127.0.0.1:$PS8_POSTGRES_PORT/${PS8_POSTGRES_DB:-powersync_spike}"
export PS8_RUNTIME_DIR="$RUN_DIRECTORY/replicas"
export PS8_EVIDENCE_DIR="$EVIDENCE_DIRECTORY"
INTEGRATION_TRANSCRIPT="$EVIDENCE_DIRECTORY/integration-test.tap.log"
: > "$INTEGRATION_TRANSCRIPT"
chmod 600 "$INTEGRATION_TRANSCRIPT"
set +e
integration_output="$("${NPM10[@]}" run test:integration --prefix "$HARNESS_DIR" 2>&1)"
integration_status=$?
set -e
sanitized_output="$(printf '%s' "$integration_output" | node -e '
let transcript = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { transcript += chunk; });
process.stdin.on("end", () => {
  const secrets = [
    ...Object.values(JSON.parse(process.env.PS8_TOKEN_CREDENTIALS_JSON)),
    process.env.PS8_POST_COMMIT_FAULT_SECRET,
    process.env.PS8_POSTGRES_PASSWORD,
  ].filter(Boolean);
  for (const secret of secrets) transcript = transcript.replaceAll(secret, "[redacted-secret]");
  transcript = transcript.replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-jwt]");
  process.stdout.write(transcript);
});')"
printf '%s\n' "$sanitized_output" | tee "$INTEGRATION_TRANSCRIPT"
unset integration_output sanitized_output
chmod 600 "$INTEGRATION_TRANSCRIPT"
if [[ "$integration_status" != "0" ]]; then
  echo "Issue #8 integration failed; sanitized transcript retained at $INTEGRATION_TRANSCRIPT." >&2
  exit "$integration_status"
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
  "$(docker compose version --short)" \
  "$PS8_SOURCE_REVISION" \
  "$PS8_SOURCE_DIRTY" \
  "$PS8_SOURCE_TREE_DIGEST" \
  "$PS8_SOURCE_SCOPE" <<'NODE'
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
  sourceRevision,
  sourceDirty,
  sourceTreeDigest,
  sourceScope,
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
  candidate: {
    revision: sourceRevision,
    dirty: sourceDirty === 'true',
    sourceTreeDigest,
    sourceScope,
  },
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
    commandEndpoint: process.env.PS8_COMMAND_URL,
    powerSyncEndpoint: process.env.PS8_POWERSYNC_URL,
    images: parseJsonOrLines(imagesFile),
    containers: parseJsonOrLines(psFile),
  },
};
fs.writeFileSync(target, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
NODE

"$SPIKE_DIR/scripts/clean.sh"
CLEANED=1

PS8_EVIDENCE_CHECK="scoped-replication-revocation-and-experimental-command-upload" \
PS8_EVIDENCE_STATE="executed-uncommitted" \
PS8_EVIDENCE_COMMAND="$PS8_WRAPPER_COMMAND" \
PS8_EVIDENCE_EXECUTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
PS8_EVIDENCE_EXIT_CODE=0 \
PS8_EVIDENCE_DETAILS="Pinned npm 10 static/unit checks and the real isolated PowerSync service completed prior scoped-download/revocation assertions plus experimental insert-only command upload, idempotency, optimistic conflict, reconciliation and tombstone assertions. Destructive cleanup succeeded before this non-immutable candidate observation was recorded." \
PS8_EVIDENCE_CONTEXT_FILE="$CONTEXT_FILE" \
PS8_EVIDENCE_OBSERVATIONS_FILE="$EVIDENCE_DIRECTORY/integration-observations.json" \
PS8_EVIDENCE_DIR="$EVIDENCE_DIRECTORY" \
"${NPM10[@]}" run record:evidence --prefix "$HARNESS_DIR"

printf 'Issue #8 candidate evidence retained under %s\n' "$EVIDENCE_DIRECTORY"
