# Server Setup SSOT

Date: April 13, 2026
Repo: `C:\Users\Workstation\Documents\GitHub\MeshCentral`

Last runtime reconciliation: July 26, 2026

## 2026-07-26 Agent Relay Regression Evidence

- The first captured Files failure stopped at outbound TCP: the agent's new Cloudflare IPv6 flow remained in `SYN-SENT`. TLS, HTTP, WebSocket upgrade, and MeshCentral relay-pairing code were not reached.
- The behavior change is bounded to ignored MeshAgent provisioning state that changed `MeshServer` from the historical direct agent origin to the Cloudflare-backed `high.support:443` origin; ignored files have no attributable Git author or commit. The active destination-selection and relay route were compared with refreshed upstream refs (`MeshAgent` `ebff7fb7`, `MeshCentral` `9c872e94`) and contain no candidate-specific alternate destination or relay race. This does not claim that either full fork file is byte-for-byte upstream.
- The replacement candidate contains one endpoint, `wss://agents.high.support:443/agent.ashx`, with URL-derived Host/SNI and no IP fallback, race, proxy discovery, added retry, delay, TLS bypass, or hash allowlist.
- The public `agents.high.support:443` certificate validates, and 20 immediate sequential unauthenticated WebSocket upgrades plus peer-confirmed clean closes passed. That proves TLS, HTTP `101`, and WebSocket closure only; live MeshCentral correctly rejects the candidate agent command-1 certificate hash because it matches neither the current domain certificate nor the current default certificate.
- Live rollout is therefore blocked until the existing MeshCentral domain/default certificate contract safely overlaps already deployed `high.support` agents and new `agents.high.support` agents. `ignoreAgentHashCheck` remains `false`.
- No live certificate, Caddy route, package, service, or database was changed during this investigation. The local Caddy reference below was reconciled to the captured live file only.

Proven certificate acceptance matrix:

| State | Existing `high.support` agents | Candidate `agents.high.support` agents |
|---|---:|---:|
| Current domain + current default | accepted | rejected |
| Phase 1: current domain + `agents.high.support` default | accepted | accepted |
| Phase 2: `agents.high.support` domain + matching default | rejected | accepted |

Phase 1 replaces only the default `webserver-cert-public.crt` and
`webserver-cert-private.key` with the matching certificate/key currently used
by Caddy for `agents.high.support`; `certurl` remains `https://high.support/`.
After observed inventory proves migration is complete, phase 2 changes only
`certurl` to `https://agents.high.support/`. Each phase needs one MeshCentral
restart and explicit approval. The copied phase-1 certificate is a snapshot and
does not follow Caddy renewal, so phase 1 is temporary. No Caddy reload or route
change is required for this certificate migration.

## 2026-04-19 VPS Move Addendum
- operator-designated replacement SSH target: `meshcentral` -> `74.208.52.191`
- direct SSH probes to `74.208.52.191:22` from the workstation timed out on April 19, 2026, so any host/runtime facts not explicitly updated below remain the last successfully captured pre-migration values
- prior direct SSH targets `167.88.44.65` and `72.60.233.29:22` are historical only

## Evidence Sources
Authoritative local evidence used for this document:
- `meshcentral-data/config.json`
- `meshcentral-data/config.json.template`
- `meshcentral-data/meshcore.js`
- `public/scripts/custom.js`
- `infra/caddy/Caddyfile.live`
- `infra/nginx/meshcentral.conf`
- `scripts/remote/bootstrap.sh`
- `scripts/remote/diagnose.sh`
- `scripts/remote/sync-back.sh`
- `package.json`
- `readme.md`
- `server-backups/meshcentral-live-20260413-153810/etc/caddy/Caddyfile`
- `server-backups/meshcentral-live-20260413-153810/etc/cloudflared/config.yml`
- `server-backups/meshcentral-live-20260413-153810/systemd/meshcentral.service`
- `server-backups/meshcentral-live-20260413-153810/systemd/cloudflared.service`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-data/config.json`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-data/meshcore.js`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-web/public/scripts/custom.js`
- `server-backups/meshcentral-live-20260413-153810/db/collection-counts.txt`
- `server-backups/meshcentral-live-20260413-153810/db/meshcentral.archive.gz`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/cloudflared-version.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/tunnel-list.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/tunnel-info.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/cf-wrangler`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/vps-auth-scaffold.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/api-readiness.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/zone-summary.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/zone-export/*`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/*.json`
- `server-backups/meshcentral-live-20260413-153810/manifests/backup-manifest.json`

Non-authoritative or still blocked:
- `HISTORICAL_NOTE`: `72.60.233.29:22` and `167.88.44.65:22` are prior VPS endpoints. A July 26 capture succeeded against `74.208.52.191`; a later read-only recheck timed out, so no claim is made about changes after the successful capture.
- `PARTIAL_SCOPE`: the current token can read the zone, settings, page rules, firewall rules, and custom firewall phase, but some phase exports remain unauthorized.
- `UNVERIFIED_DASHBOARD`: dashboard-only settings not exposed by the current token/API surface are still not exported locally.

## Current Known Deployment Shape
### App Model
- Repo mode is a deployment wrapper around the `meshcentral` npm package, not a full upstream source checkout.
- Local package entrypoint points to `node_modules/meshcentral/meshcentral.js`.
- Local runtime state is stored in `meshcentral-data/`.

### Live Host Identity
Verified from direct SSH capture:
- reachable SSH target after the April 19, 2026 VPS move: `meshcentral` -> `74.208.52.191`
- previous direct SSH targets before the VPS move: `167.88.44.65`, `72.60.233.29:22`
- hostname: `srv1057130`
- OS: Ubuntu Linux `6.8.0-106-generic`
- application root: `/opt/meshcentral`
- primary service user: `meshcentral`

### Live Service State
Verified from direct SSH capture:
- `meshcentral`: `active`
- `caddy`: `active`
- `mongod`: `active`
- `nginx`: `inactive`
- `cloudflared`: active, with listener on `127.0.0.1:20241`

### Runtime Identity
Sanitized runtime settings from the July 26 live capture:
- domain certificate host: `high.support`
- default-domain certificate URL: `https://high.support/`
- ignore agent certificate-hash checks: `false`
- WAN only: `true`
- public alias port: `443`
- internal MeshCentral bind port: `4430`
- internal bind address: `127.0.0.1`
- redirect port: `0`
- TLS offload source: `127.0.0.1,::1`
- data path: `/opt/meshcentral/meshcentral-data`
- database mode: MongoDB on `127.0.0.1:27017/meshcentral`
- WebRTC: `false`
- desktop multiplex: `true`
- agent TLS on direct port: `false`
- allowed origins:
  - `high.support`
  - `agents.high.support`
  - `relay.high.support`
  - `cfrelay.high.support`
- UMH controls: `true`

### Database Model
Current live config indicates MongoDB, not NeDB.
- URI shape: `mongodb://<redacted-user>:<redacted-password>@127.0.0.1:27017/meshcentral`
- verified live collection counts on April 13, 2026:
  - `events:19766`
  - `meshcentral:1101`
  - `power:2682`
  - `serverstats:403`
- verified live dump captured locally:
  - `server-backups/meshcentral-live-20260413-153810/db/meshcentral.archive.gz`
  - size: `1177191` bytes
  - sha256: `a753116f4e8d2668e387c8ba8f6914242f97b537cabcc1fe6984a218769582c2`

## Edge Proxy and TLS
### Repo-Era Edge Evidence
The repo-managed edge documentation is Nginx-based.
Evidence:
- `infra/nginx/meshcentral.conf`
- `scripts/remote/bootstrap.sh`

This remains valid as wrapper-repo history, but it is not the live edge truth.

### Verified Live Caddy State
Verified from direct SSH capture:
- service unit: `/usr/lib/systemd/system/caddy.service`
- active config file: `/etc/caddy/Caddyfile`
- listeners:
  - `*:80`
  - `*:443`
  - `*:4445`
  - `*:4446`
  - admin/API on `127.0.0.1:2019`

Verified live Caddy behavior:
- `agents.high.support` and `relay.high.support` are handled by the public standard-port Caddy site block
- `high.support` and `cfrelay.high.support` enter through cloudflared and do not use that Caddy site block
- requests generally reverse proxy to `127.0.0.1:4430`
- `/api/v2/telemetry` is rewritten to `/agent.ashx`
- bare unauthenticated `GET /` serves a cover page from `/var/www/cover`
- explicit listeners:
  - `agents.high.support:4445` and `agents.high.support:4446`
  - `relay.high.support:4446`
- certificate files on the legacy agent listeners:
  - `/etc/caddy/tls/meshcentral-agent-tls.crt`
  - `/etc/caddy/tls/meshcentral-agent-tls.key`
- the legacy listeners remain migration compatibility state and are not present in new provisioning metadata

Tracked local reference:
- `infra/caddy/Caddyfile.live` is reconciled to the July 26 capture of `/etc/caddy/Caddyfile`

### Verified Live Cloudflared State
Verified from direct SSH capture and the VPS-resident `cloudflared` CLI:
- service unit: `/etc/systemd/system/cloudflared.service`
- config file: `/etc/cloudflared/config.yml`
- tunnel id: `3f1b39ec-103b-442d-aec1-8ab694c3dc69`
- tunnel name: `meshcentral`
- cloudflared version: `2026.3.0`
- connector architecture: `linux_amd64`
- connector origin IP: `74.208.52.191` (verified by the successful July 26 direct SSH capture; a later read-only recheck timed out)
- ingress:
  - `high.support` -> `http://127.0.0.1:4430`
  - `cfrelay.high.support` -> `http://127.0.0.1:4430`
  - fallback -> `http_status:404`

## Cloudflare Control SSOT
### Verified VPS Control Path
Verified through direct SSH on April 13, 2026:
- remote token bridge: `/root/.cloudflare-api.env`
- bridge permissions: `600 root:root`
- remote wrapper path: `/usr/local/bin/cf-wrangler`
- wrapper permissions: `700 root:root`
- wrapper runtime: `npx --yes wrangler 4.82.0`
- wrapper auth mode: user API token
- wrapper behavior: sources `/root/.cloudflare-api.env`, which bridges the runtime token source, and forces IPv4-first resolution via `NODE_OPTIONS=--dns-result-order=ipv4first`
- `cf-wrangler whoami` succeeds through the wrapper

### Verified Token Source
Verified through redacted inspection on April 13, 2026:
- token source file: `/opt/meshcentral/meshcentral-data/cloudflare.env`
- source variables present:
  - `CF_API_TOKEN`
  - `CF_ZONE_ID`
  - `CF_DOMAIN`
  - `CF_ACCOUNT_EMAIL`
- the source token file is not copied into the repo or local snapshot

### Verified Control Facts
- Cloudflare account id: `9a6ee225286d1177ed3de1e33a41323d`
- zone id: `34f290f59f968462eb8c637690d32e5e`
- zone name: `high.support`
- zone status: `active`
- zone type: `full`
- SSL setting: `strict`

### IPv6 / IPv4 Behavior
- direct zone API reads from the VPS default egress hit Cloudflare error `9109` and reference the VPS IPv6 address
- forcing IPv4 makes both zone reads and `cf-wrangler whoami` succeed
- `/usr/local/bin/cf-wrangler` now forces IPv4-first resolution by default

## Cloudflare Zone State
### Verified DNS Records
From live Cloudflare API export on April 13, 2026:
- `high.support` -> `3f1b39ec-103b-442d-aec1-8ab694c3dc69.cfargotunnel.com`, proxied `true`, type `CNAME`
- `cfrelay.high.support` -> `3f1b39ec-103b-442d-aec1-8ab694c3dc69.cfargotunnel.com`, proxied `true`, type `CNAME`
- `agents.high.support` -> `74.208.52.191`, proxied `false`, type `A` (operator-updated after the April 19, 2026 VPS move; Cloudflare export refresh pending)
- `relay.high.support` -> `74.208.52.191`, proxied `false`, type `A` (operator-updated after the April 19, 2026 VPS move; Cloudflare export refresh pending)
- `www.high.support` -> `high.support`, proxied `false`, type `CNAME`
- `_dmarc.high.support` -> DMARC TXT present
- `_domainconnect.high.support` -> domain connect CNAME present

### Verified Zone Settings
From live Cloudflare API export on April 13, 2026:
- `ssl`: `strict`
- `min_tls_version`: `1.2`
- `tls_1_3`: `on`
- `http3`: `on`
- `websockets`: `on`
- `always_use_https`: `on`
- `automatic_https_rewrites`: `on`
- `security_level`: `medium`
- `browser_check`: `on`
- `waf`: `off`
- `ipv6`: `on`
- `pseudo_ipv4`: `off`
- `opportunistic_encryption`: `on`
- `0rtt`: `off`
- `cache_level`: `aggressive`
- `browser_cache_ttl`: `0`

### Verified Page Rules
Two active page rules exist:
- priority `1`: `high.support/*.ashx*` -> `security_level=essentially_off`, `cache_level=bypass`
- priority `2`: `cfrelay.high.support/*.ashx*` -> `security_level=essentially_off`, `cache_level=bypass`

### Verified Firewall and Custom Rules
- legacy firewall rule exists: `Skip security features for MeshCentral proxied websocket and relay endpoints`
- filter expression:
  - `((http.host eq "high.support" and http.request.uri.path in {"/agent.ashx" "/control.ashx"}) or (http.host eq "cfrelay.high.support" and http.request.uri.path in {"/control-redirect.ashx" "/meshrelay.ashx"}))`
- the `http_request_firewall_custom` phase contains the same enabled `skip` rule

### Phase Export Status
- `http_request_firewall_custom`: exported successfully
- `http_ratelimit`: no entrypoint ruleset present
- `http_request_late_transform`: no entrypoint ruleset present
- `http_request_transform`: no entrypoint ruleset present
- `http_response_headers_transform`: no entrypoint ruleset present
- `http_request_origin`: no entrypoint ruleset present
- `http_request_redirect`: phase not allowed at zone level
- `http_request_cache_settings`: token not authorized for this phase
- `http_request_dynamic_redirect`: token not authorized for this phase

## Runtime Overrides and Customization
### Custom UI
Recovered from the live VPS and currently present locally:
- `public/scripts/custom.js`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-web/public/scripts/custom.js`

This file contains the UMH control UI and console bridge, including commands such as:
- `umhctl install`
- `umhctl status`
- `umhctl listProcesses`
- `umhctl getFlowContract`
- `umhctl getCapabilities`
- `umhctl inject`
- `umhctl disable`
- `umhctl disableAll`
- `umhctl clearTargetScope`
- `umhctl lockdownBypass`
- `umhctl examsoftBypass`
- `umhctl ipcBypass`

### Runtime Core Override
Runtime copies retained outside Git:
- `meshcentral-data/meshcore.js`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-data/meshcore.js`

Status:
- on 2026-07-26, the local datapath core was reviewed and its relay-only experimental drift was intentionally discarded
- `meshcentral-data/meshcore.js` is byte-for-byte identical to `agents/meshcore.js` at SHA256 `281ef72c93fd7696085d0c87669decc1ea081e82a7cc9181ee11ee085d5f0ae3`
- the retained server-backup copy is recovery evidence and must not be treated as current runtime state without a fresh comparison

## Service and Host Layout
### Verified Live Remote Paths
Verified from direct SSH capture:
- application root: `/opt/meshcentral`
- data root: `/opt/meshcentral/meshcentral-data`
- web override root: `/opt/meshcentral/meshcentral-web`
- systemd unit: `/etc/systemd/system/meshcentral.service`
- cloudflared unit: `/etc/systemd/system/cloudflared.service`
- caddy config: `/etc/caddy/Caddyfile`
- backup directories observed:
  - `/opt/meshcentral/backups`
  - `/opt/meshcentral/server-backups`
  - `/opt/meshcentral/runtime-backup-20260402_152547`

### Service User Model
Verified from live service unit and host ownership:
- service name: `meshcentral`
- service user: `meshcentral`
- service group: `meshcentral`
- working directory: `/opt/meshcentral`
- startup command: `/usr/bin/node /opt/meshcentral/node_modules/meshcentral/meshcentral.js`

## Backup Scope SSOT
### Must Back Up
Sensitive runtime state that must stay out of Git but must be recoverable locally:
- `meshcentral-data/config.json`
- `meshcentral-data/meshcore.js`
- MongoDB dump for `meshcentral`
- edge proxy config: Caddy in live state, Nginx only if intentionally restoring the repo-era deployment shape
- `public/scripts/custom.js`
- Cloudflare non-secret control evidence and zone export
- systemd units and cloudflared config

### Nice To Have
- `journalctl -u meshcentral` diagnostic tail
- `ss -ltnp` listener snapshot
- firewall snapshot
- DNS resolution snapshot

### Captured Live Snapshot
Current live snapshot directory:
- `server-backups/meshcentral-live-20260413-153810`

Verified captured evidence includes:
- live `Caddyfile`
- live `cloudflared` config and tunnel CLI evidence
- live `meshcentral.service`
- live `cloudflared.service`
- live `meshcentral-data/config.json`
- live `meshcentral-data/meshcore.js`
- deployed live `custom.js`
- live DB collection counts
- live `mongodump` archive
- Cloudflare raw zone export and concise summary
- manifest with per-file hashes

## Current Truth Boundary
What is true now:
- the repo documents and automates an Nginx-first deployment model, but the live server is currently Caddy-fronted
- the local runtime config uses MongoDB and enables `umhControls`
- the UMH custom UI exists in `public/scripts/custom.js`
- the live app root is `/opt/meshcentral`
- the live edge stack is `Caddy + cloudflared`
- the live MeshCentral, Caddy, cloudflared, and MongoDB services are active
- the live database is MongoDB on `127.0.0.1:27017`
- the live Cloudflare zone, key zone settings, DNS records, page rules, firewall skip rule, and post-fix cache policy are exported locally
- the tracked local live-edge copy is `infra/caddy/Caddyfile.live`
- the VPS can act as the Cloudflare control point through `/usr/local/bin/cf-wrangler`

What is not yet proven:
- any dashboard surfaces that the current token cannot read
- the contents of unauthorized rule phases such as `http_request_cache_settings` and `http_request_dynamic_redirect`

