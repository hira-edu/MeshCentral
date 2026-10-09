# Native runtime viewer control

This local MeshCentral 1.2.1 extension adds one stateful Load/Unload control
beside Connect in classic, modern and mobile viewers, including both guest-share
viewers. The two mobile templates use `connectbutton1`; the other three use
`connectbutton1span`.

Load activates the runtime for eligible targets. Unload means cooperative
deactivation to pass-through while the component remains resident; it never
requests `FreeLibrary` or another physical detach. A controller
`restartRequired` flag is displayed as a warning that earlier effects were not
fully restored. It does not prevent a later Load. Any confirmed, settled,
controllable snapshot without active targets offers Load, including zero-target
snapshots after an earlier target exits.

## Local installation

Use the lockfile's MeshCentral 1.2.1 (`npm ci`). The local setup scripts stage
the tracked plugins under `meshcentral-data/plugins`, and the Docker configuration
mounts the same plugin source at that data-path location read-only. Custom deployments
must likewise place this directory at `meshcentral-data/plugins/nativeruntime` and merge
`nativeruntime` into `settings.plugins.list` with `settings.plugins.enabled` true.
The tracked `public/scripts/custom.js` loads the plugin-served client. Local setup
stages that partial override under `meshcentral-data/public`; Docker mounts it
read-only at the same data-relative path. The template's `WebPublicPath` selects
the override, while missing assets fall through to MeshCentral's built-in public
directory. Restart the staged server after enabling the plugin. No running
service or configuration was changed by this implementation. Both npm and Docker
deployments are pinned and contract-tested against MeshCentral 1.2.1.

Access requires either a live authenticated session with current desktop rights
or a live desktop guest-share grant. Every query and mutation rechecks the node,
domain, account or share record, share window and revocation state. Guest
requests derive the node from their signed cookie and database record. There is
no separate plugin mutation ACL or policy/capability layer. Remote-view-only
accounts, view-only guest shares, and domains with `desktop.viewonly` enabled
can see status but cannot send Load or Unload.

Requests use `nativeRuntime` v1 with a UUID and operation `getStatus`, `load` or
`unload`. The browser includes the last relay epoch and generation with a state
change; MeshCentral verifies them, serializes mutations per node, and forwards
only the four-field agent request. The online agent returns the exact x86/x64
controller transport, result, flag and count records. MeshCentral validates and
aggregates those records without inventing capabilities or policy. Responses
from other connections or with mismatched IDs/operations are ignored. Timeout
means unknown and a mutation is never automatically repeated; the client uses a
fresh read-only status query to reconcile an unknown mutation outcome. A
successful mutation that reports `operationPending` is followed by four bounded
status-only polls. If it is still pending, the same control becomes a manual
Retry Status action.

Controller `result` is the bounded protocol enum: accepted, invalid message,
unsupported version, unsupported command or persistence failure. `lastError`
carries any Win32 reconciliation error; neither field is treated as free-form
display text.

## Verification

Run `node --test tests/native-runtime.test.js` from the repository root. Tests
exercise request correlation, duplicate clicks, relay generation checks,
controller-state validation, live share control/expiry/revocation, and DOM
insertion for all five viewer shapes. They do not replace a real Windows
integration test. No live target or deployment was modified by the tests.
Set `MESHCENTRAL_SOURCE` to a read-only unpacked MeshCentral 1.2.1 package to also
verify the actual five template anchors and shared script inclusion.
