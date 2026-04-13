#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${1:-/opt/security-testing-framework}"
OWNER="hira-edu"
REPO="security-testing-framework"

echo "[STF] Installing dependencies (curl, unzip)..."
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y curl unzip >/dev/null 2>&1 || true
elif command -v yum >/dev/null 2>&1; then
  yum install -y curl unzip >/dev/null 2>&1 || true
fi

API="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"
echo "[STF] Fetching latest release from ${OWNER}/${REPO}..."
JSON=$(curl -fsSL -H 'User-Agent: stf-install' "$API")
ASSET_URL=$(echo "$JSON" | grep -Eo '"browser_download_url"\s*:\s*"[^"]+\.zip"' | head -n1 | sed -E 's/.*"(https:[^"]+)"/\1/')
ASSET_NAME=$(basename "$ASSET_URL")
if [ -z "$ASSET_URL" ]; then
  echo "[STF] ERROR: No .zip asset found in latest release." >&2
  exit 1
fi

TMP="/tmp/${ASSET_NAME}"
echo "[STF] Downloading $ASSET_NAME..."
curl -fsSL -o "$TMP" "$ASSET_URL"

echo "[STF] Creating install dir $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
echo "[STF] Extracting..."
unzip -oq "$TMP" -d "$INSTALL_DIR"
rm -f "$TMP"

if [ -f "$INSTALL_DIR/install.sh" ]; then
  echo "[STF] Running install.sh"
  chmod +x "$INSTALL_DIR/install.sh"
  (cd "$INSTALL_DIR" && ./install.sh)
else
  echo "[STF] No install.sh found; extracted only."
fi

echo "[STF] Installation finished."

