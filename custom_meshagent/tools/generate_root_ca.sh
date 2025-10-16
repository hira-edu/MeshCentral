#!/usr/bin/env bash
set -euo pipefail

# This script generates a self-signed MeshCentral Root CA and (optionally) a server TLS certificate.
# It backs up any existing root-cert files under meshcentral-data and writes new ones.
# Usage: ./generate_root_ca.sh /opt/meshcentral/meshcentral-data "MeshCentralRoot-$(date +%Y%m%d)" [server-fqdn]

DATAPATH=${1:-}
ROOT_CN=${2:-MeshCentralRoot}
SERVER_FQDN=${3:-}

if [[ -z "$DATAPATH" ]]; then
  echo "Usage: $0 <meshcentral-data-path> <root-cn> [server-fqdn]" 1>&2
  exit 1
fi

cd "$DATAPATH"

mkdir -p backup
ts=$(date +%Y%m%d-%H%M%S)
for f in root-cert-private.key root-cert-public.crt webserver-cert-private.key webserver-cert-public.crt; do
  if [[ -f "$f" ]]; then cp -f "$f" "backup/$f.$ts"; fi
done

echo "[*] Generating Root CA ($ROOT_CN)"
openssl genrsa -out root-cert-private.key 4096
openssl req -x509 -new -nodes -key root-cert-private.key -sha256 -days 3650 \
  -subj "/CN=$ROOT_CN" -out root-cert-public.crt

if [[ -n "$SERVER_FQDN" ]]; then
  echo "[*] Generating server TLS certificate for $SERVER_FQDN"
  openssl genrsa -out webserver-cert-private.key 2048
  cat > server.cnf <<EOF
[ req ]
prompt = no
distinguished_name = dn
req_extensions = req_ext

[ dn ]
CN = $SERVER_FQDN

[ req_ext ]
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = $SERVER_FQDN
EOF
  openssl req -new -key webserver-cert-private.key -out webserver.csr -config server.cnf
  openssl x509 -req -in webserver.csr -CA root-cert-public.crt -CAkey root-cert-private.key -CAcreateserial \
    -out webserver-cert-public.crt -days 1095 -sha256 -extensions req_ext -extfile server.cnf
  rm -f server.cnf webserver.csr root-cert-public.crt.srl
fi

echo "[*] Done. Update settings.rootCertCommonName to '$ROOT_CN' in config.json and restart MeshCentral."
