'use strict';
// The desktop audio toolbar control (public/scripts/agent-desktop-audio-control-0.0.1.js) driven
// against the real viewer scripts: agent-desktop-0.0.2.js creates the module (MeshDesktopModuleObservers,
// addStateListener) and agent-redir-ws-0.1.1.js carries the control messages (addControlListener).
// The page is a small DOM fake with the template's #deskAudioMount slot. Nothing is polled: the
// fake records every setInterval, and none may be registered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const scriptsDir = path.join(__dirname, '../../public/scripts');
const read = name => fs.readFileSync(path.join(scriptsDir, name), 'utf8');
const playerSource = read('agent-desktop-audio-0.0.1.js');
const controlSource = read('agent-desktop-audio-control-0.0.1.js');
const redirSource = read('agent-redir-ws-0.1.1.js');
const desktopSource = read('agent-desktop-0.0.2.js');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture(options = {}) {
    const nodes = {}, scripts = [], contexts = [], tunnels = [], players = [], intervals = [], warnings = [];
    let gesture = false;
    class Element {
        constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; }
        appendChild(el) { this.insertBefore(el, null); }
        insertBefore(el, anchor) { if (el.parentNode) el.parentNode.children.splice(el.parentNode.children.indexOf(el), 1); const i = anchor ? this.children.indexOf(anchor) : this.children.length; this.children.splice(i, 0, el); el.parentNode = this; if (el.id) nodes[el.id] = el; if (el.tagName === 'SCRIPT') scripts.push(el); }
        setAttribute(k, v) { this.attrs[k] = v; }
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
        addEventListener(k, fn) { this.listeners[k] = fn; }
        blur() {}
        getContext() { return { canvas: { width: 0, height: 0 }, clearRect() {}, setTransform() {} }; }
    }
    const toolbar = new Element('div');
    if (!options.noSlot) {
        const slot = new Element('span'); slot.id = 'deskAudioMount'; slot.hidden = true;
        if (options.mobile) slot.setAttribute('data-mobile', 'true');
        toolbar.appendChild(slot);
    }
    const desk = new Element('canvas'); desk.id = 'Desk'; nodes.Desk = desk;
    const document = { readyState: 'complete', head: new Element('head'), getElementById: id => nodes[id] || null, createElement: tag => new Element(tag), createTextNode: text => ({ text }) };
    class Context {
        constructor() { assert.equal(gesture, true, 'context must be created synchronously in click'); this.state = 'suspended'; contexts.push(this); }
        resume() { assert.equal(gesture, true, 'resume must happen synchronously in click'); this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
    }
    class WebSocket { constructor(url) { this.url = url; this.readyState = 0; } send() {} close() {} }
    WebSocket.OPEN = 1;
    const sandbox = {
        document, AudioContext: Context, WebSocket, navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0' },
        location: { protocol: 'https:', host: 'mesh.test', pathname: '/' }, urlargs: {},
        console: { log() {}, warn(...args) { warnings.push(args.join(' ')); } },
        setInterval(fn, ms) { intervals.push(ms); return intervals.length; }, clearInterval() {}, setTimeout, clearTimeout,
        localStorage: { getItem() { return null; }, setItem() {} }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(redirSource, sandbox);
    vm.runInContext(desktopSource, sandbox);
    vm.runInContext(playerSource, sandbox);
    const api = sandbox.MeshDesktopAudio;
    api.createMeshDesktopAudioPlayer = opts => { if (options.playerError) throw Error('player init failed'); const p = { opts, start() {}, stop() { this.stopped = true; }, handlePacket() { this.packets = (this.packets || 0) + 1; return true; } }; players.push(p); return p; };
    if (options.lazy) sandbox.MeshDesktopAudio = undefined;
    const realRedirect = sandbox.CreateAgentRedirect;
    vm.runInContext(controlSource, sandbox);
    assert.equal(sandbox.CreateAgentRedirect, realRedirect, 'the control must not wrap CreateAgentRedirect');
    // Record the tunnels the control opens, without changing them.
    sandbox.CreateAgentRedirect = function () { const r = realRedirect.apply(this, arguments); tunnels.push(r); return r; };
    function ctrl(r, state, extra = {}) { r.xxOnControlCommand(JSON.stringify({ ctrlChannel: '102938', type: 'audio', state, ...extra })); }
    // What a desktop page does: a module on the Desk canvas, a relay tunnel, Start.
    function desktop() {
        const r = realRedirect({ send() {} }, sandbox.CreateAgentRemoteDesktop(nodes.Desk), null, 'cookie', 'rcookie', '/');
        r.Start('node//1');
        ctrl(r, 'available', { protocol: 20, tsid: 3 });
        return r;
    }
    const desk0 = options.noDesktop ? null : desktop();
    const control = () => nodes['mc-desk-audio'];
    return { sandbox, contexts, tunnels, players, scripts, nodes, intervals, warnings, desk: desk0, desktop, ctrl, control,
        click() { gesture = true; try { nodes['mc-desk-audio-btn'].listeners.click({ preventDefault() {}, detail: 1 }); } finally { gesture = false; } },
        loaded() { sandbox.MeshDesktopAudio = api; scripts.at(-1).onload(); },
        state() { return control().getAttribute('data-state'); },
        stopped(r) { return r.State === 0 && r.socket === null; } };
}

test('the control mounts explicitly into the template slot and registers no interval', () => {
    const f = fixture({ noDesktop: true });
    assert.equal(f.nodes['mc-desk-audio-btn'], undefined, 'nothing is created before mount or an audio advertisement');
    assert.equal(f.sandbox.MeshDesktopAudioControl.mount(), true);
    assert.equal(f.sandbox.MeshDesktopAudioControl.mount(), true, 'mount is idempotent');
    const slot = f.nodes.deskAudioMount;
    assert.equal(slot.children.filter(c => c.id === 'mc-desk-audio').length, 1, 'one control in the slot');
    assert.equal(slot.hidden, true, 'the slot stays hidden until audio is available');
    assert.deepEqual(f.intervals, [], 'no polling');
    assert.deepEqual(Object.keys(f.sandbox.MeshDesktopAudioControl), ['mount'], 'only the mount surface is exposed');
});

test('the agent advertisement shows the control through the module and control listeners', () => {
    const f = fixture();
    assert.equal(f.control().hidden, false);
    assert.equal(f.nodes.deskAudioMount.hidden, false);
    assert.equal(f.state(), 'off');
    assert.equal(f.control().getAttribute('data-mobile'), 'false');
    assert.deepEqual(f.intervals, [], 'no polling');
});

test('only the Desk viewer module is observed', () => {
    const f = fixture({ noDesktop: true });
    const other = { tagName: 'CANVAS', style: {}, getContext() { return { canvas: {}, clearRect() {}, setTransform() {} }; } };
    const r = f.sandbox.CreateAgentRedirect({ send() {} }, f.sandbox.CreateAgentRemoteDesktop(other), null, 'c', 'r', '/');
    r.Start('node//1'); f.ctrl(r, 'available', { protocol: 20 });
    assert.equal(f.nodes['mc-desk-audio-btn'], undefined);
});

test('a page without the slot shows nothing and says why', () => {
    const f = fixture({ noSlot: true });
    assert.equal(f.nodes['mc-desk-audio-btn'], undefined);
    assert.match(f.warnings.join('\n'), /no #deskAudioMount toolbar slot/);
});

test('the desktop closing hides the control and stops audio', async () => {
    const f = fixture(); f.click(); await flush(); const tunnel = f.tunnels.at(-1);
    f.desk.Stop();
    assert.equal(f.control().hidden, true); assert.equal(f.nodes.deskAudioMount.hidden, true);
    assert.equal(f.stopped(tunnel), true); assert.equal(f.contexts[0].state, 'closed');
});

test('lazy startup resumes inside the gesture and cancellation prevents a late tunnel', async () => {
    const f = fixture({ lazy: true }); f.click(); assert.equal(f.contexts.length, 1); f.click();
    f.loaded(); await flush(); assert.equal(f.tunnels.length, 0); assert.equal(f.contexts[0].state, 'closed'); assert.equal(f.state(), 'off');
});
test('a failed script load after cancellation cannot change off into error', async () => {
    const f = fixture({ lazy: true }); f.click(); f.click(); f.scripts[0].onerror(); await flush();
    assert.equal(f.state(), 'off');
});
test('late control and data from an old tunnel cannot stop or feed a new player', async () => {
    const f = fixture(); f.click(); await flush(); const old = f.tunnels.at(-1);
    f.click(); f.click(); await flush(); const current = f.players.at(-1);
    f.ctrl(old, 'error', { reason: 'old failure' }); old.m.ProcessBinaryData(new Uint8Array(16));
    assert.equal(f.state(), 'connecting'); assert.equal(current.stopped, undefined); assert.equal(current.packets, undefined);
});
test('rebinding desktop clears active state so first click starts the new session', async () => {
    const f = fixture(); f.click(); await flush(); const old = f.players[0];
    f.ctrl(f.tunnels.at(-1), 'started'); old.opts.onPlayback('ready'); assert.equal(f.state(), 'playing');
    f.desktop(); assert.equal(f.state(), 'off'); f.click(); await flush(); assert.equal(f.players.length, 2);
});
test('agent startup alone does not claim playback, and browser failure closes resources', async () => {
    const f = fixture(); f.click(); await flush(); const tunnel = f.tunnels.at(-1);
    f.ctrl(tunnel, 'started'); assert.equal(f.state(), 'connecting');
    f.players[0].opts.onPlayback('blocked', 'Browser blocked audio');
    assert.equal(f.state(), 'error'); assert.equal(f.stopped(tunnel), true); assert.equal(f.contexts[0].state, 'closed');
});
test('retry after script failure loads again and succeeds', async () => {
    const f = fixture({ lazy: true }); f.click(); f.scripts[0].onerror(); await flush(); assert.equal(f.state(), 'error');
    f.click(); assert.equal(f.scripts.length, 2); f.loaded(); await flush(); assert.equal(f.players.length, 1); assert.equal(f.state(), 'connecting');
});
test('player construction errors are visible and close the click-created context', async () => {
    const f = fixture({ playerError: true }); f.click(); await flush();
    assert.equal(f.state(), 'error'); assert.equal(f.contexts[0].state, 'closed'); assert.equal(f.tunnels.length, 0);
});
test('late player callbacks cannot change a replacement session', async () => {
    const f = fixture(); f.click(); await flush(); const old = f.players[0];
    f.click(); f.click(); await flush();
    old.opts.onPlayback('blocked', 'old context'); old.opts.onError('old decode'); old.opts.onActivity(true);
    assert.equal(f.state(), 'connecting'); assert.equal(f.players[1].stopped, undefined);
});
test('the audio tunnel is protocol 20 and carries the advertised tsid', async () => {
    const f = fixture(); f.click(); await flush();
    const tunnel = f.tunnels.at(-1);
    assert.equal(tunnel.m.protocol, 20); assert.equal(tunnel.options.tsid, 3); assert.match(tunnel.socket.url, /[?&]p=20&/);
});

test('mobile pages mount the larger control from their marked slot', async () => {
    const f = fixture({ mobile: true });
    assert.ok(f.nodes['mc-desk-audio-btn']);
    assert.equal(f.control().getAttribute('data-mobile'), 'true');
    f.click(); await flush();
    assert.equal(f.tunnels.at(-1).m.protocol, 20);
    assert.equal(f.contexts[0].state, 'running');
});

test('a second copy of the control (an operator custom.js) does not install', () => {
    const f = fixture();
    const before = f.sandbox.MeshDesktopModuleObservers.length;
    vm.runInContext(controlSource, f.sandbox);
    assert.equal(f.sandbox.MeshDesktopModuleObservers.length, before);
    assert.equal(f.nodes.deskAudioMount.children.filter(c => c.id === 'mc-desk-audio').length, 1);
});
