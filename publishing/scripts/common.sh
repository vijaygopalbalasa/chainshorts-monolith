#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: ${path}" >&2
    exit 1
  fi
}

require_dir() {
  local path="$1"
  if [[ ! -d "$path" ]]; then
    echo "Missing required directory: ${path}" >&2
    exit 1
  fi
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

check_node_major_range() {
  local min="$1"
  local max="$2"
  require_command node
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt "$min" || "$major" -gt "$max" ]]; then
    echo "Node.js major version ${major} is unsupported. Use ${min}-${max}." >&2
    exit 1
  fi
}

check_png_dimensions() {
  local path="$1"
  local expected_width="$2"
  local expected_height="$3"
  require_file "$path"
  node - "$path" "$expected_width" "$expected_height" <<'NODE'
const fs = require("node:fs");
const [file, expectedWidth, expectedHeight] = process.argv.slice(2);
const buf = fs.readFileSync(file);
const signature = "89504e470d0a1a0a";
if (buf.subarray(0, 8).toString("hex") !== signature) {
  console.error(`Not a valid PNG: ${file}`);
  process.exit(1);
}
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
if (width !== Number(expectedWidth) || height !== Number(expectedHeight)) {
  console.error(`Unexpected dimensions for ${file}: ${width}x${height} (expected ${expectedWidth}x${expectedHeight})`);
  process.exit(1);
}
NODE
}

ensure_yaml_key() {
  local path="$1"
  local key="$2"
  if ! grep -Eq "^[[:space:]]*${key}:" "$path"; then
    echo "Missing required config key '${key}' in ${path}" >&2
    exit 1
  fi
}

resolve_apksigner() {
  if [[ -n "${ANDROID_TOOLS_DIR:-}" && -x "${ANDROID_TOOLS_DIR}/apksigner" ]]; then
    printf '%s\n' "${ANDROID_TOOLS_DIR}/apksigner"
    return 0
  fi
  if command -v apksigner >/dev/null 2>&1; then
    command -v apksigner
    return 0
  fi
  return 1
}

check_apk_signature_if_available() {
  local path="$1"
  local apksigner_bin
  require_file "$path"
  if ! apksigner_bin="$(resolve_apksigner)"; then
    echo "Skipping APK signature verification because apksigner is not available in PATH or ANDROID_TOOLS_DIR." >&2
    return 0
  fi
  "$apksigner_bin" verify --print-certs "$path" >/dev/null
}

check_apk_signature_required() {
  local path="$1"
  local apksigner_bin
  require_file "$path"
  if ! apksigner_bin="$(resolve_apksigner)"; then
    echo "Unable to verify APK signature because apksigner is not available." >&2
    exit 1
  fi
  "$apksigner_bin" verify --print-certs "$path" >/dev/null
}

run_dapp_store() {
  local version="${DAPP_STORE_CLI_VERSION:-latest}"
  npx --yes "@solana-mobile/dapp-store-cli@${version}" "$@"
}
