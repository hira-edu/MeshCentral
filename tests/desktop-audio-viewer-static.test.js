'use strict';

// Static contracts for the viewer-side system-audio wiring. These assert the
// integration points that put the speaker control in the top toolbar of both
// desktop viewer pages (main UI and guest share links) without forking a stock
// view, plus the vendored decoder's presence and integrity. No browser is
// required; layout and interaction were verified against the stock toolbar
// markup and style.css in a browser harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptsDir = path.join(__dirname, '../public/scripts');
const custom = fs.readFileSync(path.join(scriptsDir, 'custom.js'), 'utf8');
const player = fs.readFileSync(path.join(scriptsDir, 'agent-desktop-audio-0.0.1.js'), 'utf8');

// Isolate the audio control block so these checks do not match unrelated code.
const audioBlockStart = custom.indexOf('__meshDesktopAudioControl');
assert.ok(audioBlockStart > 0, 'custom.js must contain the desktop-audio control block');
const audioBlock = custom.slice(audioBlockStart);

test('audio observer survives a redirector assigning its handler after module.parent', () => {
    const start = custom.indexOf('  function wrapCtrl(');
    const end = custom.indexOf('  function attachDesktopCtrlObserver(', start);
    const wrapCtrl = vm.runInNewContext('(' + custom.slice(start, end).trim() + ')', { CTRL_CHANNEL: '102938' });
    const redir = {}, audioMessages = [], delegated = [];
    // The canary constructor assigns module.parent before defining xxOnControlCommand.
    wrapCtrl(redir, message => audioMessages.push(message));
    redir.xxOnControlCommand = function () { delegated.push({ receiver: this, args: Array.from(arguments) }); return 'handled'; };
    wrapCtrl(redir, () => assert.fail('observer must only be installed once'));
    const message = JSON.stringify({ ctrlChannel: '102938', type: 'audio', state: 'available', protocol: 20 });
    const channel = {};
    assert.equal(redir.xxOnControlCommand(message, 7, channel), 'handled');
    assert.equal(audioMessages.length, 1);
    assert.equal(audioMessages[0].state, 'available');
    assert.equal(delegated[0].receiver, redir);
    assert.deepEqual(delegated[0].args, [message, 7, channel]);
    redir.xxOnControlCommand('not JSON', 8, channel);
    assert.equal(audioMessages.length, 1);
    assert.equal(delegated.length, 2, 'malformed and unrelated messages still reach the redirector');
});

test('custom.js hooks the shared desktop redirector factory', () => {
    assert.match(audioBlock, /window\.CreateAgentRedirect/, 'wraps the CreateAgentRedirect factory used by both pages');
    assert.match(audioBlock, /window\.CreateAgentRemoteDesktop/, 'wraps CreateAgentRemoteDesktop so custom Modern UI redirectors are also observed');
    assert.match(audioBlock, /hookCreateAgentRedirect\(\);\s*if \(document\.readyState === 'loading'\)/, 'hooks synchronously in <head> before Modern UI canary scripts snapshot CreateAgentRedirect');
    assert.match(audioBlock, /module\.protocol === DESKTOP_PROTOCOL/, 'identifies desktop (protocol 2) tunnels');
    assert.match(audioBlock, /DESKTOP_PROTOCOL = 2/);
});

test('custom.js binds both desktop pages, including guest share links', () => {
    // sharing.handlebars creates its desktop with CreateAgentRedirect(null, ...); the fork's meshrelay.js
    // admits protocol 20 on share links that grant desktop (tests/desktop-audio-relay.test.js).
    assert.match(audioBlock, /if \(redir && module && module\.protocol === DESKTOP_PROTOCOL && isSingleDesktopViewer\(module\)\)/);
    assert.doesNotMatch(audioBlock, /meshserver != null && module/, 'no guest-share exclusion remains');
});

test('custom.js mounts the control as the first button of the right-hand toolbar group', () => {
    assert.match(audioBlock, /getElementById\('deskActionsSettings'\)/, 'finds the right-hand group through its Settings button');
    assert.match(audioBlock, /if \(el\.tagName === 'INPUT'\) \{ return el; \}/, 'anchors before the group\'s first button');
    assert.match(audioBlock, /anchor\.parentNode\.insertBefore\(controlEl, anchor\);\s*anchor\.parentNode\.insertBefore\(spacerEl, anchor\);/,
        'inline, followed by a space so the gap matches the stock buttons');
    assert.match(audioBlock, /#mc-desk-audio\{display:inline-flex;[^']*height:22px;[^']*vertical-align:middle;position:relative;top:-1px/,
        'one 22px row centred on the stock buttons');
});

test('custom.js keeps the speaker button fixed: slider on its left, glyph facing the slider', () => {
    assert.match(audioBlock, /group\.appendChild\(slider\);\s*group\.appendChild\(button\);/, 'slider before button');
    assert.match(audioBlock, /#mc-desk-audio-btn svg\{[^}]*transform:scaleX\(-1\)\}/, 'speaker mirrored to face the slider');
    assert.match(audioBlock, /slider\.hidden = true;/, 'slider starts hidden');
    assert.match(audioBlock, /sliderEl\.hidden = !\(state === 'playing' \|\| state === 'connecting'\);/, 'slider shows only while connecting or playing');
});

test('custom.js volume: native range input, remembered per browser, applied to the player', () => {
    assert.match(audioBlock, /slider\.type = 'range';/);
    assert.match(audioBlock, /setAttribute\('aria-label', 'Device audio volume'\)/);
    assert.match(audioBlock, /VOLUME_KEY = 'meshDesktopAudioVolume'/);
    assert.match(audioBlock, /try \{ stored = window\.localStorage\.getItem\(VOLUME_KEY\); \} catch \(ex\) \{ stored = null; \}/, 'storage failures fall back to full volume');
    assert.match(audioBlock, /player\.setVolume\(volumePercent \/ 100\)/);
    assert.match(audioBlock, /volume: volumePercent \/ 100/, 'a new player starts at the remembered level');
});

test('custom.js animates the waves only while audio flows, and honours reduced motion', () => {
    assert.match(audioBlock, /onActivity: function \(flowing\) \{ audioFlowing = flowing; renderControl\(\); \}/);
    assert.match(audioBlock, /#mc-desk-audio\.mcaudio-flowing \.mcaudio-wave\{animation:mcaudiowave/);
    assert.match(audioBlock, /@media \(prefers-reduced-motion:reduce\)\{#mc-desk-audio \.mcaudio-spin,#mc-desk-audio \.mcaudio-wave\{animation:none\}\}/);
});

test('custom.js scopes the icon to the single desktop viewer canvas', () => {
    assert.match(audioBlock, /getElementById\('Desk'\)/, "binds to the 'Desk' canvas used by both viewer pages");
});

test('custom.js opens a protocol-20 audio tunnel carrying tsid', () => {
    assert.match(audioBlock, /AUDIO_PROTOCOL = 20/);
    assert.match(audioBlock, /protocol: AUDIO_PROTOCOL/, 'the audio module advertises protocol 20');
    assert.match(audioBlock, /redir\.__mcAudioTsid = \{ value: m\.tsid \}/, 'remembers the session the agent advertised');
    assert.match(audioBlock, /var tsid = desktop\.__mcAudioTsid \? desktop\.__mcAudioTsid\.value : \(desktop\.options \? desktop\.options\.tsid : null\);/,
        'opens audio on the advertised session, falling back to the page selection');
    assert.match(audioBlock, /if \(tsid != null\) \{ redir\.options\.tsid = tsid; \}/, 'passes the session tsid in xoptions');
});

test('custom.js reveals the icon only after the availability ctrl message', () => {
    assert.match(audioBlock, /ctrlChannel/);
    assert.match(audioBlock, /CTRL_CHANNEL = '102938'/);
    assert.match(audioBlock, /m\.state === 'available'/, 'control shown on the audio "available" advertisement');
    // The control starts hidden and its visibility follows availability.
    assert.match(audioBlock, /group\.hidden = true;/);
    assert.match(audioBlock, /controlEl\.hidden = !uiState\.available;/);
    assert.match(audioBlock, /#mc-desk-audio\[hidden\]\{display:none\}/, 'the display rule does not defeat [hidden]');
});

test('custom.js renders all required icon states with a reason tooltip', () => {
    for (const state of ['off', 'connecting', 'playing', 'unavailable', 'error']) {
        assert.ok(audioBlock.indexOf("'" + state + "'") >= 0, 'handles state ' + state);
    }
    assert.match(audioBlock, /tooltipFor/, 'tooltip derives from state + reason');
});

test('custom.js control is keyboard accessible without leaking keys to the remote desktop', () => {
    assert.match(audioBlock, /button\.type = 'button';/, 'a native button: Enter and Space work without custom handlers');
    assert.match(audioBlock, /setAttribute\('aria-pressed'/);
    assert.match(audioBlock, /group\.setAttribute\('role', 'group'\);/);
    assert.match(audioBlock, /:focus-visible\{outline:2px solid #1a5fb4/, 'focus ring for keyboard users only');
    // The stock page forwards keys to the device from document-level handlers.
    for (const type of ['keydown', 'keyup', 'keypress']) { assert.match(audioBlock, new RegExp("el\\.addEventListener\\('" + type + "', stop\\)")); }
    assert.match(audioBlock, /if \(e\.detail > 0\) \{ button\.blur\(\); \}/, 'a pointer click hands focus back to the page');
});

test('custom.js closes audio when the desktop session ends', () => {
    assert.match(audioBlock, /onDesktopClosed/);
    assert.match(audioBlock, /chainDesktopStateChanged/, 'observes desktop disconnect without clobbering the page handler');
});

test('custom.js creates the AudioContext inside the click (user gesture)', () => {
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
