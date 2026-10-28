# Operations Docs

Operations documentation for the MeshCentral deployment wrapper.

Files:
- `Production-Server.md`: the production host, services, Caddy and cloudflared edge, Cloudflare zone and control path, secrets, and how to capture the live state.
- `Desktop-Audio.md`: desktop audio (relay protocol 20) behavior, disable switches, audit msgids, and the session-recording requirement.

Tracked copies of live files: `infra/caddy/Caddyfile.live` (the production `/etc/caddy/Caddyfile`) and
`meshcentral-web/public/scripts/custom.js`. Runtime state (`meshcentral-data/`) and live captures stay
out of Git.
