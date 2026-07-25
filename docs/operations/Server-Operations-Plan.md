# Server Operations Plan

Date: April 13, 2026
Scope: MeshCentral deployment wrapper repo at `C:\Users\Workstation\Documents\GitHub\MeshCentral`

## Goal
Keep the local repo aligned with the actual live VPS deployment, keep a repeatable local backup of deployment-critical state, and treat Cloudflare as part of the documented production surface instead of an external assumption.

## Current Verified State
- direct SSH administration target after the April 19, 2026 VPS move: `meshcentral` -> `74.208.52.191` (verified by a July 26 direct capture; a later read-only recheck timed out)
- live host name: `srv1057130`
- live edge stack: `Caddy + cloudflared`
- live application root: `/opt/meshcentral`
- live data root: `/opt/meshcentral/meshcentral-data`
- live database: MongoDB on `127.0.0.1:27017/meshcentral`
- live Cloudflare control path on the VPS: `/usr/local/bin/cf-wrangler`
- live Cloudflare token source on the VPS: `/opt/meshcentral/meshcentral-data/cloudflare.env`
- current live snapshot: `server-backups/meshcentral-live-20260413-153810`
- tracked live edge reference: `infra/caddy/Caddyfile.live`

## Resolved In This Tranche
- captured a live VPS snapshot with Caddy, cloudflared, MeshCentral, MongoDB, and Cloudflare evidence
- documented the real live stack instead of the older Nginx-first wrapper assumption
- verified the VPS-resident Cloudflare control path and bridged it through a root-only wrapper
- fixed live Cloudflare browser caching drift by setting `browser_cache_ttl=0`
- fixed proxied host HTTPS enforcement by setting `always_use_https=on`
- verified live external headers after the changes

## Operating Rules
1. Treat `docs/operations/Server-Setup-SSOT.md` as the current deployment truth.
2. Treat `infra/nginx/meshcentral.conf` and `scripts/remote/*.sh` as repo-era deployment history unless they are intentionally reworked for the live stack.
3. Keep secrets out of Git:
   - `meshcentral-data/config.json`
   - MongoDB dumps
   - `/opt/meshcentral/meshcentral-data/cloudflare.env`
   - `/root/.cloudflare-api.env`
4. Keep the VPS as the Cloudflare control point until a local workstation auth flow is intentionally established.
5. Preserve IPv4-first behavior in the Cloudflare wrapper because direct IPv6 egress on this host hits Cloudflare error `9109`.

## Phase 1: Preserve the Live Baseline
1. Keep `server-backups/meshcentral-live-20260413-153810/` as the current reference snapshot.
2. Refresh the live snapshot after any meaningful server, Cloudflare, or MeshCentral runtime change.
3. Keep the tracked live edge copy at `infra/caddy/Caddyfile.live` in sync with `/etc/caddy/Caddyfile` whenever the live Caddy config changes.

## Phase 2: Edge and Cloudflare SSOT
1. Treat live Caddy and cloudflared state as authoritative over older Nginx wrapper assumptions.
2. Keep `/usr/local/bin/cf-wrangler` and `/root/.cloudflare-api.env` as the VPS Cloudflare control path.
3. Keep `always_use_https=on` for proxied hosts unless the deployment design intentionally changes.
4. Keep `browser_cache_ttl=0` so Cloudflare respects MeshCentral origin cache headers instead of stretching browser asset caching.
5. Record any Cloudflare change back into the local ops docs and snapshot immediately.

## Phase 3: Runtime and Database SSOT
1. Keep the sanitized live MeshCentral runtime config current in docs.
2. Keep MongoDB dumps and collection counts tied to the same backup tranche as the runtime files.
3. Keep runtime overrides such as `public/scripts/custom.js` and `meshcentral-data/meshcore.js` explicit in the snapshot and docs.
4. Keep `meshcentral-data/meshcore.js` as runtime-only state until it is intentionally reviewed for source promotion.

## Phase 4: Drift Control
1. Promote only intentional source files and sanitized docs into tracked history.
2. Keep raw runtime config, DB dumps, and Cloudflare token files out of Git.
3. Keep live-vs-repo differences explicit whenever the deployed host diverges from wrapper-repo history.
4. Before changing UMH integration again, complete the sister-repo contract review across UserModeHook, MeshCentral, and MeshAgent.

## Active Blockers
- `PARTIAL_SCOPE`: the current token cannot export every zone-level ruleset phase.
- `UNVERIFIED_DASHBOARD`: dashboard-only surfaces outside the token/API scope are still not exported.
- `HISTORICAL_DEPLOY_SCRIPTS`: the repo still carries older Nginx-first deployment scripts that do not match the live Caddy-first stack.

## Next Verification Queue
1. Regenerate the live snapshot with the updated capture script after the next production change.
2. Decide whether to widen the Cloudflare token scope if `http_request_cache_settings` or `http_request_dynamic_redirect` need explicit audit.
3. Reconcile the repo deployment scripts only when you are ready to standardize the wrapper repo on the current Caddy-first stack.
4. Align UMH sister-repo contracts before changing the MeshCentral UMH surface again.
