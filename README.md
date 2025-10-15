MeshCentral Deploy

Overview
- Local development and production deployment setup for MeshCentral.
- Includes: local install scripts, Docker compose (optional), GitHub Actions CI/CD to deploy over SSH, and remote bootstrap scripts (Node.js + systemd).

Repo Layout
- `package.json` – Project wrapper, depends on `meshcentral`.
- `meshcentral-data/` – Config and data directory (persistent). Do not commit secrets.
- `plugins/` – Place your custom plugins here (see notes below).
- `scripts/` – Local and remote helper scripts.
- `.github/workflows/deploy.yml` – CI/CD to deploy to your server via SSH.
 - `docker-compose.yml` – Optional Docker-based runtime.

Prerequisites
- Local: Node.js 18+ and npm.
- Remote server: Root SSH access (CI will connect). Script attempts to install Node.js 18 LTS if missing and configure systemd.
- GitHub repository for this project (push this folder as a repo).

Quick Start (Local)
1) Copy config template:
   - `cp meshcentral-data/config.json.template meshcentral-data/config.json`
   - Edit `meshcentral-data/config.json` as needed.
2) Install and run:
   - Linux/macOS: `bash scripts/setup-local.sh`
   - Windows PowerShell: `pwsh -File scripts/setup-local.ps1`
3) Access MeshCentral at the host/port from your config (default 443 or 8080 depending on config).

CI/CD (GitHub Actions → Server)
1) Push this project to a GitHub repository.
2) In the GitHub repo Settings → Secrets and variables → Actions, add:
   - `SSH_HOST` = 72.60.233.29
   - `SSH_USER` = root
   - `SSH_PASSWORD` = your root password (avoid committing any secrets)
   - Optional: `SSH_PORT` = 22
3) On push to `main`, the workflow will:
   - Upload this repo to `/opt/meshcentral-app` on the server
   - Install Node.js 18 (if needed)
   - Run `npm ci --omit=dev`
   - Configure/enable `meshcentral.service` (systemd)
   - Restart MeshCentral

Switching to Docker (Server)
- If you prefer running MeshCentral via Docker on the server:
  1) Ensure Docker + Docker Compose are installed on the server.
  2) In the CI step, instead of `scripts/remote/bootstrap.sh`, run:
     - `docker compose pull && docker compose up -d`
  3) Adjust exposed ports and volumes in `docker-compose.yml`.

Custom Plugins
- Place your plugin sources under `plugins/` during development.
- Depending on how your plugins integrate, you may either:
  - Use MeshCentral’s plugin system (recommended) and load plugins via config (see MeshCentral docs), or
  - Copy plugin files into the runtime tree and require them from a custom module.
- This repo doesn’t enforce a specific plugin layout; adapt `meshcentral-data/config.json` to load/enable your plugins.

Troubleshooting Plugins
- Enable verbose logging in `meshcentral-data/config.json` if needed, and inspect logs in the service journal on the server:
  - `journalctl -u meshcentral -f -n 200`
- Validate your plugin’s `require` paths and ensure files are deployed under the expected directory on the server.
- Confirm Node.js version matches local (Node 18+) to avoid runtime differences.

Notes
- Never commit real credentials to the repo. Use GitHub Secrets for CI.
- If your server is not Debian/Ubuntu based, adjust remote scripts in `scripts/remote/` accordingly.
- If you prefer Docker on the server, `docker-compose.yml` is provided; you can switch the CI to use Docker-based deployment instead of systemd.
