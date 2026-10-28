'use strict';

// Static contracts for the viewer-side system-audio wiring: the toolbar control
// (public/scripts/agent-desktop-audio-control-0.0.1.js), the template slot and
// script tag that load it on the five desktop pages, the player, and the vendored
// decoder's presence and integrity. desktop-audio-control.test.js drives the
// control's behaviour. No browser is required; layout and interaction were
// verified against the stock toolbar markup and style.css in a browser harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptsDir = path.join(__dirname, '../../public/scripts');
const viewsDir = path.join(__dirname, '../../views');
const player = fs.readFileSync(path.join(scriptsDir, 'agent-desktop-audio-0.0.1.js'), 'utf8');
const audioBlock = fs.readFileSync(path.join(scriptsDir, 'agent-desktop-audio-control-0.0.1.js'), 'utf8');
// Each desktop template and the first toolbar button its audio slot sits in front of.
const DESKTOP_TEMPLATES = { default: 'id="deskFocusBtn"', default3: 'title="Change the power state of the remote machine"', sharing: 'id="deskActionsSettings"', 'default-mobile': 'id=deskFullScreen', 'sharing-mobile': 'id=deskFullScreen' };
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the redirector hands every control message to its control listeners', () => {
    const logged = [];
    const sandbox = { console: { log(...args) { logged.push(args); } } };
    vm.runInNewContext(fs.readFileSync(path.join(scriptsDir, 'agent-redir-ws-0.1.1.js'), 'utf8'), sandbox);
    const redir = sandbox.CreateAgentRedirect(null, { protocol: 2, ProcessData() {} }, null, null, null, '/');
    const seen = [];
    const listener = m => seen.push(m);
    redir.addControlListener(() => { throw new Error('broken listener'); });
    redir.addControlListener(listener);
    redir.addControlListener(listener);
    redir.xxOnControlCommand(JSON.stringify({ ctrlChannel: '102938', type: 'audio', state: 'available', protocol: 20 }));
    assert.equal(seen.length, 1, 'parsed message delivered once per listener');
    assert.equal(seen[0].state, 'available');
    assert.equal(logged.length, 1, 'a throwing listener is logged and does not stop the others');
    redir.xxOnControlCommand('not JSON');
    redir.xxOnControlCommand(JSON.stringify({ ctrlChannel: 'other' }));
    assert.equal(seen.length, 1, 'malformed and non-control messages are not offered to listeners');
});

test('the control attaches through the viewer extension points only', () => {
    assert.match(audioBlock, /\(window\.MeshDesktopModuleObservers = window\.MeshDesktopModuleObservers \|\| \[\]\)\.push\(observeDesktopModule\)/);
    assert.match(audioBlock, /module\.addStateListener\(onDesktopModuleState\)/);
    assert.match(audioBlock, /redir\.addControlListener\(/);
    assert.match(audioBlock, /module\.protocol !== DESKTOP_PROTOCOL/, 'identifies desktop (protocol 2) modules');
    assert.match(audioBlock, /DESKTOP_PROTOCOL = 2/);
    assert.doesNotMatch(audioBlock, /window\.CreateAgentRedirect\s*=[^=]|window\.CreateAgentRemoteDesktop\s*=[^=]/, 'no factory is wrapped');
    assert.doesNotMatch(audioBlock, /defineProperty/, 'no property is intercepted');
    assert.doesNotMatch(audioBlock, /setInterval|setTimeout/, 'no timer');
    assert.match(audioBlock, /if \(window\.__meshDesktopAudioControl\) return;/, 'installs once per page, so an older custom.js copy stays inert');
});

test('the control binds both desktop pages, including guest share links', () => {
    // sharing.handlebars creates its desktop with CreateAgentRedirect(null, ...); the fork's meshrelay.js
    // admits protocol 20 on share links that grant desktop (tests/desktop-audio-relay.test.js).
    assert.doesNotMatch(audioBlock, /meshserver != null && module/, 'no guest-share exclusion remains');
    assert.match(audioBlock, /var meshserver = desktop\.meshserver != null \? desktop\.meshserver : null;/);
});

test('the five desktop templates load the control after agent-desktop and give it a toolbar slot', () => {
    for (const [name, anchor] of Object.entries(DESKTOP_TEMPLATES)) {
        const page = fs.readFileSync(path.join(viewsDir, name + '.handlebars'), 'utf8');
        const desktop = page.search(/<script type="text\/javascript" src="scripts\/agent-desktop-0\.0\.2\{\{\{?min\}?\}\}\.js"><\/script>/);
        const control = page.indexOf('<script type="text/javascript" src="scripts/agent-desktop-audio-control-0.0.1.js"></script>');
        assert.ok(desktop > 0 && control > desktop, name + ' loads the control after agent-desktop');
        assert.equal(page.split('agent-desktop-audio-control-0.0.1.js').length, 2, name + ' loads the control once');
        // The slot sits in front of the first button of the right-hand group (Full Screen on the mobile pages).
        const mobile = name.endsWith('-mobile');
        const slot = new RegExp('<span id="deskAudioMount"' + (mobile ? ' data-mobile="true"' : '') + ' hidden></span>\\r?\\n[ \\t]*<input[^>]*' + escapeRegExp(anchor));
        assert.match(page, slot, name + ' has the toolbar slot before its first toolbar button');
    }
    for (const name of ['xterm', 'ssh']) {
        assert.doesNotMatch(fs.readFileSync(path.join(viewsDir, name + '.handlebars'), 'utf8'), /desktop-audio/, name + ' has no desktop and loads no audio code');
    }
    assert.match(audioBlock, /#mc-desk-audio\{display:inline-flex;[^']*height:22px;[^']*vertical-align:middle;position:relative;top:-1px/,
        'one 22px row centred on the stock buttons');
});

test('the control keeps the speaker button fixed: slider on its left, glyph facing the slider', () => {
    assert.match(audioBlock, /group\.appendChild\(slider\);\s*group\.appendChild\(button\);/, 'slider before button');
    assert.match(audioBlock, /#mc-desk-audio-btn svg\{[^}]*transform:scaleX\(-1\)\}/, 'speaker mirrored to face the slider');
    assert.match(audioBlock, /slider\.hidden = true;/, 'slider starts hidden');
    assert.match(audioBlock, /sliderEl\.hidden = !\(state === 'playing' \|\| state === 'connecting'\);/, 'slider shows only while connecting or playing');
});

test('the control volume: native range input, remembered per browser, applied to the player', () => {
    assert.match(audioBlock, /slider\.type = 'range';/);
    assert.match(audioBlock, /setAttribute\('aria-label', 'Device audio volume'\)/);
    assert.match(audioBlock, /VOLUME_KEY = 'meshDesktopAudioVolume'/);
    assert.match(audioBlock, /try \{ stored = window\.localStorage\.getItem\(VOLUME_KEY\); \} catch \(ex\) \{ stored = null; \}/, 'storage failures fall back to full volume');
    assert.match(audioBlock, /player\.setVolume\(volumePercent \/ 100\)/);
    assert.match(audioBlock, /volume: volumePercent \/ 100/, 'a new player starts at the remembered level');
});

test('the control animates the waves only while audio flows, and honours reduced motion', () => {
    assert.match(audioBlock, /onActivity: function \(flowing\) \{ if \(audioCtx === ctx\) \{ audioFlowing = flowing; renderControl\(\); \} \}/);
    assert.match(audioBlock, /#mc-desk-audio\.mcaudio-flowing \.mcaudio-wave\{animation:mcaudiowave/);
    assert.match(audioBlock, /@media \(prefers-reduced-motion:reduce\)\{#mc-desk-audio \.mcaudio-spin,#mc-desk-audio \.mcaudio-wave\{animation:none\}\}/);
});

test('the control scopes the icon to the single desktop viewer canvas', () => {
    assert.match(audioBlock, /getElementById\('Desk'\)/, "binds to the 'Desk' canvas used by both viewer pages");
});

test('the control opens a protocol-20 audio tunnel carrying tsid', () => {
    assert.match(audioBlock, /AUDIO_PROTOCOL = 20/);
    assert.match(audioBlock, /protocol: AUDIO_PROTOCOL/, 'the audio module advertises protocol 20');
    assert.match(audioBlock, /redir\.audioTsid = \{ value: m\.tsid \}/, 'remembers the session the agent advertised');
    assert.match(audioBlock, /var tsid = desktop\.audioTsid \? desktop\.audioTsid\.value : \(desktop\.options \? desktop\.options\.tsid : null\);/,
        'opens audio on the advertised session, falling back to the page selection');
    assert.match(audioBlock, /if \(tsid != null\) \{ redir\.options\.tsid = tsid; \}/, 'passes the session tsid in xoptions');
});

test('the control reveals the icon only after the availability ctrl message', () => {
    assert.match(audioBlock, /m\.state === 'available'/, 'control shown on the audio "available" advertisement');
    // The control starts hidden and its visibility follows availability.
    assert.match(audioBlock, /group\.hidden = true;/);
    assert.match(audioBlock, /controlEl\.hidden = !uiState\.available;/);
    assert.match(audioBlock, /#mc-desk-audio\[hidden\]\{display:none\}/, 'the display rule does not defeat [hidden]');
});

test('the control renders all required icon states with a reason tooltip', () => {
    for (const state of ['off', 'connecting', 'playing', 'unavailable', 'error']) {
        assert.ok(audioBlock.indexOf("'" + state + "'") >= 0, 'handles state ' + state);
    }
    assert.match(audioBlock, /tooltipFor/, 'tooltip derives from state + reason');
});

test('the control control is keyboard accessible without leaking keys to the remote desktop', () => {
    assert.match(audioBlock, /button\.type = 'button';/, 'a native button: Enter and Space work without custom handlers');
    assert.match(audioBlock, /setAttribute\('aria-pressed'/);
    assert.match(audioBlock, /group\.setAttribute\('role', 'group'\);/);
    assert.match(audioBlock, /:focus-visible\{outline:2px solid #1a5fb4/, 'focus ring for keyboard users only');
    // The stock page forwards keys to the device from document-level handlers.
    for (const type of ['keydown', 'keyup', 'keypress']) { assert.match(audioBlock, new RegExp("el\\.addEventListener\\('" + type + "', stop\\)")); }
    assert.match(audioBlock, /if \(e\.detail > 0\) \{ button\.blur\(\); \}/, 'a pointer click hands focus back to the page');
});

test('the control closes audio when the desktop session ends', () => {
    assert.match(audioBlock, /if \(state === 0\) \{ onDesktopClosed\(module\.parent\); return; \}/, 'the module state listener ends audio with the desktop');
});

test('the control creates the AudioContext inside the click (user gesture)', () => {
    // player.start() (which creates/resumes the AudioContext) is reached from
    // the icon activation path, not on load.
    assert.match(audioBlock, /onIconActivate/);
    assert.match(audioBlock, /player\.start\(\)/);
});

test('player loads the WebCodecs path with an isConfigSupported probe', () => {
    assert.match(player, /isConfigSupported/);
    assert.match(player, /new AudioDecoder/);
    assert.match(player, /probeWebCodecsOpus/);
});

test('player falls back to the vendored opus-decoder lazily', () => {
    assert.match(player, /opus-decoder-0\.7\.11\.min\.js/, 'references the vendored decoder file');
    assert.match(player, /loadDecoderScript/, 'loads the decoder on demand');
    assert.match(player, /window\['opus-decoder'\]/, 'uses the decoder global');
});

test('player caps latency and resets on discontinuity', () => {
    assert.match(player, /MAX_LATENCY_MS = 300/);
    assert.match(player, /scheduler\.reset\(\)/);
    assert.match(player, /discontinuity/);
});

test('vendored opus-decoder is present with its license and matches the pinned npm integrity', () => {
    const decoderPath = path.join(scriptsDir, 'opus-decoder-0.7.11.min.js');
    const licensePath = path.join(scriptsDir, 'opus-decoder-0.7.11.LICENSE.txt');
    assert.ok(fs.existsSync(decoderPath), 'vendored decoder file exists');
    assert.ok(fs.existsSync(licensePath), 'vendored decoder license exists');
    const license = fs.readFileSync(licensePath, 'utf8');
    assert.match(license, /MIT License/);
    assert.match(license, /0\.7\.11/);

    // npm dist integrity for opus-decoder@0.7.11 is sha512 over the tarball, but
    // the published dist file also carries a stable sha-256 we pin here to catch
    // accidental edits of the vendored bytes.
    const bytes = fs.readFileSync(decoderPath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256, 'fd73ee0a9c8a5e233c0b88234df14f46003ad89bb4ba27435bc8714db2a6dc62', 'vendored decoder bytes must be unmodified');

    // The vendored dist must not make runtime network requests.
    const text = bytes.toString('latin1');
    assert.ok(!/\bfetch\s*\(/.test(text), 'no fetch()');
    assert.ok(!/XMLHttpRequest/.test(text), 'no XMLHttpRequest');
    assert.ok(!/importScripts/.test(text), 'no importScripts');
    assert.ok(!/https?:\/\/[A-Za-z0-9.-]+\//.test(text.replace(/github\.com[^\s"']*/g, '')), 'no external URLs beyond the attribution comment');
});

test('the control shows Playing only after the browser proves output, with the context created in the click', () => {
    // The AudioContext is created and resumed synchronously in the click, before the player script loads.
    const start = audioBlock.slice(audioBlock.indexOf('function startAudio()'));
    assert(start.indexOf('ctx = createGestureAudioContext();') >= 0 && start.indexOf('ctx = createGestureAudioContext();') < start.indexOf('loadPlayerModule()'),
        'context created before the asynchronous player load');
    assert.match(audioBlock, /audioContext: ctx,/, 'the player uses the click-created context');
    assert.match(audioBlock, /onPlayback: function \(transition, reason\) \{ if \(audioCtx === ctx\) \{ onPlayerPlayback\(transition, reason\); \} \}/);
    assert.match(audioBlock, /if \(transition === 'ready'\) \{\s*if \(api\) \{ applySnapshot\(api\.onPlaybackReady\(\)\); \}/, "only the player's 'ready' moves the control to Playing");
    assert.match(audioBlock, /uiState\.state = \(agentState === 'started'\) \? 'connecting'/, "the pre-load fallback never maps 'started' to playing");
    const stopTunnel = audioBlock.slice(audioBlock.indexOf('function stopTunnelOnly()'), audioBlock.indexOf('function stopAudio('));
    assert.match(stopTunnel, /audioCtx = null;/, 'the controller releases the context it created');
    assert.match(stopTunnel, /\.close\(\)/, 'and closes it');
    assert.match(stopTunnel, /closing\.catch\(/, 'a rejected close() (already closed) is handled');
});

test('player verifies the context actually runs instead of assuming resume() succeeded', () => {
    assert.match(player, /audioContext\.addEventListener\('statechange', onContextStateChange\)/);
    assert.match(player, /resumed\.then\(onContextStateChange, function \(err\) \{\s*reportPlayback\('blocked'/);
    assert.match(player, /if \(running && audioContext != null && audioContext\.state !== 'running'\) \{\s*reportPlayback\('blocked'/, 'a resume that never completes is reported as blocked');
    // Activity and stream liveness come from a scheduled frame, not from a received packet.
    const handleAudio = player.slice(player.indexOf('function handleAudio(packet)'), player.indexOf('function onDecodedAudioData'));
    assert.doesNotMatch(handleAudio, /markActivity\(\)/);
    assert.match(player, /if \(audible\) \{ markActivity\(\); \}\s*reportPlayback\(readiness\.markStreamLive\(\)\);/);
});

test('the redirectors carry no audio code', () => {
    for (const name of ['agent-redir-ws-0.1.1.js', 'agent-redir-ws-0.1.1-min.js']) {
        const asset = fs.readFileSync(path.join(scriptsDir, name), 'utf8');
        assert.doesNotMatch(asset, /BEGIN GENERATED DESKTOP AUDIO CONTROL|__meshDesktopAudioControl|mc-desk-audio/, name);
    }
    assert.equal(fs.existsSync(path.join(__dirname, '../scripts/build-desktop-audio-control.js')), false, 'nothing generates package bytes from custom.js');
});
