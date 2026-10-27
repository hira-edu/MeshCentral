# Native runtime viewer control

This local MeshCentral 1.2.1 extension provides elevated process lifecycle management
and runtime controls for desktop viewers through one stateful Activate/Unload control.
It follows RDP Connect in the classic and modern full desktop viewers and follows
Connect in mobile and guest-share viewers, where RDP Connect is not present. The
two mobile templates use `connectbutton1`; the other three use
`connectbutton1span`.

Activate starts the runtime binary with elevated permissions.
When the runtime binary is running, the viewer displays an active status and offers
an Unload action to stop the elevated runtime binary. The control follows the
currently visible Connect or Disconnect group so starting and stopping KVM does
not leave it behind as the first toolbar item.

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
can see status but cannot mutate runtime state.

Requests use `nativeRuntime` v1 with a UUID and operations `getStatus`, `start`,
`stop`, `load`, or `unload`. MeshCentral verifies request validity, maps `start`
and `stop` aliases to agent operations, serializes mutations per node, and forwards
the agent request. The agent returns endpoint records from which MeshCentral
synthesizes runtime execution and running status. Responses from other connections or with mismatched
IDs/operations are ignored. Timeout means unknown and a mutation is never automatically
repeated; the client uses a fresh read-only status query to reconcile an unknown
mutation outcome. The visible viewer also refreshes status every ten seconds so newly
started or stopped processes are reflected without a page reload.

## Verification

Run `node --test tests/native-runtime.test.js` from the repository root. Tests
exercise request correlation, duplicate clicks, process lifecycle state transitions,
live share control/expiry/revocation, and DOM insertion for all five viewer shapes.
They do not replace a real Windows integration test. No live target or deployment
was modified by the tests. Set `MESHCENTRAL_SOURCE` to a read-only unpacked
MeshCentral 1.2.1 package to also verify the actual five template anchors and
shared script inclusion.
