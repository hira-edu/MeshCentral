# Caddy Live Reference

This folder holds the repo-tracked reference copy of the live MeshCentral Caddy configuration.

Files:
- `Caddyfile.live`: current captured `/etc/caddy/Caddyfile` from the production VPS

Rules:
- Treat `Caddyfile.live` as a tracked reference, not as a secret-bearing file.
- Update it only from a verified live capture.
- Keep changes to the actual VPS `Caddyfile` and this tracked copy aligned in the same ops tranche.
- Do not treat older `infra/nginx/` files as the live source of truth while production remains Caddy-fronted.
