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
Restart=always
RestartSec=3
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}

echo "[6/6] (Optional) Install/refresh Nginx site..."
if [ -n "${NGINX_MANAGE:-}" ] && [ -f "${APP_DIR}/infra/nginx/meshcentral.conf" ]; then
  if command -v nginx >/dev/null 2>&1; then
    install -D -m 0644 "${APP_DIR}/infra/nginx/meshcentral.conf" /etc/nginx/sites-available/meshcentral.conf
    ln -sf /etc/nginx/sites-available/meshcentral.conf /etc/nginx/sites-enabled/meshcentral.conf
    # Disable default if present
    if [ -e /etc/nginx/sites-enabled/default ]; then rm -f /etc/nginx/sites-enabled/default; fi
    nginx -t && systemctl reload nginx || echo "WARNING: nginx config test failed; not reloaded"
  else
    echo "Nginx not installed; skipping site install."
  fi
fi

echo "[7/7] Restarting service..."
systemctl restart ${SERVICE_NAME}
systemctl status ${SERVICE_NAME} --no-pager -l || true
echo "Deployment completed."
