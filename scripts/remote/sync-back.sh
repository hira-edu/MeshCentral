#!/usr/bin/env bash
set -euo pipefail

# Sync selected live server state back into the Git repo in a safe way.
# - Commits sanitized MeshCentral config (no secrets)
# - Commits current Nginx site config
# - Pushes to the same repo using the deploy key present on the server

REPO_SSH_URL="git@github.com:hira-edu/MeshCentral.git"
DEPLOY_KEY="/root/meshcentral-deploy-key"
APP_DIR="/opt/meshcentral-app"
WORK="/root/meshcentral-sync-$(date +%Y%m%d%H%M%S)"

if [ ! -f "$DEPLOY_KEY" ]; then
  echo "ERROR: Deploy key not found at $DEPLOY_KEY" >&2
  exit 1
fi

mkdir -p "$WORK"
cd "$WORK"

export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=accept-new"
git clone --depth=1 "$REPO_SSH_URL" repo
cd repo

# Ensure destination folders exist
mkdir -p meshcentral-data infra/nginx

# 1) Sanitize and copy MeshCentral live config
LIVE_CFG="$APP_DIR/meshcentral-data/config.json"
OUT_CFG="meshcentral-data/config.live.sanitized.json"
if [ -f "$LIVE_CFG" ]; then
  node <<'NODE'
const fs = require('fs');
const src = process.env.SRC;
const dst = process.env.DST;
let c = JSON.parse(fs.readFileSync(src));
// Remove sensitive keys commonly present
const scrub = (o) => {
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    const lk = k.toLowerCase();
    if (lk.includes('password') || lk.includes('secret') || lk.includes('sessionkey') || lk.includes('encryptkey') || lk.includes('apikey') || lk.includes('private')) {
      delete o[k];
      continue;
    }
    scrub(o[k]);
  }
};
scrub(c);
fs.writeFileSync(dst, JSON.stringify(c, null, 2));
console.log('Sanitized live config written to', dst);
NODE
else
  echo "WARN: Missing $LIVE_CFG, skipping config sync"
fi

# 2) Copy Nginx site config for reference
NGINX_SITE="/etc/nginx/sites-available/meshcentral.conf"
if [ -f "$NGINX_SITE" ]; then
  cp "$NGINX_SITE" infra/nginx/meshcentral.conf
fi

# 3) Commit & push if changes
git add -A
if git diff --cached --quiet; then
  echo "No changes to sync."
else
  git config user.name "mesh-sync"
  git config user.email "mesh-sync@server"
  git commit -m "chore(sync): update from server (config + nginx)"
  git push origin HEAD:main
fi

echo "Sync complete."

