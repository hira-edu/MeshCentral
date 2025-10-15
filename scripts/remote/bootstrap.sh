#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/meshcentral-app"
SERVICE_NAME="meshcentral"
SERVICE_USER="meshcentral"

echo "[1/6] Ensuring system user '$SERVICE_USER' exists..."
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/meshcentral --shell /usr/sbin/nologin "$SERVICE_USER" || true
fi

echo "[2/6] Installing Node.js 18 LTS (if missing)..."
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(process.versions.node.split(".")[0] >= 18 ? 0 : 1)'; then
  if [ -x "$(command -v apt-get || true)" ]; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get update -y
    apt-get install -y nodejs build-essential
  elif [ -x "$(command -v yum || true)" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    yum install -y nodejs gcc-c++ make
  else
    echo "ERROR: Unsupported package manager. Install Node.js 18 manually." >&2
    exit 1
  fi
fi

echo "[3/6] Installing dependencies..."
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "[4/6] Setting permissions..."
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
mkdir -p "$APP_DIR/meshcentral-data"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/meshcentral-data"

# Ensure jq exists for config patching (best practice TLS offload behind Nginx)
if ! command -v jq >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y jq
  elif command -v yum >/dev/null 2>&1; then
    yum install -y jq
  fi
fi

# Patch MeshCentral config for TLS offload behind Nginx
CONFIG_JSON="$APP_DIR/meshcentral-data/config.json"
if [ -f "$CONFIG_JSON" ] && command -v jq >/dev/null 2>&1; then
  echo "[4a] Patching meshcentral-data/config.json for TLS offload (Port=3000,TlsOffload=true,RedirPort=0, internal agent/relay)"
  tmpcfg=$(mktemp)
  jq '.settings.Port=3000
      | .settings.TlsOffload=true
      | .settings.RedirPort=0
      | .settings.TrustedProxy=["127.0.0.1","::1"]
      | .settings.CookieIpCheck=false
      | .settings.agentPort=4449
      | .settings.agentPortBind="127.0.0.1"
      | .settings.agentAliasPort=4445
      | .settings.agentAliasDNS=("agents." + (.settings.Cert // .settings.cert // ""))
      | .settings.relayPort=4450
      | .settings.relayPortBind="127.0.0.1"
      | .settings.relayAliasPort=4446
      | .settings.CookieRootDomain=(.settings.Cert // .settings.cert // "")
      | del(.settings.ignoreAgentHashCheck)' "$CONFIG_JSON" > "$tmpcfg" && mv "$tmpcfg" "$CONFIG_JSON"
  chown "$SERVICE_USER":"$SERVICE_USER" "$CONFIG_JSON"
fi

echo "[5/6] Installing systemd service..."
cat >/etc/systemd/system/${SERVICE_NAME}.service <<UNIT
[Unit]
Description=MeshCentral Service
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${APP_DIR}/node_modules/meshcentral/meshcentral.js
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=false
Restart=always
RestartSec=3
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}

echo "[6/6] Install/refresh Nginx site..."
if command -v nginx >/dev/null 2>&1; then
  TARGET_SITE="/etc/nginx/sites-available/meshcentral.conf"
  TMP_SITE=$(mktemp)
  CERT_CN="_"
  if [ -f "$CONFIG_JSON" ] && command -v jq >/dev/null 2>&1; then
    CERT_CN=$(jq -r '.settings.Cert // .settings.cert // "_"' "$CONFIG_JSON")
  fi
  cp "${APP_DIR}/infra/nginx/meshcentral.conf" "$TMP_SITE"
  sed -i "s/mesh\.example\.com/${CERT_CN}/g" "$TMP_SITE" || true
  sed -i "s/agents\.mesh\.example\.com/agents.${CERT_CN}/g" "$TMP_SITE" || true
  sed -i "s/relay\.mesh\.example\.com/relay.${CERT_CN}/g" "$TMP_SITE" || true
  install -D -m 0644 "$TMP_SITE" "$TARGET_SITE"
  rm -f "$TMP_SITE"
  ln -sf /etc/nginx/sites-available/meshcentral.conf /etc/nginx/sites-enabled/meshcentral.conf
  if [ -e /etc/nginx/sites-enabled/default ]; then rm -f /etc/nginx/sites-enabled/default; fi
  nginx -t && systemctl restart nginx || echo "WARNING: nginx config test failed; not restarted"

  echo "[6a/6] Installing Certbot and issuing Let's Encrypt certificates..."
  # Install certbot with Nginx plugin
  if ! command -v certbot >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -y && apt-get install -y certbot python3-certbot-nginx
    elif command -v yum >/dev/null 2>&1; then
      yum install -y certbot python3-certbot-nginx || yum install -y certbot-nginx || true
    fi
  fi
  CERT_EMAIL=""
  if [ -f "$CONFIG_JSON" ] && command -v jq >/dev/null 2>&1; then
    CERT_EMAIL=$(jq -r '.letsencrypt.email // empty' "$CONFIG_JSON" 2>/dev/null || echo "")
  fi
  if [ -z "$CERT_EMAIL" ]; then CERT_EMAIL="admin@${CERT_CN}"; fi
  if command -v certbot >/dev/null 2>&1; then
    # Allow certbot to modify Nginx config for HTTP-01 challenges
    set +e
    certbot --nginx -n --agree-tos -m "$CERT_EMAIL" -d "$CERT_CN" -d "agents.$CERT_CN" -d "relay.$CERT_CN"
    CERTBOT_RC=$?
    set -e
    if [ $CERTBOT_RC -eq 0 ]; then
      echo "[certbot] Certificates issued/renewed successfully. Reloading Nginx..."
      nginx -t && systemctl reload nginx || true
    else
      echo "WARNING: certbot failed with code $CERTBOT_RC. Check DNS and firewall for ports 80/443."
    fi
  else
    echo "WARNING: certbot not installed. Skipping automatic TLS issuance."
  fi
else
  echo "Nginx not installed; please install and retry to enable TLS offload."
fi

echo "[7/7] Restarting service..."
systemctl restart ${SERVICE_NAME}
systemctl status ${SERVICE_NAME} --no-pager -l || true
echo "Deployment completed."
