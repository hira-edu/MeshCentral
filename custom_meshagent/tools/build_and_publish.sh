#!/usr/bin/env bash
set -euo pipefail

# Build and publish custom MeshCentral Windows agents (x64 + x86)
# - Wraps custom_meshagent/scripts/meshagent_build.py
# - Stores artifacts in a versioned archive store on the server
# - Optionally publishes to meshcentral-data/agents and restarts MeshCentral
#
# Usage examples:
#   ./build_and_publish.sh \
#     --config custom_meshagent/configs/meshagent.json \
#     --binary-x64 /path/to/YourCustomCore_x64.exe \
#     --binary-x86 /path/to/YourCustomCore_x86.exe \
#     --store /opt/meshcentral/meshcentral-data/agents-archive \
#     --publish-live --restart
#
# Minimal (only build x64 and archive):
#   ./build_and_publish.sh --binary-x64 /path/to/YourCore64.exe

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

CONFIG_PATH="${REPO_ROOT}/MeshCentral/custom_meshagent/configs/meshagent.json"
BINARY_X64=""
BINARY_X86=""
STORE_DIR="/opt/meshcentral/meshcentral-data/agents-archive"
PUBLISH_LIVE=0
RESTART=0
LIVE_AGENTS_DIR="/opt/meshcentral/meshcentral-data/agents"
PYTHON_BIN="python3"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_PATH="$2"; shift 2 ;;
    --binary-x64) BINARY_X64="$2"; shift 2 ;;
    --binary-x86) BINARY_X86="$2"; shift 2 ;;
    --store) STORE_DIR="$2"; shift 2 ;;
    --publish-live) PUBLISH_LIVE=1; shift ;;
    --restart) RESTART=1; shift ;;
    --agents-dir) LIVE_AGENTS_DIR="$2"; shift 2 ;;
    --python) PYTHON_BIN="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,80p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

echo "[info] Repo root        : $REPO_ROOT"
echo "[info] Config           : $CONFIG_PATH"
echo "[info] X64 core binary  : ${BINARY_X64:-<none>}"
echo "[info] X86 core binary  : ${BINARY_X86:-<none>}"
echo "[info] Archive store    : $STORE_DIR"
echo "[info] Publish live     : $PUBLISH_LIVE"
echo "[info] Restart service  : $RESTART"
echo "[info] Live agents dir  : $LIVE_AGENTS_DIR"

cd "$REPO_ROOT/MeshCentral"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "[error] Python not found. Install python3 and retry." >&2
  exit 1
fi

BUILD_PY="$REPO_ROOT/MeshCentral/custom_meshagent/scripts/meshagent_build.py"
if [[ ! -f "$BUILD_PY" ]]; then
  echo "[error] Build orchestrator not found: $BUILD_PY" >&2
  exit 1
fi

echo "[step] Validate config"
"$PYTHON_BIN" "$BUILD_PY" validate --config "$CONFIG_PATH"

echo "[step] Generate branding/provisioning"
"$PYTHON_BIN" "$BUILD_PY" generate --config "$CONFIG_PATH" --meshagent-root "$REPO_ROOT/MeshAgent"

OUT_DIR="$REPO_ROOT/MeshCentral/custom_meshagent/build/meshagent/output"
STAGING_DIR="$OUT_DIR/staging"
rm -rf "$OUT_DIR" 2>/dev/null || true
mkdir -p "$STAGING_DIR"

did_any=0

if [[ -n "$BINARY_X64" ]]; then
  if [[ ! -f "$BINARY_X64" ]]; then
    echo "[error] x64 core binary not found: $BINARY_X64" >&2
    exit 1
  fi
  echo "[step] Package x64"
  "$PYTHON_BIN" "$BUILD_PY" package --config "$CONFIG_PATH" --binary "$BINARY_X64" --nsis --arch x64
  did_any=1
fi

if [[ -n "$BINARY_X86" ]]; then
  if [[ ! -f "$BINARY_X86" ]]; then
    echo "[error] x86 core binary not found: $BINARY_X86" >&2
    exit 1
  fi
  echo "[step] Package x86"
  "$PYTHON_BIN" "$BUILD_PY" package --config "$CONFIG_PATH" --binary "$BINARY_X86" --nsis --arch x86
  did_any=1
fi

if [[ $did_any -eq 0 ]]; then
  echo "[warn] No binaries specified. Nothing built. Use --binary-x64/--binary-x86." >&2
  exit 1
fi

MSVC64="$STAGING_DIR/MeshService64.exe"
MSVC86="$STAGING_DIR/MeshService.exe"

ts="$(date +%Y%m%d-%H%M%S)"
rel_dir="$STORE_DIR/$ts"
mkdir -p "$rel_dir"

echo "[step] Archive to $rel_dir"
shasum_file="$rel_dir/sha256sums.txt"
manifest="$rel_dir/manifest.json"

echo '{' > "$manifest"
echo "  \"timestamp\": \"$ts\"," >> "$manifest"
echo '  "artifacts": {' >> "$manifest"

first=1
for f in "$MSVC64" "$MSVC86"; do
  if [[ -f "$f" ]]; then
    base="$(basename "$f")"
    install -m 0644 "$f" "$rel_dir/$base"
    sha="$(sha256sum "$rel_dir/$base" | awk '{print $1}')"
    size="$(stat -c%s "$rel_dir/$base")"
    echo "$sha  $base" >> "$shasum_file"
    if [[ $first -eq 1 ]]; then first=0; else echo ',' >> "$manifest"; fi
    echo "    \"$base\": { \"sha256\": \"$sha\", \"size\": $size }" >> "$manifest"
  fi
done

echo '  }' >> "$manifest"
echo '}' >> "$manifest"

echo "[ok] Archive complete: $rel_dir"
ls -la "$rel_dir" || true

if [[ $PUBLISH_LIVE -eq 1 ]]; then
  echo "[step] Publish to live agents dir: $LIVE_AGENTS_DIR"
  sudo install -m 0644 -D "$MSVC64" "$LIVE_AGENTS_DIR/MeshService64.exe" 2>/dev/null || true
  sudo install -m 0644 -D "$MSVC86" "$LIVE_AGENTS_DIR/MeshService.exe" 2>/dev/null || true
  ls -la "$LIVE_AGENTS_DIR"/MeshService*.exe || true
  if [[ $RESTART -eq 1 ]]; then
    echo "[step] Restart MeshCentral"
    sudo systemctl restart meshcentral || sudo systemctl restart meshcentral.service || true
    sleep 2
  fi
  echo "[step] Verify agent downloads (id=4 x64, id=3 x86)"
  set +e
  curl -I -sS https://high.support/meshagents?id=4 | sed -n '1,6p'
  curl -I -sS https://high.support/meshagents?id=3 | sed -n '1,6p'
  set -e
fi

cat <<EOF

[summary]
  Stored: $rel_dir
  Manifest: $manifest
  Hashes: $shasum_file

Retrieve later via:
  scp root@72.60.233.29:$rel_dir/MeshService64.exe .
  scp root@72.60.233.29:$rel_dir/MeshService.exe .

Serve over HTTP (optional):
  ln -s $STORE_DIR /opt/meshcentral/meshcentral-web/public/agents-archive
  Then browse: https://high.support/agents-archive/$ts/

EOF

