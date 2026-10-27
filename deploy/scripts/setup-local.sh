#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f meshcentral-data/config.json ]; then
  echo "Creating meshcentral-data/config.json from template..."
  mkdir -p meshcentral-data
  cp meshcentral-data/config.json.template meshcentral-data/config.json
fi

echo "Staging local plugins..."
for plugin in stfdeploy nativeruntime; do
  mkdir -p "meshcentral-data/plugins/$plugin"
  cp -R "plugins/$plugin/." "meshcentral-data/plugins/$plugin/"
done

echo "Staging web overrides..."
mkdir -p "meshcentral-data/public"
cp -R "public/." "meshcentral-data/public/"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 20+ required. Please install and re-run." >&2
  exit 1
fi
node -e "const major=Number(process.versions.node.split('.')[0]);if(major<20)process.exit(1)" || {
  echo "ERROR: Node.js 20+ required. Please install and re-run." >&2
  exit 1
}

echo "Installing dependencies..."
npm ci

echo "Starting MeshCentral..."
npm start
