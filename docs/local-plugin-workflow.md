Local Plugin Workflow
=====================

This repo now contains everything needed to exercise the ManualMap, SWDA Bypass, and Bypass Methods plugins locally and push updates to production.

Prerequisites
-------------
- Node.js 18+ (MeshCentral bundles its own build tooling).
- `npm install` run in the repo root at least once.
- `sshpass` installed if you plan to use the deployment helper (`brew install hudochenkov/sshpass/sshpass` on macOS).

Local MeshCentral Setup
-----------------------
1. Ensure `meshcentral-data/config.json` exists (already checked in). Adjust the ports if needed.
2. Create an admin account the first time you spin up the server:
   ```
   node meshcentral --createaccount localadmin --pass "LocalTest123!"
   node meshcentral --adminaccount localadmin
   ```
3. Launch the server with non-privileged ports (use `--exactports` so it fails fast if a port is busy):
   ```
   node meshcentral --port 8443 --redirport 8080 --exactports
   ```
4. Log in at `https://127.0.0.1:8443/` using `localadmin / LocalTest123!`. The three plugins are pre-registered for the default domain.

Automated Queue Regression Test
-------------------------------
Run the lightweight harness whenever you touch the queueing logic:
```
node scripts/test-plugin-queues.js
```
The script simulates a busy MeshAgent, verifies the retry budget, and ensures the queued job only fires after the running job clears.

Deploying Updates to Production
-------------------------------
1. Export the SSH password (change host/user/path if you maintain a staging box):
   ```
   export MESH_REMOTE_PASS='Um@ir71560000'
   export REMOTE_HOST='72.60.233.29'
   export REMOTE_USER='root'
   export REMOTE_BASE='/opt/meshcentral/meshcentral-data/plugins'
   ```
2. Push the plugin folders and restart MeshCentral:
   ```
   scripts/deploy-plugins.sh
   ```
   Pass `-n` if you need to skip the restart.
3. Watch the journal output printed by the script for any runtime errors.

Next Steps
----------
- Attach a local MeshAgent to exercise real deployments end-to-end.
- Extend `scripts/test-plugin-queues.js` if you need to cover additional edge cases (timeouts, multi-node fan-out, etc.).
