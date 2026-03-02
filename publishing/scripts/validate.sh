#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

CONFIG_FILE="config.yaml"
APK_FILE="files/chainshorts-dapp-store.apk"

run_local_preflight() {
  check_node_major_range 18 21
  require_dir "media"
  require_dir "files"
  require_file "${CONFIG_FILE}"
  require_file "${APK_FILE}"

  check_png_dimensions "media/app-icon-512.png" 512 512
  check_png_dimensions "media/release-icon-512.png" 512 512
  check_png_dimensions "media/banner-1200x600.png" 1200 600
  check_png_dimensions "media/feature-1200x1200.png" 1200 1200

  local screenshot_count
  screenshot_count="$(find media -maxdepth 1 -type f -name 'screenshot-*.png' | wc -l | tr -d ' ')"
  if [[ "${screenshot_count}" -lt 4 ]]; then
    echo "At least 4 screenshots are required. Found ${screenshot_count}." >&2
    exit 1
  fi

  local config_screenshot_entries
  config_screenshot_entries="$(grep -cE '^[[:space:]]*- purpose: screenshot$' "${CONFIG_FILE}")"
  if [[ "${config_screenshot_entries}" -lt 4 ]]; then
    echo "Config must declare at least 4 screenshot media entries. Found ${config_screenshot_entries}." >&2
    exit 1
  fi

  ensure_yaml_key "${CONFIG_FILE}" "android_package"
  ensure_yaml_key "${CONFIG_FILE}" "privacy_policy_url"
  ensure_yaml_key "${CONFIG_FILE}" "testing_instructions"
  ensure_yaml_key "${CONFIG_FILE}" "google_store_package"
  check_apk_signature_if_available "${APK_FILE}"
}

run_local_preflight

if [[ "${SKIP_DAPP_STORE_CLI:-0}" == "1" ]]; then
  echo "Local publishing preflight passed. Skipping dApp Store CLI validation."
  exit 0
fi

require_env KEYPAIR_PATH
require_env ANDROID_TOOLS_DIR

require_file "$KEYPAIR_PATH"
require_dir "$ANDROID_TOOLS_DIR"
check_apk_signature_required "${APK_FILE}"

args=(validate -k "$KEYPAIR_PATH" -b "$ANDROID_TOOLS_DIR")

run_dapp_store "${args[@]}"
