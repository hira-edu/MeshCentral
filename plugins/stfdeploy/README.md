Security Testing Framework Deployer (MeshCentral Plugin)

Overview
- One‑click deployment of the Security Testing Framework to endpoints from MeshCentral.
- Uses repo‑managed, versioned artifacts stored under `plugins/stfdeploy/assets/` and served at `https://high.support/plugins/stfdeploy/assets/` via Nginx.

Usage
- Ensure plugin is present on the server under `/opt/meshcentral-app/meshcentral-data/plugins/stfdeploy` (handled by CI deploy script).
- Open MeshCentral → Plugins → STF Deployer, then click “Deploy”.
- The plugin downloads the latest artifact (`assets/latest.zip`) and pushes to selected devices per your Mesh policy.

Artifacts
- CI workflow can fetch build artifacts from the Security Testing Framework repo and save into `plugins/stfdeploy/assets/` with versioned filenames.
- `assets/latest.zip` should point to the most recent tested artifact (see artifact sync workflow in this repo).

