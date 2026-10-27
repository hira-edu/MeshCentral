#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-./meshcentral-live-snapshot-$(date +%Y%m%d-%H%M%S)}"
APP_DIR="${APP_DIR:-/opt/meshcentral}"
ALT_APP_DIR="${ALT_APP_DIR:-/opt/meshcentral-app}"
DATA_DIR=""
WEB_OVERRIDE_DIR=""
CF_ENV=""
CF_WRANGLER="${CF_WRANGLER:-/usr/local/bin/cf-wrangler}"

if [ ! -d "$APP_DIR" ] && [ -d "$ALT_APP_DIR" ]; then
  APP_DIR="$ALT_APP_DIR"
fi

DATA_DIR="$APP_DIR/meshcentral-data"
WEB_OVERRIDE_DIR="$APP_DIR/meshcentral-web/public/scripts"
CF_ENV="${CF_ENV:-$DATA_DIR/cloudflare.env}"

mkdir -p \
  "$OUT_DIR/cloudflare/zone-export" \
  "$OUT_DIR/db" \
  "$OUT_DIR/etc/caddy" \
  "$OUT_DIR/etc/cloudflared" \
  "$OUT_DIR/manifests" \
  "$OUT_DIR/network" \
  "$OUT_DIR/opt/meshcentral/meshcentral-data" \
  "$OUT_DIR/opt/meshcentral/meshcentral-web/public/scripts" \
  "$OUT_DIR/systemd"

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
}

append_log() {
  printf '%s\n' "$1" >> "$OUT_DIR/cloudflare/action-log.txt"
}

capture_cf_api() {
  local endpoint="$1"
  local outfile="$2"
  local http_code=""
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    printf '{"success":false,"error":"token-unavailable"}\n' > "$outfile"
    append_log "SKIP $endpoint token-unavailable"
    return 0
  fi
  http_code="$(curl -sS -o "$outfile" -w '%{http_code}' \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json' \
    "https://api.cloudflare.com/client/v4$endpoint" || true)"
  append_log "API $endpoint http=$http_code"
}

{
  echo "snapshot_created_at=$(date --iso-8601=seconds)"
  echo "app_dir=$APP_DIR"
  echo "data_dir=$DATA_DIR"
  echo "web_override_dir=$WEB_OVERRIDE_DIR"
  echo "cf_env=$CF_ENV"
  echo "cf_wrangler=$CF_WRANGLER"
} > "$OUT_DIR/manifests/manifest.txt"

copy_if_exists /etc/caddy/Caddyfile "$OUT_DIR/etc/caddy/Caddyfile"
copy_if_exists /etc/cloudflared/config.yml "$OUT_DIR/etc/cloudflared/config.yml"
copy_if_exists "$DATA_DIR/config.json" "$OUT_DIR/opt/meshcentral/meshcentral-data/config.json"
copy_if_exists "$DATA_DIR/meshcore.js" "$OUT_DIR/opt/meshcentral/meshcentral-data/meshcore.js"
copy_if_exists "$WEB_OVERRIDE_DIR/custom.js" "$OUT_DIR/opt/meshcentral/meshcentral-web/public/scripts/custom.js"

systemctl cat meshcentral > "$OUT_DIR/systemd/meshcentral.service" 2>/dev/null || true
systemctl cat cloudflared > "$OUT_DIR/systemd/cloudflared.service" 2>/dev/null || true
systemctl cat caddy > "$OUT_DIR/systemd/caddy.service" 2>/dev/null || true

{
  systemctl is-active meshcentral 2>/dev/null || true
  systemctl is-active cloudflared 2>/dev/null || true
  systemctl is-active caddy 2>/dev/null || true
  systemctl is-active mongod 2>/dev/null || true
} > "$OUT_DIR/systemd/service-state.txt"

ss -ltnp > "$OUT_DIR/network/ss-ltnp.txt" 2>/dev/null || true
hostnamectl > "$OUT_DIR/network/hostnamectl.txt" 2>/dev/null || true
uname -a > "$OUT_DIR/network/uname.txt" 2>/dev/null || true
ufw status verbose > "$OUT_DIR/network/ufw-status.txt" 2>/dev/null || true

if command -v getent >/dev/null 2>&1; then
  {
    getent ahostsv4 high.support || true
    getent ahostsv4 agents.high.support || true
    getent ahostsv4 relay.high.support || true
    getent ahostsv4 cfrelay.high.support || true
  } > "$OUT_DIR/network/dns-ahostsv4.txt"
fi

if command -v jq >/dev/null 2>&1 && [ -f "$DATA_DIR/config.json" ]; then
  MONGO_URI="$(jq -r '.settings.mongodb // empty' "$DATA_DIR/config.json" 2>/dev/null || true)"
  if [ -n "$MONGO_URI" ] && command -v mongodump >/dev/null 2>&1; then
    mongodump --uri "$MONGO_URI" --gzip --archive="$OUT_DIR/db/meshcentral.archive.gz"
  fi
  if [ -n "$MONGO_URI" ] && command -v mongosh >/dev/null 2>&1; then
    mongosh "$MONGO_URI" --quiet --eval 'db.getCollectionNames().forEach(function(c){ print(c + ":" + db.getCollection(c).countDocuments({})) })' > "$OUT_DIR/db/collection-counts.txt" || true
  fi
fi

if command -v cloudflared >/dev/null 2>&1; then
  cloudflared --version > "$OUT_DIR/cloudflare/cloudflared-version.txt" 2>&1 || true
  cloudflared tunnel list > "$OUT_DIR/cloudflare/tunnel-list.txt" 2>&1 || true
fi

if [ -f "$CF_ENV" ]; then
  set +u
  set -a
  # shellcheck disable=SC1090
  . "$CF_ENV"
  set +a
  set -u
fi

export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first"

{
  echo "Cloudflare token source is runtime-only and intentionally not copied."
  echo "Wrapper path: $CF_WRANGLER"
  echo "Token source: $CF_ENV"
  echo "IPv4-first: enabled"
} > "$OUT_DIR/cloudflare/vps-auth-scaffold.txt"

if [ -x "$CF_WRANGLER" ]; then
  "$CF_WRANGLER" whoami > "$OUT_DIR/cloudflare/whoami.txt" 2>&1 || true
fi

if [ -n "${CF_ZONE_ID:-}" ]; then
  capture_cf_api "/zones/$CF_ZONE_ID" "$OUT_DIR/cloudflare/zone.json"
  capture_cf_api "/zones/$CF_ZONE_ID/dns_records?per_page=100" "$OUT_DIR/cloudflare/dns_records.json"
  capture_cf_api "/zones/$CF_ZONE_ID/settings" "$OUT_DIR/cloudflare/settings_all.json"
  capture_cf_api "/zones/$CF_ZONE_ID/pagerules?status=active&order=status&direction=desc" "$OUT_DIR/cloudflare/pagerules_active.json"
  capture_cf_api "/zones/$CF_ZONE_ID/firewall/rules" "$OUT_DIR/cloudflare/firewall_rules.json"
  capture_cf_api "/zones/$CF_ZONE_ID/filters" "$OUT_DIR/cloudflare/firewall_filters.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_request_firewall_custom/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_request_firewall_custom.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_ratelimit/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_ratelimit.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_request_cache_settings.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_request_late_transform/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_request_late_transform.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_request_transform/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_request_transform.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_response_headers_transform/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_response_headers_transform.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_request_redirect/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_request_redirect.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_request_dynamic_redirect.json"
  capture_cf_api "/zones/$CF_ZONE_ID/rulesets/phases/http_request_origin/entrypoint" "$OUT_DIR/cloudflare/ruleset-http_request_origin.json"

  cp "$OUT_DIR/cloudflare/"*.json "$OUT_DIR/cloudflare/zone-export/" 2>/dev/null || true
  tar -C "$OUT_DIR/cloudflare/zone-export" -czf "$OUT_DIR/cloudflare/zone-export.tar.gz" .
fi

if [ -n "${CF_DOMAIN:-}" ] && command -v curl >/dev/null 2>&1; then
  {
    echo "=== HEAD http://${CF_DOMAIN}/ ==="
    curl -I -sS "http://${CF_DOMAIN}/" || true
    echo
    echo "=== HEAD https://${CF_DOMAIN}/ ==="
    curl -I -sS "https://${CF_DOMAIN}/" || true
    echo
    echo "=== HEAD https://${CF_DOMAIN}/scripts/custom.js ==="
    curl -I -sS "https://${CF_DOMAIN}/scripts/custom.js" || true
  } > "$OUT_DIR/network/public-headers.txt"
fi

echo "$OUT_DIR"
