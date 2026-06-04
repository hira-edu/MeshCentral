# Backup and Restore Runbook

Date: April 13, 2026

## Rules
- Do not commit raw `meshcentral-data/config.json`.
- Do not commit database dumps.
- Do not commit Cloudflare token source files.
- Keep snapshots under `server-backups/` only.
- Always create a sanitized config summary alongside the raw backup.
- Separate live-captured files from repo-source files in every snapshot manifest.

## Current Verified Backup Sets
### Local Recovered Snapshot
- `server-backups/meshcentral-local-20260413-153246`
- source: local recovered runtime state and repo-managed files

### Live VPS Snapshot
- `server-backups/meshcentral-live-20260413-153810`
- source: last successful direct SSH capture from `meshcentral` -> `167.88.44.65`
- operator-designated replacement SSH target after the April 19, 2026 VPS move: `meshcentral` -> `74.208.52.191`
- current blocker: direct SSH to `74.208.52.191:22` timed out from the workstation, so a fresh live snapshot is still pending
- verified captured evidence:
  - `/etc/caddy/Caddyfile`
  - `/etc/cloudflared/config.yml`
  - `/etc/systemd/system/meshcentral.service`
  - `/etc/systemd/system/cloudflared.service`
  - `/opt/meshcentral/meshcentral-data/config.json`
  - `/opt/meshcentral/meshcentral-data/meshcore.js`
  - `/opt/meshcentral/meshcentral-web/public/scripts/custom.js`
  - MongoDB collection counts
  - `mongodump` archive
  - Cloudflare tunnel CLI evidence
  - VPS `cf-wrangler` control wrapper
  - Cloudflare zone export and summary

## Current Local Backup Scope
The local backup script captures:
- `meshcentral-data/config.json` if present
- `meshcentral-data/meshcore.js` if present
- `meshcentral-data/config.json.template`
- `public/scripts/custom.js` if present
- `infra/caddy/Caddyfile.live` if present
- `infra/nginx/meshcentral.conf` if present
- `scripts/remote/*`
- `scripts/oneclick/*`
- `package.json`
- `readme.md`
- plugin config under `plugins/stfdeploy/` if present

It also writes:
- `backup-manifest.json`
- `config.sanitized.json` if a runtime config exists

## Local Backup Command
From repo root:

```powershell
pwsh -File .\scripts\ops\New-MeshCentralLocalBackup.ps1
```

Optional custom output root:

```powershell
pwsh -File .\scripts\ops\New-MeshCentralLocalBackup.ps1 -OutputRoot server-backups
```

## Restore Order
1. Restore repo-managed wrapper files.
2. Restore the live edge config that matches the server you are rebuilding.
3. If rebuilding the current production shape, start from the tracked reference `infra/caddy/Caddyfile.live` and then verify it against the latest live `/etc/caddy/Caddyfile`.
4. Restore the live service units.
5. Restore `public/scripts/custom.js`.
6. Restore `meshcentral-data/config.json`.
7. Restore `meshcentral-data/meshcore.js` if the runtime override is still required.
8. Restore MongoDB from dump.
9. Restore the VPS Cloudflare control wrapper if you use the VPS as the Cloudflare control point.
10. Recreate the token bridge file, but never restore a secret into Git.
11. Restart services and validate listeners, TLS, websocket paths, and agent/relay ports.

## Live Host Restore Targets
Current verified live targets:
- app root: `/opt/meshcentral`
- data root: `/opt/meshcentral/meshcentral-data`
- web override root: `/opt/meshcentral/meshcentral-web`
- live edge config: `/etc/caddy/Caddyfile`
- live tunnel config: `/etc/cloudflared/config.yml`
- service unit: `/etc/systemd/system/meshcentral.service`
- cloudflared unit: `/etc/systemd/system/cloudflared.service`
- VPS Cloudflare token bridge: `/root/.cloudflare-api.env`
- VPS Cloudflare wrapper: `/usr/local/bin/cf-wrangler`
- Cloudflare runtime token source: `/opt/meshcentral/meshcentral-data/cloudflare.env`
- database: MongoDB on `127.0.0.1:27017/meshcentral`

## Full Live Backup Checklist
Capture all of the following for a complete backup set:
- live `config.json`
- live `meshcore.js`
- deployed `custom.js`
- live plugin directory or plugin config if customized
- live `Caddyfile`
- live `cloudflared` config
- live `meshcentral.service`
- `mongodump` archive
- collection counts
- listener snapshot
- firewall snapshot
- DNS resolution snapshot
- Cloudflare tunnel CLI evidence
- Cloudflare zone export and summary
- manifest with per-file hashes

## MongoDB Commands
Use the sanitized runtime URI pattern in docs and the real secret URI only in local ops:

```bash
mongodump --uri "mongodb://<user>:<password>@127.0.0.1:27017/meshcentral" --gzip --archive=meshcentral.archive.gz
```

Restore example:

```bash
mongorestore --uri "mongodb://<user>:<password>@127.0.0.1:27017/meshcentral" --gzip --archive=meshcentral.archive.gz --drop
```

## Edge and Cloudflare Restore Notes
- The current live stack is `Caddy + cloudflared`; do not assume Nginx during restore unless the deployment is intentionally being changed.
- The VPS Cloudflare control path is `/usr/local/bin/cf-wrangler`, which sources `/root/.cloudflare-api.env` and forces IPv4-first resolution so Cloudflare API calls do not hit the VPS IPv6 location restriction.
- `/root/.cloudflare-api.env` is a bridge file, not the original token source.
- The real token source currently lives at `/opt/meshcentral/meshcentral-data/cloudflare.env` and must not be copied into the repo or local snapshot.
- Recreate `/root/.cloudflare-api.env` as a root-only file with `600` permissions after a rebuild.
- Recreate `/usr/local/bin/cf-wrangler` with `700` permissions if the VPS control wrapper is lost.
- `high.support` and `cfrelay.high.support` currently resolve to Cloudflare Tunnel CNAMEs and are proxied.
- `agents.high.support` and `relay.high.support` should resolve directly to `74.208.52.191` after the April 19, 2026 VPS move; the last captured export still showed `167.88.44.65` and needs refresh.
- Validate `443`, `4445`, and `4446` routing before rotating clients.
- Keep Cloudflare in `strict` SSL mode, keep `always_use_https=on` for proxied hosts, and preserve browser-cache behavior that respects the MeshCentral origin headers (`browser_cache_ttl=0`).

## Remaining Gaps
- the current token cannot export every zone ruleset phase
- dashboard-only surfaces outside the token/API scope are still not fully exported

