#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

require_env KEYPAIR_PATH
require_env RPC_URL

args=(
  publish submit
  -k "$KEYPAIR_PATH"
  -u "$RPC_URL"
  --requestor-is-authorized
  --complies-with-solana-dapp-store-policies
)

if [[ "${ALPHA_SUBMISSION:-0}" == "1" ]]; then
  args+=(-l)
fi

run_dapp_store "${args[@]}"
