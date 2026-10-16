'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const playerSource = fs.readFileSync(path.join(__dirname, '../public/scripts/agent-desktop-audio-0.0.1.js'), 'utf8');
const custom = fs.readFileSync(path.join(__dirname, '../public/scripts/custom.js'), 'utf8');
const block = custom.slice(custom.lastIndexOf('(function () {', custom.indexOf('if (window.__meshDesktopAudioControl)')));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(options = {}) {
    const nodes = {}, scripts = [], contexts = [], tunnels = [], players = [];
    let gesture = false;
    class Element {
        constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; }
        appendChild(el) { this.insertBefore(el, null); }
        insertBefore(el, anchor) { if (el.parentNode) el.parentNode.children.splice(el.parentNode.children.indexOf(el), 1); const i = anchor ? this.children.indexOf(anchor) : this.children.length; this.children.splice(i, 0, el); el.parentNode = this; if (el.id) nodes[el.id] = el; if (el.tagName === 'SCRIPT') scripts.push(el); }
        get firstElementChild() { return this.children[0]; }
        get nextSibling() { return this.parentNode && this.parentNode.children[this.parentNode.children.indexOf(this) + 1]; }
        get nextElementSibling() { return this.nextSibling; }
        setAttribute(k, v) { this.attrs[k] = v; }
        getAttribute(k) { return this.attrs[k]; }
        addEventListener(k, fn) { this.listeners[k] = fn; }
        blur() {}
    }
    const toolbar = new Element('div'), settings = new Element('input'); settings.id = 'deskActionsSettings'; toolbar.appendChild(settings);
    nodes.Desk = new Element('canvas');
    const document = { readyState: 'complete', head: new Element('head'), getElementById: id => nodes[id], createElement: tag => new Element(tag), createTextNode: () => new Element('text') };
    class Context {
        constructor() { assert.equal(gesture, true, 'context must be created synchronously in click'); this.state = 'suspended'; contexts.push(this); }
        resume() { assert.equal(gesture, true, 'resume must happen synchronously in click'); this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
    }
    const sandbox = { document, AudioContext: Context, setInterval() {}, localStorage: { getItem() { return null; }, setItem() {} }, CreateAgentRedirect(server, module) { const r = { m: module, meshserver: server, Start() { this.started = true; }, Stop() { this.stopped = true; }, xxOnControlCommand() {} }; tunnels.push(r); return r; } };
    sandbox.window = sandbox;
    vm.runInNewContext(playerSource, sandbox);
    const api = sandbox.MeshDesktopAudio;
    api.createMeshDesktopAudioPlayer = opts => { if (options.playerError) throw Error('player init failed'); const p = { opts, start() {}, stop() { this.stopped = true; }, handlePacket() { this.packets = (this.packets || 0) + 1; return true; } }; players.push(p); return p; };
    if (options.lazy) sandbox.MeshDesktopAudio = undefined;
    vm.runInNewContext(block, sandbox);
    function ctrl(r, state, extra = {}) { r.xxOnControlCommand(JSON.stringify({ ctrlChannel: '102938', type: 'audio', state, ...extra })); }
    function desktop() { const r = sandbox.CreateAgentRedirect({}, { protocol: 2, CanvasId: nodes.Desk }); ctrl(r, 'available', { protocol: 20, tsid: 3 }); return r; }
    const desk = desktop();
    return { sandbox, contexts, tunnels, players, scripts, nodes, desk, desktop, ctrl,
        click() { gesture = true; try { nodes['mc-desk-audio-btn'].listeners.click({ preventDefault() {}, detail: 1 }); } finally { gesture = false; } },
        loaded() { sandbox.MeshDesktopAudio = api; scripts.at(-1).onload(); },
        state() { return sandbox.MeshDesktopAudioControl._getUiState().state; } };
}
test('lazy startup resumes inside the gesture and cancellation prevents a late tunnel', async () => {
    const f = fixture({ lazy: true }); f.click(); assert.equal(f.contexts.length, 1); f.click();
    f.loaded(); await flush(); assert.equal(f.tunnels.length, 1); assert.equal(f.contexts[0].state, 'closed'); assert.equal(f.state(), 'off');
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
    assert.equal(f.state(), 'error'); assert.equal(tunnel.stopped, true); assert.equal(f.contexts[0].state, 'closed');
});
test('retry after script failure loads again and succeeds', async () => {
    const f = fixture({ lazy: true }); f.click(); f.scripts[0].onerror(); await flush(); assert.equal(f.state(), 'error');
    f.click(); assert.equal(f.scripts.length, 2); f.loaded(); await flush(); assert.equal(f.players.length, 1); assert.equal(f.state(), 'connecting');
});
test('player construction errors are visible and close the click-created context', async () => {
    const f = fixture({ playerError: true }); f.click(); await flush();
    assert.equal(f.state(), 'error'); assert.equal(f.contexts[0].state, 'closed'); assert.equal(f.tunnels.length, 1);
});
test('late player callbacks cannot change a replacement session', async () => {
    const f = fixture(); f.click(); await flush(); const old = f.players[0];
    f.click(); f.click(); await flush();
    old.opts.onPlayback('blocked', 'old context'); old.opts.onError('old decode'); old.opts.onActivity(true);
    assert.equal(f.state(), 'connecting'); assert.equal(f.players[1].stopped, undefined);
});
