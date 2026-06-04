# Operations Docs

This folder is the server-operations SSOT for the local MeshCentral deployment wrapper.

Files:
- `Cloudflare-Change-Ledger.md`: tracked ledger of live Cloudflare control-path and zone-setting changes.
- `Server-Operations-Plan.md`: remediation plan and remaining operational blockers.
- `Server-Setup-SSOT.md`: verified live topology, runtime settings, edge stack, Cloudflare control path, and database model.
- `Backup-and-Restore-Runbook.md`: backup scope, restore order, and recovery rules.

Current verified state on April 13, 2026:
- Working SSH administration target after the April 19, 2026 VPS move is `meshcentral` -> `74.208.52.191`, but fresh SSH validation is still blocked by timeout and the last successful capture used `167.88.44.65`.
- The live edge stack is `Caddy + cloudflared`; repo-era Nginx files are historical wrapper evidence only.
- The VPS is the active Cloudflare control point through `/usr/local/bin/cf-wrangler`.
- Live Cloudflare state is exported into `server-backups/meshcentral-live-20260413-153810/cloudflare/`.
- The tracked local source carryovers are `public/scripts/custom.js` and `infra/caddy/Caddyfile.live`.
- Runtime-only carryovers remain ignored under `meshcentral-data/` and `server-backups/`.
