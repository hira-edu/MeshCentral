'use strict';

// Executes the production desktop-audio (tunnel protocol 20) core code from agents/meshcore.js
// inside a sandbox that emulates the Duktape stream semantics the core relies on: write() returns
// false when the socket is backed up, 'drain' releases it, and assigning socket.end adds an 'end'
// listener instead of replacing the method.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--source'),
    'Usage: node desktop-audio-core.test.js [--source <core.js>]');
const sourcePath = args.length === 2 ? path.resolve(args[1]) : path.join(__dirname, '../agents/meshcore.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n?/g, '\n');
const minSource = fs.readFileSync(path.join(__dirname, '../agents/meshcore.min.js'), 'utf8').replace(/\r\n?/g, '\n');

const MESHRIGHT_REMOTECONTROL = 8, MESHRIGHT_REMOTEVIEW = 256, MESHRIGHT_NODESKTOP = 65536;
const AUDIO_STARTED = 2001, AUDIO_STOPPED = 2002, AUDIO_FAILED = 2003;

function slice(text, startMarker, endMarker, name) {
    const start = text.indexOf(startMarker);
    assert(start >= 0, name + ' start marker must be found');
    assert.equal(text.indexOf(startMarker, start + 1), -1, name + ' start marker must be unique');
    const end = text.indexOf(endMarker, start + startMarker.length);
    assert(end > start, name + ' end marker must be found');
    return text.slice(start, end);
}

const helpersMarker = '//\n// Desktop audio (tunnel protocol 20)';
const branchMarker = '} else if (this.httprequest.protocol == DESKTOP_AUDIO_PROTOCOL) {';
const helpers = slice(source, helpersMarker, 'function kvm_tunnel_consentpromise_closehandler()', 'helpers');
const branchBody = slice(source, branchMarker, '} else if (this.httprequest.protocol == 1) {', 'protocol branch').slice(branchMarker.length);
const logEx = slice(source, 'function MeshServerLogEx(id, args, msg, state) {', '\n}\n', 'MeshServerLogEx') + '\n}\n';
const translation = slice(source, 'function setDefaultCoreTranslation(', '\nvar currentTranslation = getCoreTranslation();', 'translation');
const constants = (source.match(/^var (?:MESHRIGHT_[A-Z]+|DESKTOP_AUDIO_[A-Z]+) = .*$/gm) || []).join('\n');
assert.match(constants, /^var DESKTOP_AUDIO_ENABLED = true;$/m, 'operator kill switch must default to enabled');
assert.match(constants, /^var DESKTOP_AUDIO_PROTOCOL = 20;$/m, 'protocol number must be 20');

const program = constants + '\n' + logEx + translation + '\nvar currentTranslation = getCoreTranslation();\n' + helpers +
    '\nfunction audioBranch(data) {' + branchBody + '\n';

// Emulates the agent's relay tunnel socket (a Duktape duplex stream).
class FakeSocket extends EventEmitter {
    constructor(request) {
        super();
        this.httprequest = request;
        request.s = this;
        this.writes = [];
        this.writeResult = true;
        this.ended = false;
        this.tunnel = request;
        this.on('end', () => { // onTunnelClosed: the tunnel leaves the table before protocol listeners run
            if (this.sandbox) { delete this.sandbox.tunnels[request.index]; }
            request.s = null;
        });
    }
    write(data) {
        if (this.ended) { throw new Error('write after end'); }
        this.writes.push(data);
        return this.writeResult;
    }
    get end() { return () => { if (this.ended) return; this.ended = true; this.emit('end'); }; }
    set end(listener) { this.on('end', listener); }
    get ctrl() { return this.writes.filter(w => typeof w === 'string').map(w => JSON.parse(w)); }
    get audio() { return this.ctrl.filter(m => m.type === 'audio'); }
    get binary() { return this.writes.filter(w => Buffer.isBuffer(w)); }
}

// The agent runs on Duktape, whose Buffer.from(buffer) returns an EMPTY buffer (verified on the agent
// binary). Node's copies correctly, so without this the tests would pass code that breaks on the agent.
const DuktapeBuffer = {
    alloc: (size, fill) => Buffer.alloc(size, fill),
    isBuffer: value => Buffer.isBuffer(value),
    concat: (list, length) => Buffer.concat(list, length),
    byteLength: (value, encoding) => Buffer.byteLength(value, encoding),
    from: (value, encodingOrOffset, length) => Buffer.isBuffer(value) ? Buffer.alloc(0) : Buffer.from(value, encodingOrOffset, length)
};

class FakeSession extends EventEmitter {
    constructor(tsid) { super(); this.tsid = tsid; this.closed = 0; }
    close() { this.closed++; }
}

function createSandbox(options = {}) {
    const state = {
        logs: [], local: [], toasts: [], bars: [], console: [], opened: [],
        supported: options.supported !== false, disabled: options.disabled === true, missing: options.missing === true,
        openError: options.openError || null
    };
    const module = {
        supported: () => state.supported,
        disabled: () => state.disabled,
        open(tsid) {
            if (state.openError) { throw state.openError; }
            const session = new FakeSession(tsid);
            state.opened.push(session);
            return session;
        }
    };
    const sandbox = {
        Buffer: DuktapeBuffer, String, JSON, Object,
        global: {},
        tunnels: {},
        color_options: { background: '0,0,0', foreground: '1,1,1' },
        mesh: { SendCommand: msg => state.logs.push(msg) },
        sendConsoleText: text => state.console.push(text),
        onTunnelControlData() { },
        require(name) {
            switch (name) {
                case 'desktop-audio': if (state.missing) throw new Error('module not found'); return module;
                case 'MeshAgent': return { _tsid: null, log: line => state.local.push(line) };
                case 'toaster': return { Toast: (title, msg, tsid) => state.toasts.push({ title, msg, tsid }) };
                case 'notifybar-desktop': return (text, tsid, colors) => {
                    if (state.barError) { throw new Error('no bar'); }
                    const bar = new EventEmitter();
                    bar.text = text; bar.tsid = tsid; bar.colors = colors; bar.closed = 0;
                    bar.close = () => { bar.closed++; };
                    state.bars.push(bar);
                    return bar;
                };
                default: throw new Error('unexpected require: ' + name);
            }
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(program, sandbox);
    sandbox.state = state;
    return sandbox;
}

let nextIndex = 1;
function request(fields) {
    return Object.assign({
        index: nextIndex++, protocol: 0, rights: MESHRIGHT_REMOTEVIEW, consent: 0, soptions: null,
        userid: 'user//alice', xuserid: 'user//alice', username: 'alice', realname: 'Alice', sessionid: 'session-a',
        remoteaddr: '198.51.100.7', privacybartext: 'Sharing desktop with: {0}', xoptions: {}
    }, fields);
}

// A desktop tunnel that completed consent through kvm_consent_ok / kvm_consentpromise_resolved.
function addDesktop(sandbox, fields = {}, tsid = 1) {
    const kvm = fields.kvm || { rusers: ['Alice'], users: ['alice'], connectionBar: null, _pipedStreams: [], end() { this.endedKvm = true; } };
    const req = request(Object.assign({ protocol: 2, xoptions: tsid == null ? {} : { tsid } }, fields));
    const ws = new FakeSocket(req);
    ws.sandbox = sandbox;
    ws.tsid = tsid;
    req.desktop = { state: 1, kvm, tunnel: ws };
    sandbox.tunnels[req.index] = req;
    if (fields.consented !== false) { sandbox.desktop_audio_desktopReady(ws); }
    return { req, ws, kvm };
}

function openAudio(sandbox, fields = {}, tsid = 1) {
    const req = request(Object.assign({ xoptions: tsid == null ? {} : { tsid } }, fields));
    req.protocol = 20;
    const ws = new FakeSocket(req);
    ws.sandbox = sandbox;
    sandbox.tunnels[req.index] = req;
    sandbox.audioBranch.call(ws, '20');
    return { req, ws, session: sandbox.state.opened[sandbox.state.opened.length - 1] || null };
}

// Sandbox objects carry the context's own prototypes; copy them so strict deep equality works.
function logsWithId(sandbox, msgid) { return sandbox.state.logs.filter(l => l.action === 'log' && l.msgid === msgid).map(l => JSON.parse(JSON.stringify(l))); }

test('capability is advertised on the consented desktop tunnel only when audio can be offered', () => {
    const sandbox = createSandbox();
    const desktop = addDesktop(sandbox);
    assert.equal(desktop.req.desktop.consented, true);
    assert.deepEqual(desktop.ws.audio, [{ ctrlChannel: '102938', type: 'audio', state: 'available', protocol: 20, tsid: 1 }]);
    const consoleDesktop = addDesktop(createSandbox(), {}, null);
    assert.strictEqual(consoleDesktop.ws.audio[0].tsid, null, 'the console session is advertised as tsid null');

    for (const options of [{ supported: false }, { disabled: true }, { missing: true }]) {
        const quiet = createSandbox(options);
        const silent = addDesktop(quiet);
        assert.equal(silent.req.desktop.consented, true, 'consent is recorded regardless of audio support');
        assert.deepEqual(silent.ws.writes, [], 'no advertisement for ' + JSON.stringify(options));
    }

    const killed = createSandbox();
    vm.runInContext('DESKTOP_AUDIO_ENABLED = false;', killed);
    const off = addDesktop(killed);
    assert.deepEqual(off.ws.writes, [], 'kill switch suppresses the advertisement');
    const refused = openAudio(killed);
    assert.equal(refused.ws.audio[0].state, 'unavailable');
    assert.equal(killed.state.opened.length, 0);
});

test('audio needs the requesting user\'s own desktop rights', () => {
    const sandbox = createSandbox();
    addDesktop(sandbox);
    for (const rights of [0, MESHRIGHT_REMOTEVIEW | MESHRIGHT_NODESKTOP, MESHRIGHT_REMOTECONTROL | MESHRIGHT_NODESKTOP]) {
        const audio = openAudio(sandbox, { rights, userid: 'user//bob', username: 'bob', realname: 'Bob' });
        assert.deepEqual(audio.ws.audio, [{ ctrlChannel: '102938', type: 'audio', state: 'denied', reason: 'No desktop rights' }]);
        assert.equal(audio.ws.ended, true);
        assert.equal(audio.req.protocol, 999999, 'tunnel is disengaged like the other protocols');
        assert.equal(sandbox.tunnels[audio.req.index], undefined);
    }
    assert.equal(sandbox.state.opened.length, 0, 'the helper is never started');
    const failures = logsWithId(sandbox, AUDIO_FAILED);
    assert.equal(failures.length, 3);
    assert.deepEqual(failures[0].msgArgs, ['1', 'denied', 'No desktop rights']);
    assert.equal(failures[0].userid, 'user//bob');
    assert.equal(failures[0].sessionid, 'session-a');
    assert.equal(sandbox.state.local.length, 3, 'local audit record per refusal');
    assert.match(sandbox.state.console[0], /No Desktop Audio Rights/);

    for (const rights of [MESHRIGHT_REMOTEVIEW, MESHRIGHT_REMOTECONTROL, 0xFFFFFFFF]) {
        const ok = openAudio(sandbox, { rights });
        assert.equal(ok.ws.audio.length, 0, 'no refusal for rights ' + rights);
        assert.equal(ok.session.tsid, 1);
    }
});

test('unavailable when the module is missing, unsupported or disabled on the device', () => {
    for (const options of [{ missing: true }, { supported: false }, { disabled: true }]) {
        const sandbox = createSandbox(options);
        addDesktop(sandbox);
        const audio = openAudio(sandbox);
        assert.equal(audio.ws.audio[0].state, 'unavailable', JSON.stringify(options));
        assert.equal(audio.ws.ended, true);
        assert.equal(logsWithId(sandbox, AUDIO_FAILED)[0].msgArgs[1], 'unavailable');
    }
});

test('a tunnel the relay announced as recorded never carries audio', () => {
    const sandbox = createSandbox();
    addDesktop(sandbox);
    const recorded = openAudio(sandbox, { relayRecorded: true });
    assert.equal(recorded.ws.audio[0].state, 'unavailable');
    assert.match(recorded.ws.audio[0].reason, /recorded/);
    assert.equal(recorded.ws.ended, true);
    assert.equal(sandbox.state.opened.length, 0, 'the helper is never started');
    assert.deepEqual(recorded.ws.binary, [], 'no audio bytes reach the recorded relay');
    assert.equal(logsWithId(sandbox, AUDIO_FAILED)[0].msgArgs[1], 'unavailable');

    const live = openAudio(sandbox, { relayRecorded: false });
    assert.equal(live.ws.audio.length, 0, 'an unrecorded tunnel is admitted');
    assert.equal(sandbox.state.opened.length, 1);
});

test('nodesktop without a consented desktop tunnel on the same tsid', () => {
    const sandbox = createSandbox();
    const probe = () => { const states = openAudio(sandbox).ws.audio; return states.length ? states[0].state : undefined; };
    assert.equal(probe(), 'nodesktop', 'no desktop at all');
    const pending = addDesktop(sandbox, { consented: false });
    assert.equal(probe(), 'nodesktop', 'desktop still waiting for consent');
    addDesktop(sandbox, {}, 2);
    assert.equal(probe(), 'nodesktop', 'consented desktop on another tsid');
    sandbox.desktop_audio_desktopReady(pending.ws);
    assert.equal(probe(), undefined, 'consented desktop on the tsid admits audio');
    assert.equal(logsWithId(sandbox, AUDIO_FAILED).length, 3);
    assert.equal(sandbox.state.opened.length, 1);

    const consoleSession = createSandbox();
    addDesktop(consoleSession, {}, null);
    const audio = openAudio(consoleSession, {}, null);
    assert.equal(audio.ws.audio.length, 0);
    assert.equal(audio.session.tsid, null, 'console session (no tsid) matches the console desktop');
});

test('packets stream live as binary messages and are dropped while the socket is backed up', () => {
    const sandbox = createSandbox();
    addDesktop(sandbox, { consent: 1 });
    const audio = openAudio(sandbox, { userid: 'user//bob', username: 'bob', realname: 'Bob' });
    assert.equal(audio.ws.listenerCount('drain'), 1);

    audio.session.emit('status', { state: 'started' });
    assert.deepEqual(audio.ws.audio, [{ ctrlChannel: '102938', type: 'audio', state: 'started' }]);
    assert.equal(logsWithId(sandbox, AUDIO_STARTED).length, 1);
    assert.equal(logsWithId(sandbox, AUDIO_STARTED)[0].userid, 'user//bob');
    audio.session.emit('status', { state: 'started' });
    assert.equal(logsWithId(sandbox, AUDIO_STARTED).length, 1, 'a repeated start is not audited twice');

    const packets = [1, 2, 3, 4, 5].map(n => Buffer.from([1, 2, 0, 0, n, 0, 0, 0]));
    audio.session.emit('packet', packets[0]);
    assert.deepEqual(audio.ws.binary, [packets[0]]);
    audio.ws.writeResult = false;
    audio.session.emit('packet', packets[1]);
    assert.deepEqual(audio.ws.binary, [packets[0], packets[1]], 'the packet that saw backpressure was still handed to the socket');
    audio.ws.writeResult = true;
    audio.session.emit('packet', packets[2]);
    assert.deepEqual(audio.ws.binary, [packets[0], packets[1]], 'dropped until drain, never queued');
    audio.ws.emit('drain');
    audio.session.emit('packet', packets[3]);
    assert.deepEqual(audio.ws.binary.map(b => b[4]), [1, 2, 4]);
    assert.equal(audio.ws.binary[2].readUInt16LE(2) & 1, 1);

    const stray = new FakeSession(1);
    stray.ws = audio.ws;
    sandbox.desktop_audio_onPacket.call(stray, packets[4]);
    assert.equal(audio.ws.binary.length, 3, 'packets from a session that is not the tunnel\'s are ignored');
});

test('notification follows the desktop session: toast and privacy bar only where the desktop shows them', () => {
    const silent = createSandbox();
    addDesktop(silent, { consent: 0 });
    const quiet = openAudio(silent);
    quiet.session.emit('status', { state: 'started' });
    quiet.session.emit('status', { state: 'stopped' });
    assert.deepEqual(silent.state.toasts, []);
    assert.deepEqual(silent.state.bars, []);
    assert.equal(logsWithId(silent, AUDIO_STARTED).length, 1, 'audit is independent of notification');
    assert.equal(logsWithId(silent, AUDIO_STOPPED).length, 1);

    const sandbox = createSandbox();
    const desktop = addDesktop(sandbox, { consent: 1 | 0x40, soptions: { notifyTitle: 'Support' } });
    const firstBar = new EventEmitter();
    firstBar.close = () => { firstBar.closed = true; };
    firstBar.httprequest = desktop.req;
    desktop.kvm.connectionBar = firstBar;
    const audio = openAudio(sandbox, { userid: 'user//bob', username: 'bob', realname: 'Bob' });
    audio.session.emit('status', { state: 'started' });
    assert.deepEqual(sandbox.state.toasts, [{ title: 'Support', msg: 'Bob started listening to this computer\'s audio.', tsid: 1 }]);
    assert.equal(firstBar.closed, true, 'the bar is recreated with the audio state');
    assert.equal(sandbox.state.bars.length, 1);
    assert.equal(sandbox.state.bars[0].text, 'Sharing desktop with: Alice - audio on');
    // require('MeshAgent')._tsid is a global later tunnels overwrite (null in this sandbox); the bar
    // must stay on the desktop tunnel's own session.
    assert.equal(sandbox.state.bars[0].tsid, 1, 'the recreated bar stays on the desktop session');
    assert.equal(desktop.kvm.connectionBar, sandbox.state.bars[0]);
    assert.equal(desktop.kvm.connectionBar.audio, true);
    assert.equal(desktop.kvm.connectionBar.httprequest, desktop.req);
    assert.equal(logsWithId(sandbox, 31).length, 1, 'bar update is logged like the desktop code does');

    sandbox.desktop_audio_updateBar(1);
    assert.equal(sandbox.state.bars.length, 1, 'unchanged audio state does not recreate the bar');

    audio.session.emit('status', { state: 'stopped' });
    assert.equal(sandbox.state.toasts[1].msg, 'Bob stopped listening to this computer\'s audio.');
    assert.equal(sandbox.state.bars.length, 2);
    assert.equal(sandbox.state.bars[1].text, 'Sharing desktop with: Alice');
    assert.equal(sandbox.state.bars[1].audio, false);

    // The local user closing the recreated bar ends the desktop session exactly as before, even after
    // tunnel_kvm_end cleared the bar's httprequest because another desktop tunnel ended.
    sandbox.state.bars[1].httprequest = null;
    sandbox.state.bars[1].emit('close');
    assert.equal(desktop.kvm.endedKvm, true);
    assert.equal(logsWithId(sandbox, 29).length, 1);
});

test('helper failure ends the tunnel with the mapped state and audits failure and stop', () => {
    const sandbox = createSandbox();
    addDesktop(sandbox);
    const audio = openAudio(sandbox);
    audio.session.emit('status', { state: 'started' });
    audio.session.emit('status', { state: 'error', code: 0x8889000A, reason: 'AUDCLNT_E_DEVICE_INVALIDATED' });
    assert.deepEqual(audio.ws.audio[1], { ctrlChannel: '102938', type: 'audio', state: 'error', code: 0x8889000A, reason: 'AUDCLNT_E_DEVICE_INVALIDATED' });
    assert.equal(audio.session.closed, 1);
    assert.equal(audio.ws.ended, true);
    assert.equal(audio.req.audio, undefined);
    assert.equal(audio.ws.listenerCount('drain'), 0);
    assert.deepEqual(logsWithId(sandbox, AUDIO_FAILED)[0].msgArgs, ['1', 'error', 'AUDCLNT_E_DEVICE_INVALIDATED']);
    assert.equal(logsWithId(sandbox, AUDIO_STOPPED).length, 1);
    audio.session.emit('close');
    audio.session.emit('status', { state: 'error' });
    assert.equal(audio.ws.audio.length, 2, 'late helper events after release are ignored');

    const early = createSandbox();
    addDesktop(early);
    const unavailable = openAudio(early);
    unavailable.session.emit('status', { state: 'unavailable', reason: 'no render device' });
    assert.equal(unavailable.ws.audio[0].state, 'unavailable');
    assert.equal(logsWithId(early, AUDIO_FAILED).length, 1);
    assert.equal(logsWithId(early, AUDIO_STOPPED).length, 0, 'never started, so no stop record');

    const unknown = createSandbox();
    addDesktop(unknown);
    const odd = openAudio(unknown);
    odd.session.emit('status', { state: 'bogus' });
    assert.equal(odd.ws.audio[0].state, 'error', 'unknown helper states map to error');

    const closed = createSandbox();
    addDesktop(closed);
    const gone = openAudio(closed);
    gone.session.emit('close');
    assert.equal(gone.ws.audio[0].state, 'stopped', 'helper exit without status is a stop');

    const broken = createSandbox({ openError: new Error('rundll32 launch denied') });
    addDesktop(broken);
    const failed = openAudio(broken);
    assert.equal(failed.ws.audio[0].state, 'error');
    assert.match(failed.ws.audio[0].reason, /rundll32 launch denied/);
    assert.equal(failed.ws.ended, true);
    assert.equal(failed.req.audio, undefined);
});

test('the desktop session ending closes its audio tunnels, unless another consented desktop remains', () => {
    const sandbox = createSandbox();
    const first = addDesktop(sandbox, { consent: 0x40 });
    const second = addDesktop(sandbox, { consent: 0x40, kvm: first.kvm, userid: 'user//carol', username: 'carol', realname: 'Carol' });
    const other = addDesktop(sandbox, {}, 2);
    const audio = openAudio(sandbox);
    audio.session.emit('status', { state: 'started' });
    const otherAudio = openAudio(sandbox, {}, 2);
    otherAudio.session.emit('status', { state: 'started' });

    // tunnel_kvm_end rebuilt the bar without audio state before calling in; it is restored.
    const rebuilt = new EventEmitter(); rebuilt.close = () => { rebuilt.closed = true; };
    first.kvm.connectionBar = rebuilt;
    delete sandbox.tunnels[first.req.index];
    sandbox.desktop_audio_desktopClosed(first.ws);
    assert.equal(audio.ws.ended, false, 'a consented desktop remains on tsid 1');
    assert.equal(rebuilt.closed, true);
    assert.equal(first.kvm.connectionBar.text, 'Sharing desktop with: Alice - audio on');
    assert.equal(first.kvm.connectionBar.httprequest, second.req, 'the bar follows the remaining desktop session');

    delete sandbox.tunnels[second.req.index];
    sandbox.desktop_audio_desktopClosed(second.ws);
    assert.equal(audio.ws.ended, true);
    assert.deepEqual(audio.ws.audio[1], { ctrlChannel: '102938', type: 'audio', state: 'stopped', reason: 'Remote desktop session ended' });
    assert.equal(audio.session.closed, 1);
    assert.equal(logsWithId(sandbox, AUDIO_STOPPED).length, 1);
    assert.equal(otherAudio.ws.ended, false, 'audio on another tsid is untouched');

    delete sandbox.tunnels[other.req.index];
    sandbox.desktop_audio_desktopClosed(other.ws);
    assert.equal(otherAudio.ws.ended, true);
});

test('the viewer or server closing the tunnel releases the helper without writing to the socket', () => {
    const sandbox = createSandbox();
    addDesktop(sandbox);
    const audio = openAudio(sandbox);
    audio.session.emit('status', { state: 'started' });
    const writes = audio.ws.writes.length;
    audio.ws.end();
    assert.equal(audio.session.closed, 1);
    assert.equal(audio.ws.writes.length, writes);
    assert.equal(audio.req.audio, undefined);
    assert.equal(logsWithId(sandbox, AUDIO_STOPPED).length, 1);
    audio.ws.end();
    assert.equal(logsWithId(sandbox, AUDIO_STOPPED).length, 1, 'release is idempotent');
});

test('multiplexed desktop: one agent-side desktop tunnel admits audio for other rightful users', () => {
    const sandbox = createSandbox();
    addDesktop(sandbox, { userid: 'user//alice', consent: 1 });
    const bob = openAudio(sandbox, { userid: 'user//bob', username: 'bob', realname: 'Bob', rights: MESHRIGHT_REMOTEVIEW });
    assert.equal(bob.ws.audio.length, 0);
    bob.session.emit('status', { state: 'started' });
    assert.equal(sandbox.state.toasts[0].msg, 'Bob started listening to this computer\'s audio.');
    const carol = openAudio(sandbox, { userid: 'user//carol', username: 'carol', realname: 'Carol', rights: MESHRIGHT_REMOTEVIEW | MESHRIGHT_NODESKTOP });
    assert.equal(carol.ws.audio[0].state, 'denied');
    assert.equal(sandbox.desktop_audio_listeners(1), 1);
});

test('static contract: consent paths advertise, tunnel_kvm_end closes, and meshcore.min.js carries the same code', () => {
    const consentOk = slice(source, 'function kvm_consent_ok(ws) {', '\nfunction kvm_consent_ask(ws){', 'kvm_consent_ok');
    assert(consentOk.indexOf('desktop.kvm.pipe(ws, { dataTypeSkip: 1 });') < consentOk.indexOf('desktop_audio_desktopReady(ws);'), 'advertise after the stream is piped');
    const resolved = slice(source, 'function kvm_consentpromise_resolved(always)', '\nfunction files_consent_ok(ws){', 'kvm_consentpromise_resolved');
    assert(resolved.indexOf('this.ws.resume();') < resolved.indexOf('desktop_audio_desktopReady(this.ws);'), 'advertise once the tunnel is resumed');
    assert(resolved.indexOf('desktop_audio_desktopReady(this.ws);') < resolved.indexOf('this.ws = null;'), 'advertise before the scope is released');
    const kvmEnd = slice(source, 'function tunnel_kvm_end()', '\nfunction kvm_tunnel_consentpromise_closehandler()', 'tunnel_kvm_end');
    const closedAt = kvmEnd.indexOf('desktop_audio_desktopClosed(this);');
    assert(closedAt > kvmEnd.indexOf('connectionBar.httprequest = null;'), 'audio teardown runs after the desktop bar bookkeeping');
    assert(closedAt < kvmEnd.lastIndexOf('this.httprequest = null;'), 'audio teardown runs while the request is still attached');
    assert.equal(source.split('desktop_audio_desktopReady(').length, 4, 'exactly two call sites plus the definition');
    assert.match(source, /protocol == 0\) \{ \/\/ 1 = Terminal \(admin\).*20 = Desktop Audio/);

    for (const marker of [helpersMarker, branchMarker, '\nvar DESKTOP_AUDIO_ENABLED = true;\n', 'desktop_audio_desktopReady(this.ws);', 'desktop_audio_desktopClosed(this);', "setDefaultCoreTranslation(ret, 'privacyBarAudio', 'audio on');"]) {
        assert(minSource.indexOf(marker) >= 0, 'meshcore.min.js must carry: ' + marker.trim().slice(0, 40));
    }
    assert.equal(slice(minSource, helpersMarker, 'function kvm_tunnel_consentpromise_closehandler()', 'min helpers'), helpers, 'helper block identical in meshcore.min.js');
    assert.equal(slice(minSource, branchMarker, '} else if (this.httprequest.protocol == 1) {', 'min branch').slice(branchMarker.length), branchBody, 'protocol branch identical in meshcore.min.js');
});

test('backpressure retains the latest CONFIG and resumes at a discontinuity without retaining audio', () => {
    const sandbox = createSandbox(); addDesktop(sandbox); const audio = openAudio(sandbox);
    function frame(type, sequence) { const b = Buffer.alloc(type === 1 ? 32 : 17); b[0] = 1; b[1] = type; b.writeUInt32LE(sequence, 4); b.writeUInt32LE(b.length - 16, 12); return b; }
    const first = frame(2, 1), config = frame(1, 2), newer = frame(1, 3), dropped = frame(2, 4), live = frame(2, 5);
    audio.ws.writeResult = false; audio.session.emit('packet', first);
    audio.session.emit('packet', config); audio.session.emit('packet', newer); audio.session.emit('packet', dropped);
    audio.ws.writeResult = true; audio.ws.emit('drain'); audio.session.emit('packet', live);
    assert.deepEqual(audio.ws.binary.map(b => b.readUInt32LE(4)), [1, 3, 5]);
    assert.equal(audio.ws.binary.at(-1).readUInt16LE(2) & 1, 1, 'signal the dropped interval');
    assert.equal(live.readUInt16LE(2), 0, 'never mutate packets shared with other listeners');
});
