#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f meshcentral-data/config.json ]; then
  echo "Creating meshcentral-data/config.json from template..."
  mkdir -p meshcentral-data
  cp meshcentral-data/config.json.template meshcentral-data/config.json
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 18+ required. Please install and re-run." >&2
  exit 1
fi

echo "Installing dependencies..."
npm ci || npm install

echo "Starting MeshCentral..."
npm start

