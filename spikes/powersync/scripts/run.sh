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
replica_rotation_secret="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
if [[ "$replica_rotation_secret" == "$PS8_POST_COMMIT_FAULT_SECRET" ]]; then
  echo "Per-run fault and replica-rotation secrets must be distinct." >&2
  exit 2
fi

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
chmod 700 "$RUN_DIRECTORY" "$EVIDENCE_DIRECTORY"
printf '%s|%s' "$COMPOSE_PROJECT_NAME" "$PS8_RUN_ID" > "$PS8_OWNER_FILE"
chmod 600 "$PS8_OWNER_FILE"
export PS8_REPLICA_ROTATION_ENV_FILE="$RUN_DIRECTORY/command-server-secrets.env"
printf 'PS8_REPLICA_ROTATION_SECRET=%s\n' "$replica_rotation_secret" > "$PS8_REPLICA_ROTATION_ENV_FILE"
chmod 600 "$PS8_REPLICA_ROTATION_ENV_FILE"

# Evidence permissions are an enforced wrapper invariant, independent of the
# caller's umask. Reject symbolic/special entries rather than silently retaining
# an artifact whose access mode cannot be attested.
enforce_evidence_permissions() {
  node - "$EVIDENCE_DIRECTORY" <<'NODE'
const fs = require('node:fs');
const root = process.argv[2];
function secure(directory) {
  fs.chmodSync(directory, 0o700);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = `${directory}/${entry.name}`;
    if (entry.isDirectory()) secure(target);
    else if (entry.isFile()) fs.chmodSync(target, 0o600);
    else throw new Error(`Unsupported evidence entry type: ${target}`);
  }
}
function verify(directory) {
  const directoryMode = fs.statSync(directory).mode & 0o777;
  if (directoryMode !== 0o700) throw new Error(`Evidence directory mode is ${directoryMode.toString(8)}, expected 700: ${directory}`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = `${directory}/${entry.name}`;
    if (entry.isDirectory()) verify(target);
    else if (entry.isFile()) {
      const mode = fs.statSync(target).mode & 0o777;
      if (mode !== 0o600) throw new Error(`Evidence artifact mode is ${mode.toString(8)}, expected 600: ${target}`);
    } else throw new Error(`Unsupported evidence entry type: ${target}`);
  }
}
secure(root);
verify(root);
NODE
}
enforce_evidence_permissions

assert_no_replica_credentials() {
  if grep -R -E -q --binary-files=without-match 'r2_[A-Za-z0-9_-]{43}' "$@"; then
    echo "Replica credential plaintext was found in retained evidence or service logs." >&2
    return 1
  fi
}

assert_no_rotation_secret() {
  local rotation_secret
  rotation_secret="${replica_rotation_secret}"
  if grep -R -F -q --binary-files=without-match "$rotation_secret" "$@"; then
    echo "Replica rotation secret was found outside the command-server secret input." >&2
    return 1
  fi
}

COMPOSE=(
  docker compose
  --project-name "$COMPOSE_PROJECT_NAME"
  --env-file "$SPIKE_DIR/versions.env"
  --env-file "$SPIKE_DIR/.env.example"
  --env-file "$PS8_REPLICA_ROTATION_ENV_FILE"
  -f "$SPIKE_DIR/compose.yaml"
)

CLEANED=0
PROXY_PID=""
OFFLINE_CONTAINER=""
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ -d "$EVIDENCE_DIRECTORY" ]] && ! enforce_evidence_permissions; then
    echo "Mandatory Issue #8 evidence permission enforcement failed." >&2
    status=1
  fi
  if [[ -n "$PROXY_PID" ]]; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
    PROXY_PID=""
  fi
  if [[ -n "$OFFLINE_CONTAINER" ]]; then
    docker rm -f "$OFFLINE_CONTAINER" >/dev/null 2>&1 || true
    OFFLINE_CONTAINER=""
  fi
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
container_ip() {
  local service="$1" container
  container="$("${COMPOSE[@]}" ps -q "$service")"
  docker inspect "$container" --format '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
}
PROXY_READY="$RUN_DIRECTORY/loopback-proxy.ready"
PROXY_LOG="$RUN_DIRECTORY/loopback-proxy.log"
start_loopback_proxy() {
  if [[ -n "$PROXY_PID" ]]; then kill "$PROXY_PID" 2>/dev/null || true; wait "$PROXY_PID" 2>/dev/null || true; fi
  rm -f "$PROXY_READY"
  local configuration
  configuration="$(node - \
    "$PS8_POSTGRES_PORT" "$(container_ip source-db)" 5432 \
    "$PS8_TOKEN_PORT" "$(container_ip token-server)" 6060 \
    "$PS8_COMMAND_PORT" "$(container_ip command-server)" 7070 \
    "$PS8_POWERSYNC_PORT" "$(container_ip powersync)" 8080 <<'NODE'
const a=process.argv.slice(2);const rows=[];for(let i=0;i<a.length;i+=3)rows.push({host:'127.0.0.1',listen:Number(a[i]),targetHost:a[i+1],targetPort:Number(a[i+2])});process.stdout.write(JSON.stringify(rows));
NODE
  )"
  node "$SPIKE_DIR/scripts/loopback-proxy.mjs" "$configuration" "$PROXY_READY" > "$PROXY_LOG" 2>&1 &
  PROXY_PID=$!
  for _ in {1..100}; do [[ -f "$PROXY_READY" ]] && break; kill -0 "$PROXY_PID" 2>/dev/null || { cat "$PROXY_LOG" >&2; exit 1; }; sleep 0.05; done
  [[ -f "$PROXY_READY" ]] || { echo "Loopback proxy did not become ready." >&2; exit 1; }
}
start_loopback_proxy
"${COMPOSE[@]}" images --format json > "$EVIDENCE_DIRECTORY/compose-images.json"
"${COMPOSE[@]}" ps --format json > "$EVIDENCE_DIRECTORY/compose-ps.json"
enforce_evidence_permissions

export PS8_PINNED_RUN=1
export PS8_TOKEN_URL="http://127.0.0.1:$PS8_TOKEN_PORT"
export PS8_COMMAND_URL="http://127.0.0.1:$PS8_COMMAND_PORT"
export PS8_POWERSYNC_URL="http://127.0.0.1:$PS8_POWERSYNC_PORT"
export PS8_DATABASE_URL="postgres://${PS8_POSTGRES_USER:-postgres}:${PS8_POSTGRES_PASSWORD:-trax-ps8-postgres-only}@127.0.0.1:$PS8_POSTGRES_PORT/${PS8_POSTGRES_DB:-powersync_spike}"
export PS8_COMMAND_DATABASE_URL="postgres://${PS8_COMMAND_WRITER_USER:-ps8_command_writer}:${PS8_COMMAND_WRITER_PASSWORD:-trax-ps8-command-writer-only}@127.0.0.1:$PS8_POSTGRES_PORT/${PS8_POSTGRES_DB:-powersync_spike}"
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
  const rotationLine = require("node:fs").readFileSync(process.env.PS8_REPLICA_ROTATION_ENV_FILE, "utf8").trim();
  secrets.push(rotationLine.slice(rotationLine.indexOf("=") + 1));
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

R4_TRANSCRIPT="$EVIDENCE_DIRECTORY/restart-offline-test.log"
: > "$R4_TRANSCRIPT"
chmod 600 "$R4_TRANSCRIPT"
run_r4_phase() {
  local phase="$1" output status sanitized
  set +e
  output="$("${NPM10[@]}" run restart:evidence --prefix "$HARNESS_DIR" -- "$phase" 2>&1)"
  status=$?
  set -e
  sanitized="$(printf '%s' "$output" | node -e '
let transcript="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>transcript+=c);process.stdin.on("end",()=>{
 const secrets=[...Object.values(JSON.parse(process.env.PS8_TOKEN_CREDENTIALS_JSON)),process.env.PS8_POST_COMMIT_FAULT_SECRET,process.env.PS8_POSTGRES_PASSWORD].filter(Boolean);
 const line=require("node:fs").readFileSync(process.env.PS8_REPLICA_ROTATION_ENV_FILE,"utf8").trim();secrets.push(line.slice(line.indexOf("=")+1));
 for(const secret of secrets)transcript=transcript.replaceAll(secret,"[redacted-secret]");
 transcript=transcript.replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,"[redacted-jwt]");
 transcript=transcript.replace(/r2_[A-Za-z0-9_-]{43}/g,"[redacted-replica-credential]");process.stdout.write(transcript);
});')"
  printf '\n===== R4 %s =====\n%s\n' "$phase" "$sanitized" | tee -a "$R4_TRANSCRIPT"
  unset output sanitized
  if [[ "$status" != 0 ]]; then
    echo "Issue #8 R4 phase $phase failed; sanitized transcript retained at $R4_TRANSCRIPT." >&2
    return "$status"
  fi
}

# Preserve the exact named volume and image set across a real four-service
# restart. Restart uses cached images only; no build/pull is permitted here.
source_volume="${COMPOSE_PROJECT_NAME}_source-data"
volume_before="$(docker volume inspect "$source_volume" --format '{{.Name}}|{{.Mountpoint}}')"
run_r4_phase setup
"${COMPOSE[@]}" restart source-db token-server command-server powersync
"${COMPOSE[@]}" up --detach --wait --pull never --no-build
start_loopback_proxy
node - "$("${COMPOSE[@]}" ps --format json)" <<'NODE'
const raw=process.argv[2].trim();const rows=raw.startsWith('[')?JSON.parse(raw):raw.split(/\n+/).filter(Boolean).map(JSON.parse);
if(rows.length!==4||rows.some(row=>row.State!=='running'||row.Health!=='healthy'))throw new Error('Restart did not restore exactly four healthy services.');
NODE
[[ "$(docker volume inspect "$source_volume" --format '{{.Name}}|{{.Mountpoint}}')" == "$volume_before" ]] || {
  echo "Source volume identity changed across restart." >&2; exit 1;
}
run_r4_phase verify

# Closed-replica availability is checked while every service and host-side
# loopback proxy is stopped. npm installation/build is repeated in strict
# offline mode from the warmed cache. The reader itself runs as a new process
# in a network-none, read-only container with the complete runtime bind mounted
# read-only; it emits sanitized IDs/counts to stdout and cannot update fixtures.
if [[ -n "$PROXY_PID" ]]; then
  kill "$PROXY_PID" 2>/dev/null || true
  wait "$PROXY_PID" 2>/dev/null || true
  PROXY_PID=""
fi
"${COMPOSE[@]}" stop powersync command-server token-server source-db
export NPM_CONFIG_OFFLINE=true
"${NPM10[@]}" ci --offline --prefix "$HARNESS_DIR"
"${NPM10[@]}" run build --offline --prefix "$HARNESS_DIR"
OFFLINE_CONTAINER="${COMPOSE_PROJECT_NAME}-offline-reader"
offline_image="trax-os/powersync-spike-command-server:issue-8-candidate"
docker create \
  --name "$OFFLINE_CONTAINER" \
  --label "com.trax-os.spike.owner=issue-8-powersync" \
  --label "com.trax-os.spike.run=$PS8_RUN_ID" \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=$RUN_DIRECTORY,dst=/r4-runtime,readonly" \
  --env "PS8_RUN_ID=$PS8_RUN_ID" \
  --env "PS8_RUNTIME_DIR=/r4-runtime/replicas" \
  --entrypoint node \
  "$offline_image" lib/src/restart-evidence.js offline >/dev/null
offline_inspect="$(docker inspect "$OFFLINE_CONTAINER")"
node - "$offline_inspect" "$RUN_DIRECTORY" <<'NODE'
const rows=JSON.parse(process.argv[2]);if(rows.length!==1)throw new Error('Offline reader inspect cardinality mismatch.');
const row=rows[0],runtime=process.argv[3];
if(row.HostConfig.NetworkMode!=='none'||row.HostConfig.ReadonlyRootfs!==true)throw new Error('Offline reader lacks network-none/read-only rootfs enforcement.');
const mount=row.Mounts.find(entry=>entry.Destination==='/r4-runtime');
if(!mount||mount.RW!==false||mount.Source!==runtime)throw new Error('Offline reader runtime mount is not the exact read-only run directory.');
NODE
set +e
offline_output="$(docker start -a "$OFFLINE_CONTAINER" 2>&1)"
offline_status=$?
set -e
docker rm "$OFFLINE_CONTAINER" >/dev/null
OFFLINE_CONTAINER=""
if [[ "$offline_status" != 0 ]]; then
  printf '\n===== R4 offline =====\n%s\n' "$offline_output" | tee -a "$R4_TRANSCRIPT"
  echo "Issue #8 network-none offline reader failed." >&2
  exit "$offline_status"
fi
printf '%s' "$offline_output" | node -e '
let raw="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>raw+=c);process.stdin.on("end",()=>{const value=JSON.parse(raw);if(value.offlineRead!==true||!Array.isArray(value.resourceIds)||!Array.isArray(value.resultIds)||!Array.isArray(value.quarantineIds)||value.resetPhase!==null)throw new Error("Invalid offline reader output");});'
printf '%s\n' "$offline_output" > "$EVIDENCE_DIRECTORY/offline-read-observation.json"
chmod 600 "$EVIDENCE_DIRECTORY/offline-read-observation.json"
printf '\n===== R4 offline (network none; runtime read-only) =====\n%s\n' "$offline_output" | tee -a "$R4_TRANSCRIPT"
unset offline_output
export PS8_R4_OFFLINE_READ_VERIFIED=1

# Cached recovery is fail-closed: Docker may neither pull nor build. The
# Compose network is internal, which blocks container egress but is not a claim
# that host networking was disabled.
"${COMPOSE[@]}" up --detach --wait --pull never --no-build
start_loopback_proxy
NETWORK_NAME="${COMPOSE_PROJECT_NAME}_default"
[[ "$(docker network inspect "$NETWORK_NAME" --format '{{.Internal}}')" == "true" ]] || {
  echo "Issue #8 Compose network is not internal." >&2; exit 1;
}
"${COMPOSE[@]}" images --format json > "$EVIDENCE_DIRECTORY/restart-compose-images.json"
chmod 600 "$EVIDENCE_DIRECTORY/restart-compose-images.json"
image_ids_unchanged="$(node - "$EVIDENCE_DIRECTORY/compose-images.json" "$EVIDENCE_DIRECTORY/restart-compose-images.json" <<'NODE'
const fs=require('node:fs');function rows(f){const raw=fs.readFileSync(f,'utf8').trim();return (raw.startsWith('[')?JSON.parse(raw):raw.split(/\n+/).filter(Boolean).map(JSON.parse)).map(x=>x.ID).sort();}
process.stdout.write(JSON.stringify(rows(process.argv[2]))===JSON.stringify(rows(process.argv[3]))?'1':'0');
NODE
)"
[[ "$image_ids_unchanged" == 1 ]] || { echo "Image IDs changed during cached restart." >&2; exit 1; }
[[ "$(docker volume inspect "$source_volume" --format '{{.Name}}|{{.Mountpoint}}')" == "$volume_before" ]] || {
  echo "Source volume identity changed during cached restart." >&2; exit 1;
}
export PS8_R4_IMAGE_IDS_UNCHANGED=1
export PS8_R4_NETWORK_INTERNAL=1
run_r4_phase cached

# Merge the separately-written R4 observation atomically so concurrent test
# writers never touch integration-observations.json.
node - "$EVIDENCE_DIRECTORY/integration-observations.json" "$EVIDENCE_DIRECTORY/restart-offline-observations.json" <<'NODE'
const fs=require('node:fs');const [target,addition]=process.argv.slice(2);const merged={...JSON.parse(fs.readFileSync(target,'utf8')),...JSON.parse(fs.readFileSync(addition,'utf8'))};
const temporary=`${target}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(merged,null,2)}\n`,{mode:0o600,flag:'wx'});const fd=fs.openSync(temporary,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,target);fs.chmodSync(target,0o600);
NODE
enforce_evidence_permissions
assert_no_replica_credentials "$EVIDENCE_DIRECTORY"
assert_no_rotation_secret "$EVIDENCE_DIRECTORY"

SERVICE_LOG="$RUN_DIRECTORY/service.log"
"${COMPOSE[@]}" logs --no-color > "$SERVICE_LOG"
chmod 600 "$SERVICE_LOG"
assert_no_replica_credentials "$EVIDENCE_DIRECTORY" "$SERVICE_LOG"
assert_no_rotation_secret "$EVIDENCE_DIRECTORY" "$SERVICE_LOG"
rm -f "$SERVICE_LOG"

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
PS8_EVIDENCE_DETAILS="Pinned npm 10 static/unit checks and the real isolated PowerSync service completed scoped download/revocation, experimental command/reconciliation, bounded retention/incarnation and honest-client registered-replica reset/quarantine assertions. Checkpoint completion remains client-observed rather than server-attested; quarantine encryption and forensic deletion are not validated. Destructive cleanup succeeded before this non-immutable candidate observation was recorded." \
PS8_EVIDENCE_CONTEXT_FILE="$CONTEXT_FILE" \
PS8_EVIDENCE_OBSERVATIONS_FILE="$EVIDENCE_DIRECTORY/integration-observations.json" \
PS8_EVIDENCE_DIR="$EVIDENCE_DIRECTORY" \
"${NPM10[@]}" run record:evidence --prefix "$HARNESS_DIR"
enforce_evidence_permissions
assert_no_replica_credentials "$EVIDENCE_DIRECTORY"
assert_no_rotation_secret "$EVIDENCE_DIRECTORY"

printf 'Issue #8 candidate evidence retained under %s\n' "$EVIDENCE_DIRECTORY"
