#!/usr/bin/env bash
set -euo pipefail

echo "=== MeshCentral Diagnose ==="
APP_DIR="/opt/meshcentral-app"
CFG="$APP_DIR/meshcentral-data/config.json"

echo "[1] Config summary (key fields)"
if command -v jq >/dev/null 2>&1 && [ -f "$CFG" ]; then
  jq '{
    Port: .settings.Port,
    RedirPort: .settings.RedirPort,
    TlsOffload: .settings.TlsOffload,
    TrustedProxy: .settings.TrustedProxy,
    CookieIpCheck: .settings.CookieIpCheck,
    CookieRootDomain: .settings.CookieRootDomain,
    Cert: (.settings.Cert // .settings.cert),
    agent: { internalPort: .settings.agentPort, bind: .settings.agentPortBind, aliasPort: .settings.agentAliasPort, aliasDNS: .settings.agentAliasDNS },
    relay: { internalPort: .settings.relayPort, bind: .settings.relayPortBind, aliasPort: .settings.relayAliasPort }
  }' "$CFG" || true
else
  echo "config.json or jq missing"
fi

echo "\n[2] Services status"
systemctl status meshcentral --no-pager -l || true
systemctl status nginx --no-pager -l || true

echo "\n[3] Listening ports"
ss -ltnp | awk '{print $0}' | egrep ":3000|:4449|:4450|:443 |:4445|:4446|:4430" || true

echo "\n[4] Nginx test and logs"
nginx -v || true
nginx -t || true
tail -n 200 /var/log/nginx/error.log || true

echo "\n[5] MeshCentral recent logs (last 200 lines)"
journalctl -u meshcentral --since "2 hours ago" --no-pager -n 200 || true

echo "\n[6] Backend reachability"
curl -sSL -o /dev/null -w "http_code=%{http_code}\n" http://127.0.0.1:3000/ || echo "curl-backend-failed"

CERT=$(jq -r '.settings.Cert // .settings.cert // empty' "$CFG" 2>/dev/null || echo "")
if [ -n "$CERT" ]; then
  echo "\n[7] Frontend reachability (cert CN: $CERT)"
  curl -k -sSL -o /dev/null -w "web_code=%{http_code}\n" https://$CERT/ || echo "curl-web-failed"
  echo "Agents endpoint"
  curl -k -sSL -o /dev/null -w "agent_code=%{http_code}\n" https://agents.$CERT:4445/agent.ashx || echo "curl-agents-failed"
  echo "Relay endpoint"
  curl -k -sSL -o /dev/null -w "relay_code=%{http_code}\n" https://relay.$CERT:4446/meshrelay || echo "curl-relay-failed"
  echo "Legacy agent endpoint (4430)"
  curl -k -sSL -o /dev/null -w "legacy_code=%{http_code}\n" https://$CERT:4430/agent.ashx || echo "curl-legacy-failed"
fi

echo "\n[8] Firewall summary"
if command -v ufw >/dev/null 2>&1; then ufw status || true; fi
if command -v iptables >/dev/null 2>&1; then iptables -S || true; fi
if command -v nft >/dev/null 2>&1; then nft list ruleset | sed -n '1,120p' || true; fi

echo "\n[9] DNS resolution"
if command -v host >/dev/null 2>&1; then
  [ -n "$CERT" ] && host $CERT || true
  [ -n "$CERT" ] && host agents.$CERT || true
  [ -n "$CERT" ] && host relay.$CERT || true
else
  echo "host(1) not installed, skipping"
fi

echo "=== Diagnose Complete ==="

