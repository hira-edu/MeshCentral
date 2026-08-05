# MeshCentral UMH Control Sister-Repo SSOT

Last Updated: 2026-08-05
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

The live UI does not expose a dedicated `uiSnapshot` button. That is intentional UI curation, not proof that the underlying operator layer lacks `uiSnapshot`.

Retired from the UI surface:

- `getInjectionState`
- `setFlags`
- `disable`
- `disableAll`
- `registerProtectedPid`
- `unregisterProtectedPid`
- `hookControl`
- `ipcBypass`
- `lockdownBypass`
- `examsoftBypass`

Input and WDA neutralization for LockDown, ETS, and PSI is automatic at HookDLL
install time. The UI exposes no manual arm/disarm or bypass-style operator control.

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

- live `custom.js` SHA256: `bc119066a1875f171ce812206d56e0429c460eb3c93d3b063052902b10115d7c`
- live published `MasterService.exe` path: `/opt/meshcentral/meshcentral-files/domain/user-hsadmin/Public/MasterService.exe`
- rolled-back-agent-compatible `MasterService.exe` URL: `https://agents.high.support/userfiles/hsadmin/MasterService.exe?download=1`
- live published `MasterService.exe` SHA256: `347f3c5ec7478fbb9e765d70b39ba4130a018662b2be633fe424af9440d14fc1`
- live published `MasterService.exe` SHA384 / install pin: `827b9d4e9bb254a2bdb4e9c423a3ae97e319f119941f4c2bd792719ac7bcf178e6932b452aa23d02e7164908f60e1b54`
- live published `MasterService.exe` size: `16986624`
- all four live `umhctl.js` copies SHA256: `64cd8c4c660fd14f4b9a64a9b20345e84488762b152f3943491664ed94a5448f`
- live `recoverycore.js` SHA256: `4013fa7f958632df0462f2fbbd8cef6cb35663e7b2f3334a43017be7a4a75843`
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
