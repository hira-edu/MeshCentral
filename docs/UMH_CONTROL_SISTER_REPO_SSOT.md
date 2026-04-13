# MeshCentral UMH Control Sister-Repo SSOT

Last Updated: 2026-04-14
Owner: Codex + User
Status: Active sister-repo SSOT for the MeshCentral UMH operator UI

## Purpose

This repo owns the browser-side UMH operator UI that emits `umhctl` commands. It does not define the native `UserModeHook` CLI, and it does not define the full endpoint operator contract by itself.

Authoritative sister docs:

- `C:\Users\Workstation\Documents\GitHub\UserModeHook\docs\ssot\UmhControlSisterRepoContract.md`
- `C:\Users\Workstation\Documents\GitHub\UserModeHook\docs\ssot\UmhControlDeploymentLedger.md`
- `C:\Users\Workstation\Documents\GitHub\MeshAgent\docs\UMH_CONTROL_SISTER_REPO_SSOT.md`
- `C:\Users\Workstation\Documents\GitHub\MeshAgent\docs\UMH_CONTROL_DEPLOYMENT_LEDGER.md`

## Owned Surface

This repo owns:

- `public/scripts/custom.js`
- live publication mapping for the deployed `custom.js` override
- the visible operator buttons exposed in the MeshCentral UI

This repo does not own:

- the native `UmhCli.exe` command names in `UserModeHook`
- the endpoint-side `umhctl` request builder in `MeshAgent`

## Current Curated UI Subset

`public/scripts/custom.js` intentionally exposes a curated subset of the retained agent-side operator contract:

- lifecycle: `install`, `uninstall`, `status --service`, `verify`, `help`
- query: `status`, `listProcesses`, `getFlowContract`, `getCapabilities`, `safetyState`
- pid-scoped query: `profileProcess`, `methodPolicy`, `securityBoundary`
- mutation: `inject`, `injectAll`, `clearTargetScope`
- bypass: `ipcBypass`, `lockdownBypass`, `examsoftBypass`

The UI must not expose retired operator ops as clickable green paths.

Retired from the UI surface:

- `getInjectionState`
- `setFlags`
- `disable`
- `disableAll`
- `registerProtectedPid`
- `unregisterProtectedPid`

## Sync Rule

If `custom.js` changes any UMH-emitted command, the same tranche must update:

1. `MeshAgent` operator contract/tests
2. `UserModeHook` SSOT/ledger docs
3. this repo's UMH ledger doc

No MeshCentral UMH button change is complete until those sister docs agree.
