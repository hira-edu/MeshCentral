# Production Server

How the production MeshCentral host, its edge and its Cloudflare zone are set up. Keep this file
and `infra/caddy/Caddyfile.live` matched to the live host: after any change on the host, take a
fresh capture (see "Capturing the live state") and update both in the same change.

## Host

| Item | Value |
|---|---|
| SSH target | `meshcentral` (`74.208.52.191`) |
| Host name | `srv1057130` (Ubuntu) |
| Application root | `/opt/meshcentral` |
| Data folder | `/opt/meshcentral/meshcentral-data` |
| Web override folder | `/opt/meshcentral/meshcentral-web/public` |
| Database | MongoDB on `127.0.0.1:27017`, database `meshcentral` |
| Node.js | 20.20.2 |

Services:

| Service | Unit | Notes |
|---|---|---|
| `meshcentral` | `/etc/systemd/system/meshcentral.service` | Runs as user and group `meshcentral`, working directory `/opt/meshcentral`, `ExecStart=/usr/bin/node /opt/meshcentral/node_modules/meshcentral/meshcentral.js` |
| `caddy` | `/usr/lib/systemd/system/caddy.service` | Config `/etc/caddy/Caddyfile`; admin API on `127.0.0.1:2019` |
| `cloudflared` | `/etc/systemd/system/cloudflared.service` | Config `/etc/cloudflared/config.yml`; metrics on `127.0.0.1:20241` |
| `mongod` | distribution unit | MeshCentral connects at `127.0.0.1:27017` |

The `nginx` service is inactive and not part of the stack.

MeshCentral listens on `127.0.0.1:4430` only, with TLS offloaded to the edge (`TlsOffload`
trusts `127.0.0.1,::1`), public alias port `443` and no redirect port. The certificate host and
`certUrl` are `high.support`. `ignoreAgentHashCheck` is `false`.

## Edge

All public traffic reaches MeshCentral at `127.0.0.1:4430`, through one of two paths.

### Cloudflare tunnel (`cloudflared`)

Tunnel `meshcentral` carries the proxied host names:

| Host | Origin |
|---|---|
| `high.support` | `http://127.0.0.1:4430` |
| `cfrelay.high.support` | `http://127.0.0.1:4430` |
| anything else | `http_status:404` |

### Caddy (direct, not proxied by Cloudflare)

`infra/caddy/Caddyfile.live` is the tracked copy of `/etc/caddy/Caddyfile`.

| Listener | Behaviour |
|---|---|
| `agents.high.support`, `relay.high.support` on `:80`/`:443` | ACME-managed TLS. Proxies to `127.0.0.1:4430`, except a `GET /` without the MeshCentral `xid` cookie and without a login query parameter (`mc`, `login`, `user`, `key`, `viewmode`, `node`, `meshaction`), which serves the static page in `/var/www/cover`. `/api/v2/telemetry` is rewritten to `/agent.ashx`. |
| `agents.high.support:4445`, `agents.high.support:4446` | Legacy agent listeners. Static certificate `/etc/caddy/tls/meshcentral-agent-tls.{crt,key}`, not ACME-managed, so it must be renewed by hand before it expires. Proxies to `127.0.0.1:4430`. |
| `relay.high.support:4446` | Legacy relay listener. Proxies to `127.0.0.1:4430`. |

The legacy listeners serve agents provisioned before the move to `agents.high.support:443`. New
provisioning metadata does not use them.

## Cloudflare

Zone `high.support` (full setup).

DNS:

| Name | Type | Target | Proxied |
|---|---|---|---|
| `high.support` | CNAME | the `meshcentral` tunnel (`<tunnel id>.cfargotunnel.com`) | yes |
| `cfrelay.high.support` | CNAME | the `meshcentral` tunnel | yes |
| `agents.high.support` | A | `74.208.52.191` | no |
| `relay.high.support` | A | `74.208.52.191` | no |
| `www.high.support` | CNAME | `high.support` | no |

`_dmarc` (TXT) and `_domainconnect` (CNAME) records also exist.

Zone settings that MeshCentral depends on:

| Setting | Value | Why |
|---|---|---|
| `ssl` | `strict` | |
| `always_use_https` | `on` | HTTP requests to proxied hosts redirect to HTTPS |
| `browser_cache_ttl` | `0` | Cloudflare keeps MeshCentral's own cache headers instead of extending browser caching |
| `websockets` | `on` | Agent, control and relay connections are WebSockets |
| `min_tls_version` | `1.2` | |

Other settings: `tls_1_3` on, `http3` on, `automatic_https_rewrites` on, `security_level`
medium, `browser_check` on, `waf` off, `ipv6` on, `pseudo_ipv4` off, `opportunistic_encryption`
on, `0rtt` off, `cache_level` aggressive.

Rules:
- Page rules: `high.support/*.ashx*` and `cfrelay.high.support/*.ashx*` set
  `security_level=essentially_off` and `cache_level=bypass`.
- Custom firewall phase: one `skip` rule for `high.support` `/agent.ashx` and `/control.ashx`, and
  `cfrelay.high.support` `/control-redirect.ashx` and `/meshrelay.ashx`.
- The API token cannot read the `http_request_cache_settings` and `http_request_dynamic_redirect`
  phases, and settings that exist only in the dashboard are not exported. Check those in the
  dashboard.

### Control path

Cloudflare is managed from the host, not from a workstation:
- `/usr/local/bin/cf-wrangler` (root, mode 700) runs `npx --yes wrangler 4.82.0` with a user API
  token and forces IPv4-first DNS (`NODE_OPTIONS=--dns-result-order=ipv4first`). Direct IPv6
  egress from this host gets Cloudflare error `9109`.
- It reads `/root/.cloudflare-api.env` (root, mode 600), which takes the token from
  `/opt/meshcentral/meshcentral-data/cloudflare.env` (`CF_API_TOKEN`, `CF_ZONE_ID`, `CF_DOMAIN`,
  `CF_ACCOUNT_EMAIL`).
- The token has no cache-purge right.

## Secrets

These stay on the host and out of Git and of any capture that leaves it unencrypted:
`meshcentral-data/config.json` (session and database keys, MongoDB URI), MongoDB dumps, the
certificate private keys, `meshcentral-data/cloudflare.env` and `/root/.cloudflare-api.env`.

## Capturing the live state

`scripts/ops/Collect-MeshCentralRemoteSnapshot.sh` runs on the host and writes a capture folder:
Caddy and cloudflared config, systemd units, `config.json`, a `mongodump` archive, the Cloudflare
zone export through `cf-wrangler`, listeners and a hash manifest. The capture contains secrets:
keep it outside the repository.

`scripts/ops/New-MeshCentralLocalBackup.ps1` copies this wrapper's tracked files and the local
runtime files into a backup folder with a SHA-256 manifest and a sanitized `config.json`.

A restore needs, from the same capture: `config.json`, the MongoDB dump, `/etc/caddy/Caddyfile`
and its static certificate files, `/etc/cloudflared/config.yml` and the tunnel credentials, the
systemd units, and `meshcentral-web/public/scripts/custom.js`.
