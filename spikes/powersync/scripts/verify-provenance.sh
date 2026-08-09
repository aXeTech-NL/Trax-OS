#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$SPIKE_DIR/versions.env"

for tool in docker git curl node npx; do
  command -v "$tool" >/dev/null || {
    echo "Required provenance tool is missing: $tool" >&2
    exit 2
  }
done
if command -v sha256sum >/dev/null; then
  HASH_COMMAND=(sha256sum)
elif command -v shasum >/dev/null; then
  HASH_COMMAND=(shasum -a 256)
else
  echo "sha256sum or shasum is required." >&2
  exit 2
fi
docker buildx version >/dev/null

verify_image() {
  local name="$1"
  local tag_reference="$2"
  local pinned_reference="$3"
  local expected_index="$4"
  local expected_amd64="$5"
  local metadata actual_index raw actual_amd64
  metadata="$(docker buildx imagetools inspect "$tag_reference")"
  actual_index="$(awk '/^Digest:/ {print $2; exit}' <<<"$metadata")"
  [[ "$actual_index" == "$expected_index" ]] || {
    echo "$name tag $tag_reference resolves to $actual_index, expected $expected_index." >&2
    exit 1
  }
  [[ "${pinned_reference##*@}" == "$expected_index" ]] || {
    echo "$name pinned reference does not contain recorded index digest." >&2
    exit 1
  }
  raw="$(docker buildx imagetools inspect --raw "$tag_reference")"
  actual_amd64="$(node -e '
    let raw="";
    process.stdin.on("data", (chunk) => raw += chunk).on("end", () => {
      const index = JSON.parse(raw);
      const match = (index.manifests ?? []).find((entry) =>
        entry.platform?.os === "linux" && entry.platform?.architecture === "amd64"
      );
      if (!match) process.exit(2);
      process.stdout.write(match.digest);
    });
  ' <<<"$raw")"
  [[ "$actual_amd64" == "$expected_amd64" ]] || {
    echo "$name linux/amd64 digest is $actual_amd64, expected $expected_amd64." >&2
    exit 1
  }
}

resolve_tag_commit() {
  local repository="$1"
  local tag="$2"
  local refs
  refs="$(git ls-remote "$repository" "refs/tags/$tag" "refs/tags/$tag^{}")"
  awk '$2 ~ /\^\{\}$/ {print $1; found=1} END {if (!found) print first} NR==1 {first=$1}' <<<"$refs"
}

hash_url() {
  local url="$1"
  curl -fsSL "$url" | "${HASH_COMMAND[@]}" | awk '{print $1}'
}

verify_image \
  "PowerSync service" \
  "journeyapps/powersync-service:$POWERSYNC_SERVICE_VERSION" \
  "$POWERSYNC_SERVICE_IMAGE" \
  "${POWERSYNC_SERVICE_IMAGE##*@}" \
  "$POWERSYNC_SERVICE_AMD64_DIGEST"
verify_image \
  "PostgreSQL" \
  "postgres:$POSTGRES_VERSION" \
  "$POSTGRES_IMAGE" \
  "${POSTGRES_IMAGE##*@}" \
  "$POSTGRES_AMD64_DIGEST"
verify_image \
  "Node" \
  "node:$NODE_VERSION" \
  "$NODE_IMAGE" \
  "${NODE_IMAGE##*@}" \
  "$NODE_AMD64_DIGEST"

labels="$(docker buildx imagetools inspect --format '{{json .Image.Config.Labels}}' "journeyapps/powersync-service@$POWERSYNC_SERVICE_AMD64_DIGEST")"
LABELS="$labels" \
EXPECTED_VERSION="$POWERSYNC_SERVICE_VERSION" \
EXPECTED_REVISION="$POWERSYNC_SERVICE_IMAGE_REVISION" \
EXPECTED_LICENSE="$POWERSYNC_SERVICE_LICENSE" \
node -e '
  const labels = JSON.parse(process.env.LABELS);
  const expected = {
    "org.opencontainers.image.version": process.env.EXPECTED_VERSION,
    "org.opencontainers.image.revision": process.env.EXPECTED_REVISION,
    "org.opencontainers.image.licenses": process.env.EXPECTED_LICENSE,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (labels?.[key] !== value) {
      console.error(`PowerSync image label ${key}=${labels?.[key]}, expected ${value}.`);
      process.exit(1);
    }
  }
'

actual_service_commit="$(resolve_tag_commit https://github.com/powersync-ja/powersync-service.git "$POWERSYNC_SERVICE_SOURCE_TAG")"
[[ "$actual_service_commit" == "$POWERSYNC_SERVICE_SOURCE_COMMIT" ]] || {
  echo "PowerSync service tag commit mismatch: $actual_service_commit" >&2
  exit 1
}

actual_client_commit="$(resolve_tag_commit https://github.com/powersync-ja/powersync-js.git "$POWERSYNC_NODE_SOURCE_TAG")"
[[ "$actual_client_commit" == "$POWERSYNC_NODE_SOURCE_COMMIT" ]] || {
  echo "PowerSync Node tag commit mismatch: $actual_client_commit" >&2
  exit 1
}

actual_client_version="$(npx --yes npm@10.9.4 view "@powersync/node@$POWERSYNC_NODE_VERSION" version)"
actual_client_integrity="$(npx --yes npm@10.9.4 view "@powersync/node@$POWERSYNC_NODE_VERSION" dist.integrity)"
actual_client_license="$(npx --yes npm@10.9.4 view "@powersync/node@$POWERSYNC_NODE_VERSION" license)"
[[ "$actual_client_version" == "$POWERSYNC_NODE_VERSION" ]] || {
  echo "@powersync/node version mismatch: $actual_client_version" >&2
  exit 1
}
[[ "$actual_client_integrity" == "$POWERSYNC_NODE_NPM_INTEGRITY" ]] || {
  echo "@powersync/node integrity mismatch: $actual_client_integrity" >&2
  exit 1
}
[[ "$actual_client_license" == "$POWERSYNC_NODE_LICENSE" ]] || {
  echo "@powersync/node license metadata mismatch: $actual_client_license" >&2
  exit 1
}

source_license_url="https://raw.githubusercontent.com/powersync-ja/powersync-service/$POWERSYNC_SERVICE_SOURCE_TAG/LICENSE"
actual_source_license_hash="$(hash_url "$source_license_url")"
[[ "$actual_source_license_hash" == "$POWERSYNC_SERVICE_LICENSE_SHA256" ]] || {
  echo "PowerSync source license hash mismatch: $actual_source_license_hash" >&2
  exit 1
}

image_license_url="https://raw.githubusercontent.com/powersync-ja/powersync-service/$POWERSYNC_SERVICE_SOURCE_TAG/service/LICENSE"
actual_image_license_hash="$(hash_url "$image_license_url")"
[[ "$actual_image_license_hash" == "$POWERSYNC_IMAGE_LICENSE_SHA256" ]] || {
  echo "PowerSync image license hash mismatch: $actual_image_license_hash" >&2
  exit 1
}

client_license_url="https://raw.githubusercontent.com/powersync-ja/powersync-js/$POWERSYNC_NODE_SOURCE_COMMIT/LICENSE"
actual_client_license_hash="$(hash_url "$client_license_url")"
[[ "$actual_client_license_hash" == "$POWERSYNC_NODE_LICENSE_SHA256" ]] || {
  echo "PowerSync Node license hash mismatch: $actual_client_license_hash" >&2
  exit 1
}

printf 'Verified tag-to-index resolution, linux/amd64 manifests, PowerSync labels, source tags, npm metadata/integrity and license hashes.\n'
