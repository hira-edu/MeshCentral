Security Testing Framework Deployer (MeshCentral Plugin)

Overview
- One-click deployment of the Security Testing Framework to endpoints from MeshCentral.
- Uses repo-managed, versioned artifacts stored under `plugins/stfdeploy/assets/` and served at `https://high.support/plugins/stfdeploy/assets/`.

Usage
- Ensure the plugin is present on the server under `/opt/meshcentral-app/meshcentral-data/plugins/stfdeploy` (handled by CI deploy script).
- Device page: open a device, switch to the STF tab, and use the Run buttons to trigger install/uninstall on the selected device. Live status updates appear in the log area.
- Admin panel: My Server -> Plugins -> STF Deployer. Enter one or more `node/<domain>/<nodeid>` lines, pick an action, and click Queue Action. The server enqueues commands and responds with a `batchId`, queued count, and any per-node errors.
  - Alternatively choose Scope = Group and enter `mesh/<domain>/<id>` to target that group. Nodes are resolved and authorized server-side; unsupported scopes will be rejected with a clear error.
  - Scope = Search lets you target by `meshid` and a simple query DSL. Examples:
    - `name~=server online=true` (name contains "server", online devices only)
    - `host~=db` (hostname contains "db")
    - `name=Workstation-01` (exact name match)
    - Supported keys: `name`, `host` with `=` (exact) or `~=` (contains), and `online=true|false`.

Artifacts
- CI workflow can fetch build artifacts from the Security Testing Framework repo and save into `plugins/stfdeploy/assets/` with versioned filenames.
- `assets/latest.zip` should point to the most recent tested artifact (see artifact sync workflow in this repo).
- If `latest.zip.sha256` is present (same URL + `.sha256`), Windows deployments verify the SHA256 before extracting; a mismatch aborts the install.
