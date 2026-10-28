#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# The installed server reads meshcentral-web/public in place. A copy in the data folder is
# left over from the old layout and would shadow it.
if [ -e meshcentral-data/public ]; then
  echo "ERROR: meshcentral-data/public is a stale copy of the web overrides. Delete it, and remove" >&2
  echo "       WebPublicPath from meshcentral-data/config.json if it is set, then re-run." >&2
  exit 1
fi

if [ ! -f meshcentral-data/config.json ]; then
  echo "Creating meshcentral-data/config.json from template..."
  mkdir -p meshcentral-data
  cp meshcentral-data/config.json.template meshcentral-data/config.json
fi

# pluginHandler.js loads plugins only from <datapath>/plugins until the Stage 4 built-in loader.
echo "Staging local plugins..."
for plugin in nativeruntime; do
  rm -rf "meshcentral-data/plugins/$plugin"
  mkdir -p "meshcentral-data/plugins"
  cp -R "../plugins/$plugin" "meshcentral-data/plugins/$plugin"
done

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 20+ required. Please install and re-run." >&2
  exit 1
fi
node -e "const major=Number(process.versions.node.split('.')[0]);if(major<20)process.exit(1)" || {
  echo "ERROR: Node.js 20+ required. Please install and re-run." >&2
  exit 1
}

echo "Packing the fork package..."
node scripts/pack.js

echo "Installing dependencies..."
npm ci

echo "Starting MeshCentral..."
npm start
