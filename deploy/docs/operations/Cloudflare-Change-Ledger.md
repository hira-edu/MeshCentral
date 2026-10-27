# Cloudflare Change Ledger

Date: April 13, 2026
Scope: `high.support` production zone and the VPS-resident Cloudflare control path

## Verified Control Path
- VPS control wrapper: `/usr/local/bin/cf-wrangler`
- token bridge: `/root/.cloudflare-api.env`
- runtime token source: `/opt/meshcentral/meshcentral-data/cloudflare.env`
- control rule: do not copy the token source into Git or local snapshots

## Changes Applied
1. Verified the live Cloudflare token source on the VPS and bridged it into a root-only control file.
2. Fixed the VPS Cloudflare control path to use IPv4-first DNS resolution because direct IPv6 egress hit Cloudflare error `9109`.
3. Verified `cf-wrangler whoami` from the VPS control path.
4. Set `always_use_https=on` for the live zone.
5. Set `browser_cache_ttl=0` so browser caching respects MeshCentral origin headers instead of stretching static asset cache lifetime at Cloudflare.

## Verified Results
- `http://high.support/` now redirects to `https://high.support/`
- `https://high.support/scripts/custom.js` now returns `Cache-Control: public, max-age=0`
- live zone SSL mode remains `strict`
- the live Cloudflare zone export is stored under `server-backups/meshcentral-live-20260413-153810/cloudflare/`

## Remaining Blockers
- the current token cannot export every zone-level ruleset phase
- dashboard-only surfaces outside the token/API scope are still not fully exported
- cache purge with the current token returned authentication error `10000`, so purge rights are not currently available through this token

## Evidence
- `docs/operations/Server-Setup-SSOT.md`
- `docs/operations/Backup-and-Restore-Runbook.md`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/action-log.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/zone-summary.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/api-readiness.txt`
