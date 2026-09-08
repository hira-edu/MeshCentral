# Server Setup SSOT

Date: April 13, 2026
Repo: `C:\Users\Workstation\Documents\GitHub\MeshCentral`

Last full runtime reconciliation: July 26, 2026. Desktop multiplexing and backup
permissions rechecked September 8, 2026 as described below.

## Desktop multiplexing and backup corrections

Current state, September 8 at 12:49:50 UTC (Windows clock): the server relay
corrections below remain active, and the native repairs were deployed to Umair
alone. Its `WinDiagnosticHost` service remained Running as PID 13936 from
12:29:58 UTC, with no subsequent service-failure events. The installed
`diaghost.exe` SHA-256 is
`204b22948b311e80a5fc4484b586af7df27b8bf3ba617b7cd08f7bc887b8f347`;
`diagsvc.dll` is
`caa63f1fdebf189da901540388efd3da00d5ad10b16d6dfa19268a1f05b17f80`.
The preserved checkpoint shows 939.053 seconds of uninterrupted primary
traffic, 40,156,441 bytes delivered, 15 matched heartbeat rounds on viewer
and agent transports, and five successful secondary reconnects with fresh
images. The primary ultimately ran 956.998 seconds and received 41,033,471 bytes
before its deliberate UI disconnect. A subsequent fresh viewer pair each
received over 4 MB and completed
a heartbeat round. No native fatal or stream gap was captured; kernel packet
drops were zero and native `validate-update` passed. The debugger, collectors
and diagnostic tabs were closed. An unrelated viewer was preserved, so this
does not claim a complete shared-capture teardown or explain every past freeze.

Umair retains the native `disableUpdate=1` hold. The first successful canary
activation at 12:18:57 UTC was replaced by normal automatic update because this
server still publishes the older native package. The final binary-only update
began at 12:29:26 UTC and completed in 33.038 seconds after the scoped hold was
configured. The installed `.msh` and `.conf` retain their original contents plus
an audit comment and this setting. The bare datastore key was originally absent;
post-start readback found `1`, and native `require('MeshAgent').updatesEnabled`
was false. No server package replacement or broad agent deployment occurred.
This is a hold on Umair's native binary, not a per-node exact-version pin or a
meshcore update hold. Reenabling native updates while the older package remains
published will replace the fixes again.

Console `dbset` wrote `0/disableUpdate` in the script namespace and was ineffective;
that key was removed. Native restoration must explicitly delete the bare key
through configuration import, since restoring files that omit the setting does
not remove its persisted value. Once the intended package distribution is ready,
restore the original config contents with a temporary empty `disableUpdate=`
line for an authorized native lifecycle start to import, remove that line after
import, and verify original config hashes, bare-key absence and
`updatesEnabled=true`. This restoration has not been performed; the hold remains
active. MeshAgent's `docs/DEPLOYMENT.md` records the backup and evidence locations.
Its ignored `native-canary-config-before-hold` backups and
`native-canary-config-hold.json` preserve the original state; binary rollback
sets are separate. No built-in per-node exact-version pin was found in the
inspected installed MeshCentral 1.2.5 automatic-update path. The supported
server `noAgentUpdate` option and binary-table overrides have broader scope and
were not changed.

Relay timestamps originate on the VPS; native and SCM timestamps originate on
Windows. At 12:45 UTC a read-only comparison bounded the VPS clock 14.143–17.341
seconds ahead. Trace durations use a single clock; cross-host timestamps below
must not be interpreted as synchronized causal-delay measurements.

The September 8 desktop investigation verified `desktopmultiplex=true` on the
VPS. The live multiplexer and the local source both missed backpressure updates
on viewer membership changes. A new healthy viewer could leave the agent socket
paused during startup or a screen reset before the picture cache refilled;
removing the fastest viewer could leave the remaining overloaded viewers without
backpressure. The local source now reevaluates both transitions and preserves
the recording-write pause. It also rejects an invalid decoded relay cookie
without dereferencing null; this cookie guard was already present on the VPS.

The live two-viewer check also exposed a pre-existing disconnect defect:
closing viewers synchronously splices the array being iterated, skipping peers
that then retain a stale image while still appearing connected. Agent teardown
now iterates a snapshot and uses each viewer's existing close/audit path.
Deterministic cases cover two, three and four viewers; the real WebSocket test
also verifies that every viewer socket closes on agent disconnection.

Relay tracing confirmed a third defect: `performRelay()` ignored `addPeer()`
rejecting a duplicate agent, leaving the unregistered socket and timers open.
Both admission paths now close a rejected relay through the existing cleanup
method. Regression coverage verifies the rejected socket closes while the
original agent and viewers remain registered.

The live multiplexer has unrelated differences from this checkout. A candidate
containing only these three deltas is staged at
`/opt/meshcentral/staging/desktop-stall-20260908/meshdesktopmultiplex.js` and passed
the MeshAgent `meshcentral_multiplex_flow_control_runtime.js` and
`meshcentral_multiplex_socket_runtime.js` regressions under the VPS service user.
Following operator authorization, the flow-control delta was activated on
September 8 at 08:35:27 UTC. The viewer snapshot fix was activated at 08:50:13
UTC and explicit duplicate rejection cleanup at 09:10:12 UTC. The missing
in-flight input-send flag and incorrect queue-length comparison were separately
reproduced and corrected at 11:12:59 UTC. Four MeshCentral restarts occurred.
The active module SHA-256 is
`66baaf88c5b75c344fc3c8eaf36bb6bd9ac8c82063627b4a5c91613d1b28b395`.
The preceding module is backed up in
`/opt/meshcentral/backups/desktop-flow-20260908_111259`.
Input writes now queue behind one outstanding send and pause viewers above ten
queued commands. All nine behavioral tests and the real-socket regression
passed against the active module as the service user.
The exact previous module and activation metadata are in
`/opt/meshcentral/backups/desktop-flow-20260908_083527`; restore its module to
the live path with the original `root:root 0644` ownership/mode and restart to
roll back. Startup, authenticated admin reload, agent reconnection, and the
loopback regression using the HTTP server's nested `ws` 7.5.13 dependency passed.
The intermediate flow-control-only version is backed up separately in
`/opt/meshcentral/backups/desktop-flow-20260908_085013`.
The intermediate flow-control and viewer-snapshot version is in
`/opt/meshcentral/backups/desktop-flow-20260908_091012`.
No agent rollout was included. Rohit's historical overlapping sessions were
found, but its individual freeze cannot be attributed conclusively while the
device is offline and no failure trace exists.
The operator selected Umair alone for live validation; Rohit's availability
is not a deployment or completion prerequisite.

A later live run on Umair retained the same agent tunnel through a third viewer
joining/leaving and two controlled secondary-viewer reconnects. A passive trace
captured over 30 MB of continuing traffic and six successful 60-second ping/pong
exchanges; browser checks passed seven minutes. Earlier sessions had closed
after three to four minutes, including one after the final activation. Their
initial causes were not visible in those short traces. The later session also
closed after 480 seconds, after the short trace stopped. An extended trace
captured a native service fatal exit at 09:57:03 UTC, followed by the agent-side
TCP close at 09:57:55 and then both viewer closes. Over 96 MB and repeated
successful heartbeats preceded that failure. The seven-minute check is not an
uninterrupted final validation. Keepalive and cookie configuration were not
changed.

Windows SCM event 7031 and the native service's own `diaghost.log` subsequently
confirmed six unexpected agent terminations during these checks. The log
records Duktape `uncaught: 'invalid base value'` and its fatal handler exits with
254. Existing service recovery restarts it after 10 seconds. The `power`
collection confirms the associated connectivity loss/recovery. Locating the
invalid native access required a stack capture before native deployment.
After the initial elevation cancellation, the resumed elevated debugger
captured the fatal path at 10:55:46 UTC and detached. A worker command ran before
initialization; its error-reporting path accessed the missing `process` object
through `EventEmitter_GetEmitter` and `duk_has_prop`. Local early-execution
tests reproduce the fatal message and exit 254, while the `ready` control
reports the script error normally. MeshAgent now queues INIT before publishing
the worker, preserves earlier commands in FIFO order, and assigns permissions
before starting its thread. All nine startup runtime cases pass, including
permission enforcement, ordered messages, early exit and post-exit calls.
DLL/full-package builds, embedded-payload parity and capture tests pass; the
native changes are included in the validated Umair canary recorded above.
The prepared native canary uses the live agent's reported commit
`0fb268971e670b09a89f977f727336a91328f0ea` and retains its existing endpoint and
provisioning. It also includes the existing stack-allocation alignment fix,
after reproducing an HTTP request stack overwrite on that older revision.
The exact canary passes nine worker startup cases, eight HTTP path lengths,
61 capture connections, DLL first-frame capture and embedded payload parity.
Windows canceled the first elevation request at 11:43:14 UTC. After renewed
operator authorization, elevated read-only package validation passed at
12:00:12 UTC with service PID 33116 unchanged. That package was superseded by further
proven native lifecycle corrections: exit callbacks could free their parent
before native dispatch finished, and every worker leaked three Windows handles.
The revised code retains the parent through dispatch and releases the worker
thread, chain thread and watchdog event at their ownership boundaries. Cleanup
joins the watchdog before freeing its chain. The 45-cycle reproduction now
keeps handle counts flat (187/187/187 versus 202/262/322 before cleanup), and
startup/concurrency, callback release, capture, HTTP alignment and package
checks pass on x64. Startup/concurrency and lifecycle cases also pass on Win32
(205/205/205 handles after warmup). The immutable candidate is recorded in
MeshAgent's ignored `native-canary-lifecycle-package.json` evidence manifest.
The coordinated elevated task verified and activated the frozen revised
candidate (EXE SHA-256 prefix `204b2294`, DLL prefix `caa63f1f`) and performed
Umair's elevated preflight, update, local debugger and sustained two-viewer
validation. The source task retained builds/tests/docs ownership and checked
the final evidence before recording the current state above. Use the binary-only
transaction with an exact rollback set; do not combine it with a broad
publication or endpoint/certificate migration.
Separately, an isolated MeshConsole reproduction
proved a capture/refresh lock deadlock. The local MeshAgent patch moves the
transport wait outside the tile lock and abandons the scan on backpressure;
its capture-and-reconnect runtime test passes against the rebuilt binary and
fails against the original. That distinct console finding does not identify
the independently captured worker startup failure.

Nightly archives had failed on a root-only deployment snapshot directory since
July 22. The directory
`/opt/meshcentral/backups/meshagent-only-20260722_203928-d6ccd3ab` now has
`root:meshcentral 0750` permissions, preserving restricted access and granting
the backup service read/traverse access. Its 34 descendants were successfully
archived by the service account after this change. A full scheduled backup has
not yet been verified. Keep deployment snapshots readable by that account when
they are included in automatic backups; do not grant world access. Rollback of
this single-directory permission change is `root:root 0700`.

## 2026-07-26 Agent Relay Regression Evidence

- The first captured Files failure stopped at outbound TCP: the agent's new Cloudflare IPv6 flow remained in `SYN-SENT`. TLS, HTTP, WebSocket upgrade, and MeshCentral relay-pairing code were not reached.
- The behavior change is bounded to ignored MeshAgent provisioning state that changed `MeshServer` from the historical direct agent origin to the Cloudflare-backed `high.support:443` origin; ignored files have no attributable Git author or commit. The active destination-selection and relay route were compared with refreshed upstream refs (`MeshAgent` `ebff7fb7`, `MeshCentral` `9c872e94`) and contain no candidate-specific alternate destination or relay race. This does not claim that either full fork file is byte-for-byte upstream.
- The replacement candidate contains one endpoint, `wss://agents.high.support:443/agent.ashx`, with URL-derived Host/SNI and no IP fallback, race, proxy discovery, added retry, delay, TLS bypass, or hash allowlist.
- The public `agents.high.support:443` certificate validates, and 20 immediate sequential unauthenticated WebSocket upgrades plus peer-confirmed clean closes passed. That proves TLS, HTTP `101`, and WebSocket closure only; live MeshCentral correctly rejects the candidate agent command-1 certificate hash because it matches neither the current domain certificate nor the current default certificate.
- Live rollout is therefore blocked until the existing MeshCentral domain/default certificate contract safely overlaps already deployed `high.support` agents and new `agents.high.support` agents. `ignoreAgentHashCheck` remains `false`.
- No live certificate, Caddy route, package, service, or database was changed during this investigation. The local Caddy reference below was reconciled to the captured live file only.

Proven certificate acceptance matrix:

| State | Existing `high.support` agents | Candidate `agents.high.support` agents |
|---|---:|---:|
| Current domain + current default | accepted | rejected |
| Phase 1: current domain + `agents.high.support` default | accepted | accepted |
| Phase 2: `agents.high.support` domain + matching default | rejected | accepted |

Phase 1 replaces only the default `webserver-cert-public.crt` and
`webserver-cert-private.key` with the matching certificate/key currently used
by Caddy for `agents.high.support`; `certurl` remains `https://high.support/`.
After observed inventory proves migration is complete, phase 2 changes only
`certurl` to `https://agents.high.support/`. Each phase needs one MeshCentral
restart and explicit approval. The copied phase-1 certificate is a snapshot and
does not follow Caddy renewal, so phase 1 is temporary. No Caddy reload or route
change is required for this certificate migration.

## 2026-04-19 VPS Move Addendum
- operator-designated replacement SSH target: `meshcentral` -> `74.208.52.191`
- direct SSH probes to `74.208.52.191:22` from the workstation timed out on April 19, 2026, so any host/runtime facts not explicitly updated below remain the last successfully captured pre-migration values
- prior direct SSH targets `167.88.44.65` and `72.60.233.29:22` are historical only

## Evidence Sources
Authoritative local evidence used for this document:
- `meshcentral-data/config.json`
- `meshcentral-data/config.json.template`
- `meshcentral-data/meshcore.js`
- `public/scripts/custom.js`
- `infra/caddy/Caddyfile.live`
- `infra/nginx/meshcentral.conf`
- `scripts/remote/bootstrap.sh`
- `scripts/remote/diagnose.sh`
- `scripts/remote/sync-back.sh`
- `package.json`
- `readme.md`
- `server-backups/meshcentral-live-20260413-153810/etc/caddy/Caddyfile`
- `server-backups/meshcentral-live-20260413-153810/etc/cloudflared/config.yml`
- `server-backups/meshcentral-live-20260413-153810/systemd/meshcentral.service`
- `server-backups/meshcentral-live-20260413-153810/systemd/cloudflared.service`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-data/config.json`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-data/meshcore.js`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-web/public/scripts/custom.js`
- `server-backups/meshcentral-live-20260413-153810/db/collection-counts.txt`
- `server-backups/meshcentral-live-20260413-153810/db/meshcentral.archive.gz`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/cloudflared-version.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/tunnel-list.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/tunnel-info.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/cf-wrangler`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/vps-auth-scaffold.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/api-readiness.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/zone-summary.txt`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/zone-export/*`
- `server-backups/meshcentral-live-20260413-153810/cloudflare/*.json`
- `server-backups/meshcentral-live-20260413-153810/manifests/backup-manifest.json`

Non-authoritative or still blocked:
- `HISTORICAL_NOTE`: `72.60.233.29:22` and `167.88.44.65:22` are prior VPS endpoints. A July 26 capture succeeded against `74.208.52.191`; a later read-only recheck timed out, so no claim is made about changes after the successful capture.
- `PARTIAL_SCOPE`: the current token can read the zone, settings, page rules, firewall rules, and custom firewall phase, but some phase exports remain unauthorized.
- `UNVERIFIED_DASHBOARD`: dashboard-only settings not exposed by the current token/API surface are still not exported locally.

## Current Known Deployment Shape
### App Model
- Repo mode is a deployment wrapper around the `meshcentral` npm package, not a full upstream source checkout.
- Local package entrypoint points to `node_modules/meshcentral/meshcentral.js`.
- Local runtime state is stored in `meshcentral-data/`.

### Live Host Identity
Verified from direct SSH capture:
- reachable SSH target after the April 19, 2026 VPS move: `meshcentral` -> `74.208.52.191`
- previous direct SSH targets before the VPS move: `167.88.44.65`, `72.60.233.29:22`
- hostname: `srv1057130`
- OS: Ubuntu Linux `6.8.0-106-generic`
- application root: `/opt/meshcentral`
- primary service user: `meshcentral`

### Live Service State
Verified from direct SSH capture:
- `meshcentral`: `active`
- `caddy`: `active`
- `mongod`: `active`
- `nginx`: `inactive`
- `cloudflared`: active, with listener on `127.0.0.1:20241`

### Runtime Identity
Sanitized runtime settings from the July 26 live capture:
- domain certificate host: `high.support`
- default-domain certificate URL: `https://high.support/`
- ignore agent certificate-hash checks: `false`
- WAN only: `true`
- public alias port: `443`
- internal MeshCentral bind port: `4430`
- internal bind address: `127.0.0.1`
- redirect port: `0`
- TLS offload source: `127.0.0.1,::1`
- data path: `/opt/meshcentral/meshcentral-data`
- database mode: MongoDB on `127.0.0.1:27017/meshcentral`
- WebRTC: `false`
- desktop multiplex: `true`
- agent TLS on direct port: `false`
- allowed origins:
  - `high.support`
  - `agents.high.support`
  - `relay.high.support`
  - `cfrelay.high.support`
- UMH controls: `true`

### Database Model
Current live config indicates MongoDB, not NeDB.
- URI shape: `mongodb://<redacted-user>:<redacted-password>@127.0.0.1:27017/meshcentral`
- verified live collection counts on April 13, 2026:
  - `events:19766`
  - `meshcentral:1101`
  - `power:2682`
  - `serverstats:403`
- verified live dump captured locally:
  - `server-backups/meshcentral-live-20260413-153810/db/meshcentral.archive.gz`
  - size: `1177191` bytes
  - sha256: `a753116f4e8d2668e387c8ba8f6914242f97b537cabcc1fe6984a218769582c2`

## Edge Proxy and TLS
### Repo-Era Edge Evidence
The repo-managed edge documentation is Nginx-based.
Evidence:
- `infra/nginx/meshcentral.conf`
- `scripts/remote/bootstrap.sh`

This remains valid as wrapper-repo history, but it is not the live edge truth.

### Verified Live Caddy State
Verified from direct SSH capture:
- service unit: `/usr/lib/systemd/system/caddy.service`
- active config file: `/etc/caddy/Caddyfile`
- listeners:
  - `*:80`
  - `*:443`
  - `*:4445`
  - `*:4446`
  - admin/API on `127.0.0.1:2019`

Verified live Caddy behavior:
- `agents.high.support` and `relay.high.support` are handled by the public standard-port Caddy site block
- `high.support` and `cfrelay.high.support` enter through cloudflared and do not use that Caddy site block
- requests generally reverse proxy to `127.0.0.1:4430`
- `/api/v2/telemetry` is rewritten to `/agent.ashx`
- bare unauthenticated `GET /` serves a cover page from `/var/www/cover`
- explicit listeners:
  - `agents.high.support:4445` and `agents.high.support:4446`
  - `relay.high.support:4446`
- certificate files on the legacy agent listeners:
  - `/etc/caddy/tls/meshcentral-agent-tls.crt`
  - `/etc/caddy/tls/meshcentral-agent-tls.key`
- the legacy listeners remain migration compatibility state and are not present in new provisioning metadata

Tracked local reference:
- `infra/caddy/Caddyfile.live` is reconciled to the July 26 capture of `/etc/caddy/Caddyfile`

### Verified Live Cloudflared State
Verified from direct SSH capture and the VPS-resident `cloudflared` CLI:
- service unit: `/etc/systemd/system/cloudflared.service`
- config file: `/etc/cloudflared/config.yml`
- tunnel id: `3f1b39ec-103b-442d-aec1-8ab694c3dc69`
- tunnel name: `meshcentral`
- cloudflared version: `2026.3.0`
- connector architecture: `linux_amd64`
- connector origin IP: `74.208.52.191` (verified by the successful July 26 direct SSH capture; a later read-only recheck timed out)
- ingress:
  - `high.support` -> `http://127.0.0.1:4430`
  - `cfrelay.high.support` -> `http://127.0.0.1:4430`
  - fallback -> `http_status:404`

## Cloudflare Control SSOT
### Verified VPS Control Path
Verified through direct SSH on April 13, 2026:
- remote token bridge: `/root/.cloudflare-api.env`
- bridge permissions: `600 root:root`
- remote wrapper path: `/usr/local/bin/cf-wrangler`
- wrapper permissions: `700 root:root`
- wrapper runtime: `npx --yes wrangler 4.82.0`
- wrapper auth mode: user API token
- wrapper behavior: sources `/root/.cloudflare-api.env`, which bridges the runtime token source, and forces IPv4-first resolution via `NODE_OPTIONS=--dns-result-order=ipv4first`
- `cf-wrangler whoami` succeeds through the wrapper

### Verified Token Source
Verified through redacted inspection on April 13, 2026:
- token source file: `/opt/meshcentral/meshcentral-data/cloudflare.env`
- source variables present:
  - `CF_API_TOKEN`
  - `CF_ZONE_ID`
  - `CF_DOMAIN`
  - `CF_ACCOUNT_EMAIL`
- the source token file is not copied into the repo or local snapshot

### Verified Control Facts
- Cloudflare account id: `9a6ee225286d1177ed3de1e33a41323d`
- zone id: `34f290f59f968462eb8c637690d32e5e`
- zone name: `high.support`
- zone status: `active`
- zone type: `full`
- SSL setting: `strict`

### IPv6 / IPv4 Behavior
- direct zone API reads from the VPS default egress hit Cloudflare error `9109` and reference the VPS IPv6 address
- forcing IPv4 makes both zone reads and `cf-wrangler whoami` succeed
- `/usr/local/bin/cf-wrangler` now forces IPv4-first resolution by default

## Cloudflare Zone State
### Verified DNS Records
From live Cloudflare API export on April 13, 2026:
- `high.support` -> `3f1b39ec-103b-442d-aec1-8ab694c3dc69.cfargotunnel.com`, proxied `true`, type `CNAME`
- `cfrelay.high.support` -> `3f1b39ec-103b-442d-aec1-8ab694c3dc69.cfargotunnel.com`, proxied `true`, type `CNAME`
- `agents.high.support` -> `74.208.52.191`, proxied `false`, type `A` (operator-updated after the April 19, 2026 VPS move; Cloudflare export refresh pending)
- `relay.high.support` -> `74.208.52.191`, proxied `false`, type `A` (operator-updated after the April 19, 2026 VPS move; Cloudflare export refresh pending)
- `www.high.support` -> `high.support`, proxied `false`, type `CNAME`
- `_dmarc.high.support` -> DMARC TXT present
- `_domainconnect.high.support` -> domain connect CNAME present

### Verified Zone Settings
From live Cloudflare API export on April 13, 2026:
- `ssl`: `strict`
- `min_tls_version`: `1.2`
- `tls_1_3`: `on`
- `http3`: `on`
- `websockets`: `on`
- `always_use_https`: `on`
- `automatic_https_rewrites`: `on`
- `security_level`: `medium`
- `browser_check`: `on`
- `waf`: `off`
- `ipv6`: `on`
- `pseudo_ipv4`: `off`
- `opportunistic_encryption`: `on`
- `0rtt`: `off`
- `cache_level`: `aggressive`
- `browser_cache_ttl`: `0`

### Verified Page Rules
Two active page rules exist:
- priority `1`: `high.support/*.ashx*` -> `security_level=essentially_off`, `cache_level=bypass`
- priority `2`: `cfrelay.high.support/*.ashx*` -> `security_level=essentially_off`, `cache_level=bypass`

### Verified Firewall and Custom Rules
- legacy firewall rule exists: `Skip security features for MeshCentral proxied websocket and relay endpoints`
- filter expression:
  - `((http.host eq "high.support" and http.request.uri.path in {"/agent.ashx" "/control.ashx"}) or (http.host eq "cfrelay.high.support" and http.request.uri.path in {"/control-redirect.ashx" "/meshrelay.ashx"}))`
- the `http_request_firewall_custom` phase contains the same enabled `skip` rule

### Phase Export Status
- `http_request_firewall_custom`: exported successfully
- `http_ratelimit`: no entrypoint ruleset present
- `http_request_late_transform`: no entrypoint ruleset present
- `http_request_transform`: no entrypoint ruleset present
- `http_response_headers_transform`: no entrypoint ruleset present
- `http_request_origin`: no entrypoint ruleset present
- `http_request_redirect`: phase not allowed at zone level
- `http_request_cache_settings`: token not authorized for this phase
- `http_request_dynamic_redirect`: token not authorized for this phase

## Runtime Overrides and Customization
### Custom UI
Recovered from the live VPS and currently present locally:
- `public/scripts/custom.js`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-web/public/scripts/custom.js`

This file contains the UMH control UI and console bridge, including commands such as:
- `umhctl install`
- `umhctl status`
- `umhctl listProcesses`
- `umhctl getFlowContract`
- `umhctl getCapabilities`
- `umhctl safetyState`
- `umhctl profileProcess`
- `umhctl methodPolicy`
- `umhctl securityBoundary`
- `umhctl inject`
- `umhctl injectAll`
- `umhctl clearTargetScope`

Retired `hookControl`, bypass, disable, and aggregate-disable operator controls are not
published. Input and WDA neutralization for the applicable targets is automatic at
HookDLL install time.

### Runtime Core Override
Runtime copies retained outside Git:
- `meshcentral-data/meshcore.js`
- `server-backups/meshcentral-live-20260413-153810/opt/meshcentral/meshcentral-data/meshcore.js`

Status:
- on 2026-07-26, the local datapath core was reviewed and its relay-only experimental drift was intentionally discarded
- `meshcentral-data/meshcore.js` is byte-for-byte identical to `agents/meshcore.js` at SHA256 `281ef72c93fd7696085d0c87669decc1ea081e82a7cc9181ee11ee085d5f0ae3`
- the retained server-backup copy is recovery evidence and must not be treated as current runtime state without a fresh comparison

## Service and Host Layout
### Verified Live Remote Paths
Verified from direct SSH capture:
- application root: `/opt/meshcentral`
- data root: `/opt/meshcentral/meshcentral-data`
- web override root: `/opt/meshcentral/meshcentral-web`
- systemd unit: `/etc/systemd/system/meshcentral.service`
- cloudflared unit: `/etc/systemd/system/cloudflared.service`
- caddy config: `/etc/caddy/Caddyfile`
- backup directories observed:
  - `/opt/meshcentral/backups`
  - `/opt/meshcentral/server-backups`
  - `/opt/meshcentral/runtime-backup-20260402_152547`

### Service User Model
Verified from live service unit and host ownership:
- service name: `meshcentral`
- service user: `meshcentral`
- service group: `meshcentral`
- working directory: `/opt/meshcentral`
- startup command: `/usr/bin/node /opt/meshcentral/node_modules/meshcentral/meshcentral.js`

## Backup Scope SSOT
### Must Back Up
Sensitive runtime state that must stay out of Git but must be recoverable locally:
- `meshcentral-data/config.json`
- `meshcentral-data/meshcore.js`
- MongoDB dump for `meshcentral`
- edge proxy config: Caddy in live state, Nginx only if intentionally restoring the repo-era deployment shape
- `public/scripts/custom.js`
- Cloudflare non-secret control evidence and zone export
- systemd units and cloudflared config

### Nice To Have
- `journalctl -u meshcentral` diagnostic tail
- `ss -ltnp` listener snapshot
- firewall snapshot
- DNS resolution snapshot

### Captured Live Snapshot
Current live snapshot directory:
- `server-backups/meshcentral-live-20260413-153810`

Verified captured evidence includes:
- live `Caddyfile`
- live `cloudflared` config and tunnel CLI evidence
- live `meshcentral.service`
- live `cloudflared.service`
- live `meshcentral-data/config.json`
- live `meshcentral-data/meshcore.js`
- deployed live `custom.js`
- live DB collection counts
- live `mongodump` archive
- Cloudflare raw zone export and concise summary
- manifest with per-file hashes

## Current Truth Boundary
What is true now:
- the repo documents and automates an Nginx-first deployment model, but the live server is currently Caddy-fronted
- the local runtime config uses MongoDB and enables `umhControls`
- the UMH custom UI exists in `public/scripts/custom.js`
- the live app root is `/opt/meshcentral`
- the live edge stack is `Caddy + cloudflared`
- the live MeshCentral, Caddy, cloudflared, and MongoDB services are active
- the live database is MongoDB on `127.0.0.1:27017`
- the live Cloudflare zone, key zone settings, DNS records, page rules, firewall skip rule, and post-fix cache policy are exported locally
- the tracked local live-edge copy is `infra/caddy/Caddyfile.live`
- the VPS can act as the Cloudflare control point through `/usr/local/bin/cf-wrangler`

What is not yet proven:
- any dashboard surfaces that the current token cannot read
- the contents of unauthorized rule phases such as `http_request_cache_settings` and `http_request_dynamic_redirect`

