# Native runtime viewer control

This local MeshCentral 1.2.1 extension adds one stateful Activate/Unload control.
It follows RDP Connect in the classic and modern full desktop viewers and follows
Connect in mobile and guest-share viewers, where RDP Connect is not present. The
two mobile templates use `connectbutton1`; the other three use
`connectbutton1span`.

Activate enables the controller and activates the runtime for eligible targets.
The enabled state remains armed when no eligible process is currently running,
and the viewer offers Unload in that state. Unload means cooperative
deactivation to pass-through while the component remains resident; it never
requests `FreeLibrary` or another physical detach. A controller
`restartRequired` flag is reported as a warning that earlier effects were not
fully restored. It does not prevent a later Activate action. Detailed status is exposed by
the control tooltip and accessible live status instead of a wrapping toolbar
label. The control follows the currently visible Connect or Disconnect group so
starting and stopping KVM does not leave it behind as the first toolbar item.

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
can see status but cannot use Activate or Unload.

Requests use `nativeRuntime` v1 with a UUID and operation `getStatus`, `load` or
`unload`. The browser includes the last relay epoch and generation with a state
change; MeshCentral verifies them, serializes mutations per node, and forwards
only the four-field agent request. The online agent returns the exact x86/x64
controller transport, result, flag and count records. MeshCentral validates and
aggregates those records without inventing capabilities or policy. Responses
from other connections or with mismatched IDs/operations are ignored. Timeout
means unknown and a mutation is never automatically repeated; the client uses a
fresh read-only status query to reconcile an unknown mutation outcome. A
successful mutation or initial status that reports `operationPending` is
followed by four bounded status-only polls. The visible viewer also refreshes
status every ten seconds so the relay's mutation baseline stays fresh and newly
started or exited eligible processes are reflected without a page reload. If an
operation is still pending, the same control becomes a manual Retry Status
action. A state-changing click whose local status is already twelve seconds old
first refreshes that read-only baseline, then submits the requested change once
only if it is still the valid next operation.

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
