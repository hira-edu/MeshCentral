# MeshCentral UMH Control Sister-Repo SSOT

Last Updated: 2026-04-19
Owner: Codex + User
Status: Active sister-repo SSOT for the MeshCentral UMH operator UI and live publication mappings

## Purpose

This repo owns the browser-side UMH operator UI that emits `umhctl` commands and the live publication mappings for the MeshCentral-served core files. It does not define the native `UserModeHook` CLI, and it does not define the full endpoint operator contract by itself.

Authoritative sister docs:

- `C:\Users\Workstation\Documents\GitHub\UserModeHook\docs\ssot\UmhControlSisterRepoContract.md`
- `C:\Users\Workstation\Documents\GitHub\UserModeHook\docs\ssot\UmhControlDeploymentLedger.md`
- `C:\Users\Workstation\Documents\GitHub\MeshAgent\docs\UMH_CONTROL_SISTER_REPO_SSOT.md`
- `C:\Users\Workstation\Documents\GitHub\MeshAgent\docs\UMH_CONTROL_DEPLOYMENT_LEDGER.md`

## Owned Surface

This repo owns:

- `public/scripts/custom.js`
- the live UI override publication at `/opt/meshcentral/meshcentral-web/public/scripts/custom.js`
- the MeshCentral-served UMH core publication copies under `agents/` and `meshcentral-data/`
- the visible operator buttons exposed in the MeshCentral UI

This repo does not own:

- the native `UmhCli.exe` command names in `UserModeHook`
- the endpoint-side `umhctl` request-building logic in `MeshAgent/modules/umhctl.js`

## Current Live Publication Paths

Current live-publication mappings relevant to UMH:

- `public/scripts/custom.js` -> `/opt/meshcentral/meshcentral-web/public/scripts/custom.js`
- `agents/meshcore.js` -> `/opt/meshcentral/node_modules/meshcentral/agents/meshcore.js`
- `agents/meshcore.min.js` -> `/opt/meshcentral/node_modules/meshcentral/agents/meshcore.min.js`
- `agents/recoverycore.js` -> `/opt/meshcentral/node_modules/meshcentral/agents/recoverycore.js`
- `agents/meshcore_diagnostic.js` -> `/opt/meshcentral/node_modules/meshcentral/agents/meshcore_diagnostic.js`
- `agents/tinycore.js` -> `/opt/meshcentral/node_modules/meshcentral/agents/tinycore.js`
- `meshcentral-data/meshcore.js` -> `/opt/meshcentral/meshcentral-data/meshcore.js`
- `agents/modules_meshcore/umhctl.js` -> `/opt/meshcentral/node_modules/meshcentral/agents/modules_meshcore/umhctl.js`
- `agents/modules_meshcore_min/umhctl.js` -> `/opt/meshcentral/node_modules/meshcentral/agents/modules_meshcore_min/umhctl.js`
- `meshcentral-data/modules_meshcore/umhctl.js` -> `/opt/meshcentral/meshcentral-data/modules_meshcore/umhctl.js`
- `meshcentral-data/modules_meshcore_min/umhctl.js` -> `/opt/meshcentral/meshcentral-data/modules_meshcore_min/umhctl.js`

## Current Curated UI Subset

`public/scripts/custom.js` intentionally exposes a curated subset of the retained agent-side operator contract:

- lifecycle: `install`, `uninstall`, `status --service`, `verify`, `help`
- query: `status`, `listProcesses`, `getFlowContract`, `getCapabilities`, `safetyState`
- pid-scoped query: `profileProcess`, `methodPolicy`, `securityBoundary`
- mutation: `inject`, `injectAll`, `clearTargetScope`
- bypass: `ipcBypass`, `lockdownBypass`, `examsoftBypass`

The live UI does not expose a dedicated `uiSnapshot` button. That is intentional UI curation, not proof that the underlying operator layer lacks `uiSnapshot`.

Retired from the UI surface:

- `getInjectionState`
- `setFlags`
- `disable`
- `disableAll`
- `registerProtectedPid`
- `unregisterProtectedPid`

## `uiSnapshot` Contract Notes

The underlying agent/operator layer still supports `umhctl uiSnapshot`.

Without `--pid`, it requests:

- `status`
- `flow_contract`
- `capabilities`
- `processes`
- `policy`
- `config`
- `safety_state`

With `--pid <pid>`, it additionally requests:

- `process_profile`
- `method_policy`
- `security_boundary`

`partial=true` means one or more section requests failed. It does not mean the entire snapshot failed.

Current expected live partial on a healthy canary:

- `config` fails when `UserModeHook` cannot read `C:\ProgramData\UserModeHook\config.json`
- that missing-file condition is currently the expected reason `uiSnapshot` remains `partial=true` on the live canary

## Current Live Validation Conditions

Current live evidence recorded across the sister ledgers:

- live `custom.js` SHA256: `fd4544d4eca48bf01d76ef3d554e33bdecfb33646db7627a72e7572261fdd2b9`
- live published `MasterService.exe` path: `/opt/meshcentral/meshcentral-files/domain/user-hsadmin/Public/MasterService.exe`
- rolled-back-agent-compatible `MasterService.exe` URL: `https://agents.high.support/userfiles/hsadmin/MasterService.exe?download=1`
- live published `MasterService.exe` SHA256: `e7784af6e6849ec11c8bf1ae5555a31d6adaa3f2da610b3635429c5bd8893bbd`
- live published `MasterService.exe` SHA384 / install pin: `86f0b4828b36ac88351ceb687fc61b8b6d608aa3d6d1406b79061518ba07b27af99c3334c30d9b00464c5a61c6277903`
- live published `MasterService.exe` size: `17078784`
- requested node `Sal` was offline during the 2026-04-14 validation tranche
- representative live validation used `DESKTOP-TONBSMQ` on the same core lineage (`Apr 9 2026, 3220172809`)

## 2026-04-19 VPS Move / Pending MasterService Republish

- operator-designated replacement MeshCentral VPS IP: `74.208.52.191`
- current local `MasterService.exe` publish candidate: `C:\Users\Workstation\Documents\GitHub\UserModeHook\build-fresh\bin\Release\MasterService.exe`
- current local candidate size: `17749504`
- current local candidate SHA256: `2324961d0d5ca5df82d43118524f39ae3d3752804bf5757729c2fb526e5ffeb3`
- direct SSH to `74.208.52.191:22` timed out on April 19, 2026, so the live published hash above remains the last verified VPS value until the republish step succeeds

## Sync Rule

If `custom.js` changes any UMH-emitted command, or if any MeshCentral-served UMH core publication copy changes, the same tranche must update:

1. `MeshAgent` operator contract/tests
2. `UserModeHook` SSOT/ledger docs
3. this repo's UMH ledger doc

No MeshCentral UMH button or publication change is complete until those sister docs agree.
