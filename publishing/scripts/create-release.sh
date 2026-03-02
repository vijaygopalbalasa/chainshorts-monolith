#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

require_env KEYPAIR_PATH
require_env ANDROID_TOOLS_DIR

args=(create release -k "$KEYPAIR_PATH" -b "$ANDROID_TOOLS_DIR")
if [[ -n "${RPC_URL:-}" ]]; then
  args+=(-u "$RPC_URL")
fi
if [[ -n "${PRIORITY_FEE_LAMPORTS:-}" ]]; then
  args+=(-p "$PRIORITY_FEE_LAMPORTS")
fi

run_dapp_store "${args[@]}"
