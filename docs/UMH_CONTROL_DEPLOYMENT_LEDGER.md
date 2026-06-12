# MeshCentral UMH Control Deployment Ledger

Last Updated: 2026-06-12
Owner: Codex + User
Status: Active deployment ledger for the MeshCentral UMH UI override and live core publication inventory

## 2026-06-12 7c1f Watcher-Fallback Payload Pin Sync

- Trigger: UserModeHook published a new single `MasterService.exe` payload for the UnifiedAgent WMI-denied Toolhelp polling fallback fix. The live VPS UI was updated by the publish script to the new pin; tracked `public/scripts/custom.js` was updated to prevent source drift on future publishes.
- Source fix:
  - `public/scripts/custom.js` now pins `UMH_MASTER_SERVICE_SHA384` to `7c1f739c986fbee28d5d075b639b9821f889a8a03d4ee46f9eea6a80493730cdf44e19e3be9d09e8ee157e803123fd30`.
  - Install-button contract remains method-scoped and target-dynamic: `umhctl install --url <MasterService.exe?sha384=...> --pin <sha384> --method-key <method>`.
  - No install-time browser lock, target allowlist, method fallback, or method remap was added.
- Local validation:
  - `node --check public\scripts\custom.js`: passed.
  - `git diff --check -- public/scripts/custom.js`: passed with CRLF warning only.
- Source control:
  - MeshCentral commit `e9e830611a9df956abcf9370009958ea49cb0bd3` (`Update UMH payload pin to 7c1f`) pushed to `origin/main`.
- Final UserModeHook publish evidence:
  - Manifest `artifacts\vps_single_payload_20260612_200103\single_payload_manifest.json`.
  - Manifest provenance: UserModeHook `f6f14a65fbd23fc8bda39ec0bdeb8dc873fcda63`, MeshAgent `baed29f4f2da8e07418a4e44c8f624e2546d22ce`, MeshCentral `e9e830611a9df956abcf9370009958ea49cb0bd3`.
  - Public `custom.js`: `https://high.support/scripts/custom.js?verify=watcher_fix_final`, size `39403`, SHA256 `6012f2376ee8d4cf0f89eaea03e501f06686152dabced6d002646ae179bae394`, pin `7c1f739c986fbee28d5d075b639b9821f889a8a03d4ee46f9eea6a80493730cdf44e19e3be9d09e8ee157e803123fd30`.
  - Public payload URL: `https://high.support/userfiles/hsadmin/MasterService.exe?download=1&sha384=7c1f739c986fbee28d5d075b639b9821f889a8a03d4ee46f9eea6a80493730cdf44e19e3be9d09e8ee157e803123fd30`.
  - Payload size `18857472`, SHA256 `dd9535f424aa556be0e863056a58789842023664bdc1026cad256deb4842b6be`, SHA384 `7c1f739c986fbee28d5d075b639b9821f889a8a03d4ee46f9eea6a80493730cdf44e19e3be9d09e8ee157e803123fd30`.
- Endpoint status: install still pending on the observed host; last checked `AdvancedHookService` and install contract remained pinned to `6fce33ff...`.
- Status: `SOURCE_AND_LIVE_PIN_SYNCED_TO_7C1F_ENDPOINT_INSTALL_PENDING`.

## 2026-06-12 d27 Agent Module Source Sync

- Trigger: live VPS `umhctl.js` core publication copies already carried the current MeshAgent installer module SHA256 `75b8e10b9e3ed8406fae39b5e1cae7e7eae4a7a51b2e449ff8abb0b6e288178f`, but the tracked MeshCentral `agents/modules_meshcore/umhctl.js` and `agents/modules_meshcore_min/umhctl.js` source copies still carried older SHA256 `d3bd8bec741ac208d4a773c79d455a079825e1b81ce9e2b63e967bff45336a16`.
- Source fix: synced both tracked MeshCentral module copies from `C:\Users\Workstation\Documents\GitHub\MeshAgent\modules\umhctl.js` so source now includes:
  - Schoolyear target aliases.
  - stale lifecycle lock expiry for stuck `install` / `uninstall` operations.
  - robust ProgramData resolution.
  - install-contract write fallback for the legacy file API shape.
  - install-pending ownership detection that avoids rolling back when Service Control Manager already owns the new `MasterService.exe`.
  - explicit `target_scope=runtime_profile_dynamic` install-contract log text.
- Local validation:
  - `node --check agents\modules_meshcore\umhctl.js`: passed.
  - `node --check agents\modules_meshcore_min\umhctl.js`: passed.
  - `node --check meshcentral-data\modules_meshcore\umhctl.js`: passed.
  - `node --check meshcentral-data\modules_meshcore_min\umhctl.js`: passed.
  - `git diff --check -- agents/modules_meshcore/umhctl.js agents/modules_meshcore_min/umhctl.js meshcentral-data/modules_meshcore/umhctl.js meshcentral-data/modules_meshcore_min/umhctl.js`: passed with CRLF warnings only.
- Live VPS verification:
  - `/opt/meshcentral/node_modules/meshcentral/agents/modules_meshcore/umhctl.js`: SHA256 `75b8e10b9e3ed8406fae39b5e1cae7e7eae4a7a51b2e449ff8abb0b6e288178f`.
  - `/opt/meshcentral/node_modules/meshcentral/agents/modules_meshcore_min/umhctl.js`: SHA256 `75b8e10b9e3ed8406fae39b5e1cae7e7eae4a7a51b2e449ff8abb0b6e288178f`.
  - `/opt/meshcentral/meshcentral-data/modules_meshcore/umhctl.js`: SHA256 `75b8e10b9e3ed8406fae39b5e1cae7e7eae4a7a51b2e449ff8abb0b6e288178f`.
  - `/opt/meshcentral/meshcentral-data/modules_meshcore_min/umhctl.js`: SHA256 `75b8e10b9e3ed8406fae39b5e1cae7e7eae4a7a51b2e449ff8abb0b6e288178f`.
  - `meshcentral` service: `ActiveState=active`, `NRestarts=0`.
  - `https://high.support/scripts/custom.js?verify=module_source_sync_check`: HTTP 200, size `39403`, SHA256 `9d9e785d7b9c93ca49ca288885d6a8aea7dc344c0c522cb1945fcbf2624db27d`, pin `d27d4a37cd04f84c8b2e994f8a85f3af73cb76a9c7d0571855d54fc112086940684288e0fcf53dc2d44949acda5b8525`.
- Install-button contract remains method-scoped and target-dynamic. This sync does not add an install-time browser lock, target allowlist, method fallback, or method remap.
- Status: `SOURCE_SYNCED_TO_LIVE_D27_MODULES_ENDPOINT_INSTALL_STILL_PENDING`.

## 2026-06-12 cf34 Single-Payload Source Sync (current)

- Trigger: live VPS and public `custom.js` already exposed the current section-backed ManualMap payload pin, but the tracked `public/scripts/custom.js` source still carried stale SHA-384 `036124dd9774dc4896df825d7424418744ccc78f0ecd01f90e4832eb3ce3c5bee453751329fdf71f61ff727ce0f935a6`. That source drift could cause a future UI publication to point install buttons back at an old payload.
- Source fix: `public/scripts/custom.js` now pins the single shared `MasterService.exe` payload to SHA-384 `cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`.
- Install-button contract remains method-scoped and target-dynamic: lifecycle buttons emit `umhctl install --url <MasterService.exe?sha384=...> --pin <sha384> --method-key <method>`. No install-time `target_tag`, per-browser install lock, fallback order, remap behavior, or runtime browser allowlist was introduced.
- Local validation:
  - `node --check public\scripts\custom.js`: passed.
  - UserModeHook deploy contract validation passed: `pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-UmhSinglePayloadToVps.ps1 -SkipBuild -ValidateOnly -PrebuiltPayloadPath .\build\bin\Release\MasterService.exe`.
- Local source hash after sync: `d9e3463b47123cb692a75d78d8d8449444fb24983d732637819d56c4fdc5a0c5`.
- Live VPS evidence re-read on 2026-06-12:
  - `/opt/meshcentral/node_modules/meshcentral/public/scripts/custom.js`: SHA256 `6df687676cd654f2750fd8c4d48b1cf4904c27b5c1f24c74d62161a624d5db24`, pin `cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`.
  - `/opt/meshcentral/meshcentral-web/public/scripts/custom.js`: SHA256 `6df687676cd654f2750fd8c4d48b1cf4904c27b5c1f24c74d62161a624d5db24`, pin `cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`.
  - `/opt/meshcentral/meshcentral-files/domain/user-hsadmin/Public/MasterService.exe`: SHA384 `cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`.
  - `meshcentral` service state: `active`, `NRestarts=0`.
- Public evidence:
  - `https://high.support/scripts/custom.js?verify=20260612_cf34_source_sync`: SHA256 `6df687676cd654f2750fd8c4d48b1cf4904c27b5c1f24c74d62161a624d5db24`, size `39404`, pin `cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`.
  - `https://high.support/userfiles/hsadmin/MasterService.exe?download=1&sha384=cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`: HTTP 200, size `18817024`, SHA256 `eee1cca8269936daf075a88f232288b546a04f4c6617b6480a9349fd527c38cc`, SHA384 `cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`.
- Git provenance at source-sync time:
  - MeshCentral base `62adcfb7c7004f6869630811ea72dd6a26ef1bad`.
  - MeshAgent `baed29f4f2da8e07418a4e44c8f624e2546d22ce`.
  - UserModeHook `b5ca102d4dbafd6d8765aaeb79329f7eb2a50f34`.
- Status: `SOURCE_SYNCED_TO_LIVE_CF34_PENDING_SCHOOLYEAR_RUNTIME_EVIDENCE`.

## 2026-05-04 MasterService Publish (historical)

- VPS: `74.208.52.191` (SSH reachable; the 2026-04-19 timeout is resolved)
- local source: `C:\Users\Workstation\Documents\GitHub\UserModeHook\build\bin\Release\MasterService.exe`
- local source size: `17693184`
- local source SHA256: `4920d9ab9fc09e8e5a2f2e82437e40d444000bc07ff1d2d0d3d779c61f5d9517`
- live VPS path: `/opt/meshcentral/meshcentral-files/domain/user-hsadmin/Public/MasterService.exe`
- live VPS size: `17693184`
- live VPS SHA256 (re-read after publish): `4920d9ab9fc09e8e5a2f2e82437e40d444000bc07ff1d2d0d3d779c61f5d9517`
- public URL re-fetch hash: `4920d9ab9fc09e8e5a2f2e82437e40d444000bc07ff1d2d0d3d779c61f5d9517`
- public URL response: `HTTP/2 200`, `content-length: 17693184`, `cache-control: no-store`, `cf-cache-status: BYPASS`
- prior live binary preserved on VPS as `/opt/meshcentral/meshcentral-files/domain/user-hsadmin/Public/MasterService.exe.bak.20260504_204933Z` (SHA256 `cbd42fcbcc857ca61effc23a8e0195a10a2705e74d64dc712ea7ec26273fcf49`, size `18011648`, mtime `2026-04-20 10:07`)
- deployment status: published
- ownership: `root:root`, `0644` (matches prior convention on this path)

## 2026-04-19 VPS Move / MasterService Publish (historical)

- operator-designated replacement MeshCentral VPS IP: `74.208.52.191`
- recorded local publish candidate at the time: `C:\Users\Workstation\Documents\GitHub\UserModeHook\build-fresh\bin\Release\MasterService.exe` (SHA256 `2324961d0d5ca5df82d43118524f39ae3d3752804bf5757729c2fb526e5ffeb3`, size `17749504`); this `build-fresh` artifact is no longer present locally and was never published
- deployment status at the time: blocked pending SSH reachability; direct SSH to `74.208.52.191:22` timed out on 2026-04-19
- between 2026-04-19 and 2026-05-04 a non-ledgered publish landed on the VPS (live mtime `2026-04-20 10:07`, SHA256 `cbd42fcbcc857ca61effc23a8e0195a10a2705e74d64dc712ea7ec26273fcf49`, size `18011648`); this superseded the prior recorded live hash `2fa49647a68116ff89e10058f5c67b847989a74d5adea6c72c6a967f4db51482` without a ledger entry. The 2026-05-04 publish replaces it.

## Live Override Path

Current deployed UI override path:

- `/opt/meshcentral/meshcentral-web/public/scripts/custom.js`

Current local source path:

- `C:\Users\Workstation\Documents\GitHub\MeshCentral\public\scripts\custom.js`

Current `custom.js` hash:

- local source: `d9e3463b47123cb692a75d78d8d8449444fb24983d732637819d56c4fdc5a0c5`
- live VPS/public deployed copy: `6df687676cd654f2750fd8c4d48b1cf4904c27b5c1f24c74d62161a624d5db24`
- active payload pin: `cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`

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
- live SHA256: `eee1cca8269936daf075a88f232288b546a04f4c6617b6480a9349fd527c38cc`
- live SHA384 / install pin: `cf34f3933c1b5a683704cf78f237684ed500067bd098c962d1c0689c990de12fe1706a31b3c4769d06afff2babd2268d`
- live size: `18817024`
- prior live hash (preserved on VPS as `MasterService.exe.bak.20260504_204933Z`): `cbd42fcbcc857ca61effc23a8e0195a10a2705e74d64dc712ea7ec26273fcf49`

Behavioral contract changes to the operator layer still originate in `MeshAgent/modules/umhctl.js` and `MeshAgent/modules/RecoveryCore.js`. MeshCentral owns the live publication copies and must not claim rollout completion until the published hashes are re-read from the VPS.
