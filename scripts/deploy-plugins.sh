#!/usr/bin/env bash
set -euo pipefail

# Deploy the updated plugin bundles to the production MeshCentral host.
# Requires sshpass and scp. Configure credentials via environment variables:
#   export MESH_REMOTE_PASS="...password..."
#   export REMOTE_HOST="72.60.233.29"        # optional override
#   export REMOTE_USER="root"                # optional override
#   export REMOTE_BASE="/opt/meshcentral/meshcentral-data/plugins"  # optional override
#
# Usage:
#   scripts/deploy-plugins.sh        # sync plugins + restart service
#   scripts/deploy-plugins.sh -n     # sync plugins only (skip restart)

REMOTE_HOST=${REMOTE_HOST:-72.60.233.29}
REMOTE_USER=${REMOTE_USER:-root}
REMOTE_BASE=${REMOTE_BASE:-/opt/meshcentral/meshcentral-data/plugins}
PASSWORD=${MESH_REMOTE_PASS:-}
RESTART_SERVICE=1

while getopts "n" opt; do
    case "${opt}" in
        n) RESTART_SERVICE=0 ;;
        *) echo "Usage: $0 [-n]" >&2; exit 1 ;;
    }
done

if [[ -z "${PASSWORD}" ]]; then
    echo "Set the MESH_REMOTE_PASS environment variable with the SSH password." >&2
    exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
    echo "sshpass is required. Install it (brew install hudochenkov/sshpass/sshpass) before running this script." >&2
    exit 1
fi

plugins=(manualmap swdabypass bypassmethods)

for plugin in "${plugins[@]}"; do
    local_dir="meshcentral-data/plugins/${plugin}"
    if [[ ! -d "${local_dir}" ]]; then
        echo "Missing plugin directory: ${local_dir}" >&2
        exit 1
    fi
    echo ">> Syncing ${plugin} to ${REMOTE_HOST}:${REMOTE_BASE}"
    sshpass -p "${PASSWORD}" scp -r -o StrictHostKeyChecking=no "${local_dir}" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_BASE}"
done

if [[ ${RESTART_SERVICE} -eq 1 ]]; then
    echo ">> Restarting meshcentral service"
    sshpass -p "${PASSWORD}" ssh -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "systemctl restart meshcentral"
    echo ">> Recent meshcentral journal output"
    sshpass -p "${PASSWORD}" ssh -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "journalctl -u meshcentral -n 20 --no-pager"
else
    echo "Skipping meshcentral restart (requested with -n)."
fi
