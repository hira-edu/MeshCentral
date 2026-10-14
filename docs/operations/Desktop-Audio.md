# Desktop Audio (relay protocol 20)

Desktop audio lets a technician who is already viewing a remote desktop hear the
endpoint's speaker output (WASAPI loopback, never the microphone). It is served to
agents through the runtime core override (`agents/meshcore.js`, deployed as
`meshcentral-data/meshcore.js`) and uses relay protocol number 20 ("Desktop Audio").

## Behavior

- Audio exists only alongside a remote desktop session on the same Windows
  session (`tsid`). The agent refuses protocol 20 unless a desktop tunnel for that
  `tsid` has completed its consent step.
- Rights are the desktop viewing rights of the user opening the audio tunnel
  (`REMOTECONTROL` or `REMOTEVIEW`, and not `NODESKTOP`). With desktop
  multiplexing enabled the agent holds a single server-side desktop tunnel; the
  consent carried by that tunnel admits audio for any other user who passes the
  rights check on their own audio tunnel. That shared tunnel streams the first
  viewer's session; the `available` advertisement names it (`tsid`), and every
  viewer opens audio on that session.
- No separate consent prompt. Notification mirrors the desktop session: if it
  shows a toast, audio start/stop toasts (`{0} started/stopped listening to this
  computer's audio.`); if it shows the privacy bar, the bar is recreated with
  ` - audio on` while anyone listens; if it shows nothing, audio adds nothing.
- When the last consented desktop tunnel for the `tsid` closes, the agent closes
  every audio tunnel for it with state `stopped`.
- Audio is live only. The agent never queues packets: while the relay socket is
  backed up, packets are dropped until it drains.
- Agents without the `desktop-audio` module (older agent builds, non-Windows,
  console-mode agents) never advertise audio and answer `unavailable`.

## Disable switches

| Scope | Setting | Effect |
| --- | --- | --- |
| Server (all agents served this core) | `DESKTOP_AUDIO_ENABLED` constant near the `MESHRIGHT_*` constants in `agents/meshcore.js` (apply the same change to `agents/meshcore.min.js`, then redeploy `meshcentral-data/meshcore.js`) | `false`: the agent never sends the `available` advertisement and refuses protocol 20 with `unavailable`. |
| Device | Agent datastore key `desktopAudio` = `0` (agent console: `dbset desktopAudio 0` disables, `dbset desktopAudio 1` re-enables; `dbget desktopAudio` shows the current value) | Checked by the agent's `desktop-audio` module; the agent answers `unavailable` and does not advertise. |

Both switches take effect for new sessions; running audio tunnels are not cut.

## Audit records

The agent writes a server event (`action: log`) for every audio start, stop and
failure, independent of notification settings. `msgArgs[0]` is the `tsid`
(`null` for the console session); the event also carries `userid`, `username`,
`sessionid` and `remoteaddr` of the audio tunnel's user, like the desktop events.
The same line, with the user name, is written to the agent's local log through
`MeshAgent.log`.

| msgid | Event | msgArgs |
| --- | --- | --- |
| 2001 | Desktop audio started | `[tsid]` |
| 2002 | Desktop audio stopped | `[tsid]` |
| 2003 | Desktop audio failed or refused | `[tsid, state, reason]` where `state` is `denied`, `unavailable`, `nodesktop`, `error` |

These ids are outside the range used by meshcentral 1.2.1 (1-164); the web UI
shows the event's `msg` text for ids it has no translation for. The existing
desktop bar events 29/31/32 are also emitted when audio recreates the privacy bar.

## Session recording

The relay in the npm package records any relay protocol when a domain sets
`"sessionrecording": true`, or sets it to an object without a `"protocols"` list.
When it records a tunnel it sends `cr` instead of `c` to both ends. The agent
refuses protocol 20 on a tunnel that received `cr` (state `unavailable`, audit
2003) before the helper starts, so no audio reaches a recording file whatever
the configuration. To keep audio usable, a domain that enables recording should
list its protocols explicitly and leave 20 out, for example:

```json
"sessionrecording": { "protocols": [1, 2, 5, 6, 8, 9, 10, 100, 101, 200] }
```

`node tests/desktop-audio-core-recording.test.js --config meshcentral-data/config.json`
validates a config before publication and fails if any domain would record
protocol 20. The committed template enables no recording. The desktop
multiplexer (`meshdesktopmultiplex.js`) records only protocol 2 and is not
affected.

## Viewer

`public/scripts/custom.js` adds an audio control to the top toolbar of both
desktop viewer pages: the main web UI (`views/default.handlebars`, including its
stand-alone desktop window) and guest desktop share links
(`views/sharing.handlebars`). No view or server configuration changes are
needed. The mobile views do not load `custom.js` and have no audio control.

- Position: the first button of the toolbar's right-hand group, directly left of
  Actions (main UI) or Settings (share links), with the stock button spacing.
- Size: one 22px row, matching the toolbar buttons, in day and night mode.
- Speaker button: hidden until the agent sends the `available` advertisement;
  off at the start of every session. Click starts audio, click again stops it
  and closes the protocol-20 tunnel. States: off, connecting (spinner),
  playing (sound waves, animated only while audio is actually flowing), muted
  (volume 0), unavailable or error (slashed, reason in the tooltip).
- Volume: a slider left of the speaker, shown while connecting or playing, so
  the speaker never moves under the pointer. The speaker faces the slider. The
  level is remembered per browser (`localStorage` key `meshDesktopAudioVolume`;
  full volume when storage is unavailable).
- Keyboard: Tab reaches the button and the slider; their keys never reach the
  remote desktop. A mouse click returns focus to the page so typing still goes
  to the device.
- Animations stop under `prefers-reduced-motion`.

Guest share links reach the agent only through this fork's `meshrelay.js`
override (next section).

The web override root needs these files beside `custom.js` (all are in the
`deploy.py` publish map):

| File | Purpose |
| --- | --- |
| `scripts/agent-desktop-audio-0.0.1.js` | Packet parser, WebCodecs Opus decoding, playback scheduling (latency capped at 300 ms) |
| `scripts/opus-decoder-0.7.11.min.js` | Vendored `opus-decoder` (MIT, embeds libopus under BSD-3-Clause); loaded only when the browser has no WebCodecs Opus decoder; makes no network requests |
| `scripts/opus-decoder-0.7.11.LICENSE.txt` | License notices and npm integrity record for the vendored decoder |

## Relay override for guest share links

The npm relay limits a share link's tunnels to the protocols its permissions
grant (terminal 1/6/8/9, desktop 2, files 5/10) and closes any other protocol
with "Invalid protocol usage". The fork deploys its own `meshrelay.js`
(module root, beside `meshdesktopmultiplex.js`) that is meshcentral 1.2.1's file
with one change: a share that grants desktop also admits protocol 20. The agent
still requires a consented desktop session and desktop rights, so guests hear
audio only while they could watch the desktop, under the share's own consent and
notification.

`tests/desktop-audio-relay.test.js` pins the override to meshcentral 1.2.1 plus
that line (by SHA-256) and to the version in `package.json`. When the npm
package is upgraded, copy the new release's `meshrelay.js`, re-apply the line,
and update the pinned version and hash together; the test fails until then.

## Protocol summary for viewers

- Open a normal agent relay tunnel with `p=20`, send the connection `options`
  (with `tsid`, as for desktop) and then the text `20` after the agent's `c`.
- The agent advertises support on the desktop tunnel once it is consented and
  streaming: `{"ctrlChannel":"102938","type":"audio","state":"available","protocol":20,"tsid":1}`.
  `tsid` is the session that desktop tunnel streams (`null` for the console
  session); open the audio tunnel on that session.
- On the audio tunnel the agent sends binary messages (one audio packet each) and
  text control messages `{"ctrlChannel":"102938","type":"audio","state":...}` with
  states `started`, `stopped`, `unavailable`, `nodesktop`, `denied`, `error` and
  optional `code` / `reason`. Every terminal state is followed by the agent closing
  the tunnel.
- With desktop multiplexing enabled, `meshdesktopmultiplex.js` forwards the
  `available` advertisement to every current viewer and replays it to viewers
  that join later. It forwards no other `audio` control message; audio itself
  always travels on each viewer's own protocol-20 tunnel.
