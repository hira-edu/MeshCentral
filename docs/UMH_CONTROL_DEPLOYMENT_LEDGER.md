# MeshCentral UMH Control Deployment Ledger

Last Updated: 2026-04-14
Owner: Codex + User
Status: Active deployment ledger for the MeshCentral UMH UI override and live core publication inventory

## Live Override Path

Current deployed UI override path:

- `/opt/meshcentral/meshcentral-web/public/scripts/custom.js`

Current local source path:

- `C:\Users\Workstation\Documents\GitHub\MeshCentral\public\scripts\custom.js`

Current `custom.js` hash:

- local: `7c62e820807bd3a681bdd9a4136e2d40289365ec7b9c9c878174b7c4332a22ca`
- live VPS: `7c62e820807bd3a681bdd9a4136e2d40289365ec7b9c9c878174b7c4332a22ca`

## Current UI Alignment

The current tracked UI source removes retired operator controls and keeps the retained subset that matches the live `UserModeHook` control contract through the `MeshAgent` operator layer.

Removed from the UI surface:

- `getInjectionState`
- `disable`
- `disableAll`
- `setFlags`

Kept in the current UI:

- `status --service`
- `listProcesses`
- `getFlowContract`
- `getCapabilities`
- `safetyState`
- `profileProcess`
- `methodPolicy`
- `securityBoundary`
- `inject`
- `injectAll`
- `clearTargetScope`
- `lockdownBypass`
- `examsoftBypass`
- `ipcBypass`

No dedicated `uiSnapshot` button is currently exposed in the MeshCentral UI.

## Live Core Publication Inventory

Current live UMH-relevant core inventory:

| Live Path | SHA256 | `umhctl` |
|---|---|---|
| `/opt/meshcentral/meshcentral-data/meshcore.js` | `30e9a91b9985f1004bfe4861c6db6ecddbf198a999a72c075793ef3d66754a4f` | yes |
| `/opt/meshcentral/node_modules/meshcentral/agents/meshcore.js` | `97394dd5e24afc39cec91710f4612584ee3f3b76aa6de138f13fc6412b15d194` | yes |
| `/opt/meshcentral/node_modules/meshcentral/agents/meshcore.min.js` | `518145e9fbcdfb5c7d8eb756c3ab3ccb94956de645ff9132907c9cfdc115c9a3` | yes |
| `/opt/meshcentral/node_modules/meshcentral/agents/recoverycore.js` | `6a3a88885e27e630d1d7e0edc320990bc9bc25af18345fe2c1f2fc1f29907cca` | yes |
| `/opt/meshcentral/node_modules/meshcentral/agents/meshcore_diagnostic.js` | `87c55517a3b50966508d9be03135633d67c40be708b6f9114ceebc764bde3845` | yes |
| `/opt/meshcentral/node_modules/meshcentral/agents/tinycore.js` | `396e05d2c3559c0740ded904b96da32f6af36f3f80925316fcf3819dd67c674b` | yes |

Current live shared `umhctl` publication copies:

| Live Path | SHA256 |
|---|---|
| `/opt/meshcentral/node_modules/meshcentral/agents/modules_meshcore/umhctl.js` | `2ce2353fbd72214b0951e6487e39d80bd84c8559e4b821809c24e6c267e37322` |
| `/opt/meshcentral/node_modules/meshcentral/agents/modules_meshcore_min/umhctl.js` | `2ce2353fbd72214b0951e6487e39d80bd84c8559e4b821809c24e6c267e37322` |
| `/opt/meshcentral/meshcentral-data/modules_meshcore/umhctl.js` | `2ce2353fbd72214b0951e6487e39d80bd84c8559e4b821809c24e6c267e37322` |
| `/opt/meshcentral/meshcentral-data/modules_meshcore_min/umhctl.js` | `2ce2353fbd72214b0951e6487e39d80bd84c8559e4b821809c24e6c267e37322` |

## Deploy and Validation Conditions

Any UMH UI or publication change in this repo is incomplete until:

1. the local repo copy is updated
2. the sister-repo SSOT/ledger docs are updated
3. the live override file and any changed core publication copies on the MeshCentral VPS are republished
4. live hashes are re-read from the VPS
5. a live canary exercises the changed surface

Current recorded canary conditions:

- requested node from the operator URL: `Sal`
- `Sal` was offline during the 2026-04-14 live validation tranche
- representative live validation used `DESKTOP-TONBSMQ`
- current expected `uiSnapshot partial=true` reason on a healthy canary is `config not found` from `C:\ProgramData\UserModeHook\config.json`

## MasterService Publication Contract

Current live install payload:

- VPS path: `/opt/meshcentral/meshcentral-files/domain/user-hsadmin/Public/MasterService.exe`
- public URL: `https://high.support/userfiles/hsadmin/MasterService.exe?download=1`
- live hash: `2fa49647a68116ff89e10058f5c67b847989a74d5adea6c72c6a967f4db51482`

Behavioral contract changes to the operator layer still originate in `MeshAgent/modules/umhctl.js` and `MeshAgent/modules/RecoveryCore.js`. MeshCentral owns the live publication copies and must not claim rollout completion until the published hashes are re-read from the VPS.
