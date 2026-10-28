# Native runtime viewer control

This MeshCentral plugin, part of the MeshCentral fork (based on 1.3.1), provides elevated process lifecycle management
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

## Installation

MeshCentral loads plugins only from its data directory: `pluginHandler.js` requires
`<datapath>/plugins/<shortName>/<shortName>.js` for each name in
`settings.plugins.list` when `settings.plugins.enabled` is true. The package does
not include `plugins/` (see the `files` list in `package.json`), so this directory
must be placed at `<datapath>/plugins/nativeruntime`, with `nativeruntime` in
`settings.plugins.list`, as `deploy/meshcentral-data/config.json.template` does.
Restart MeshCentral after enabling the plugin.

The plugin serves its viewer client at `plugin/nativeruntime/client.js` under each
domain. The deployment's `public/scripts/custom.js` loads that client into the
desktop viewers; the views have no plugin slot of their own.

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
the agent request. The agent returns one endpoint record per controller
(`controllers.x86` and `controllers.x64`); MeshCentral derives the running status from
their `flags` and the health from their transport results, and ignores any other shape. Responses from other connections or with mismatched
IDs/operations are ignored. Timeout means unknown and a mutation is never automatically
repeated; the client uses a fresh read-only status query to reconcile an unknown
mutation outcome. The visible viewer also refreshes status every ten seconds so newly
started or stopped processes are reflected without a page reload.

## Verification

Run `node --test tests/native-runtime.test.js` in `deploy/` (the test is
`deploy/tests/native-runtime.test.js`). It exercises request correlation, duplicate
clicks, process lifecycle state transitions, live share control/expiry/revocation, and
DOM insertion for all five viewer shapes. MeshAgent's
`test/meshcentral_nativeruntime_plugin_contract.js` checks the status shape against the
agent's runtime binding and the plugin object MeshCentral loads. Neither replaces a
real Windows integration test.
