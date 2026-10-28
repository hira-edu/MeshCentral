'use strict';

// Executes the Files-tab action handlers of both agent cores (agents/meshcore.js and
// agents/recoverycore.js) in a sandbox: the native Windows file actions and their audit events.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CORES = ['meshcore.js', 'recoverycore.js'];
const sources = {};
for (const core of CORES) { sources[core] = fs.readFileSync(path.join(__dirname, '../../agents', core), 'utf8').replace(/\r\n?/g, '\n'); }

// Returns the text of the function that starts at `signature`, up to its matching closing brace.
function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    assert(start >= 0, 'missing function: ' + signature);
    assert.equal(source.indexOf(signature, start + 1), -1, 'function must be defined once: ' + signature);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; ++i) {
        if (source[i] === '{') { depth++; }
        if (source[i] === '}' && --depth === 0) { return source.slice(start, i + 1); }
    }
    throw new Error('unterminated function: ' + signature);
}

const RIGHTS_ALL = 0xFFFFFFFF;

function loadNativeFileAction(core, fileAction) {
    const state = { native: [], console: [], audit: [] };
    const sandbox = {
        process: { platform: 'win32' }, Buffer, JSON, String,
        sendConsoleText(text, sessionid) { state.console.push({ text: String(text), sessionid }); },
        MeshServerLog(msg, request) { state.audit.push({ msgid: null, args: null, msg, sessionid: request.sessionid }); },
        MeshServerLogEx(msgid, args, msg, request) { state.audit.push({ msgid, args: JSON.parse(JSON.stringify(args)), msg, sessionid: request.sessionid }); },
        require(name) {
            assert.equal(name, 'MeshAgent');
            return { fileAction(action, target, flag) { state.native.push([action, target, flag]); return fileAction ? fileAction(action) : { ok: true }; } };
        }
    };
    vm.runInNewContext(extractFunction(sources[core], 'function nativeFileAction('), sandbox);
    return { sandbox, state };
}

function socket(writes, failure) {
    return { httprequest: { rights: RIGHTS_ALL, sessionid: 'session-1' }, write(data) { if (failure) { throw failure; } writes.push(JSON.parse(data)); } };
}

test('both cores carry the same nativeFileAction', () => {
    assert.equal(extractFunction(sources['recoverycore.js'], 'function nativeFileAction('), extractFunction(sources['meshcore.js'], 'function nativeFileAction('));
});

for (const core of CORES) {
    test(core + ': each native file action is audited as itself', () => {
        const { sandbox, state } = loadNativeFileAction(core);
        const writes = [];
        sandbox.nativeFileAction(socket(writes), { action: 'open', path: 'C:\\a.txt', reqid: 1 });
        sandbox.nativeFileAction(socket(writes), { action: 'delete', path: 'C:\\b.txt', rec: true, reqid: 2 });
        sandbox.nativeFileAction(socket(writes), { action: 'execute', path: 'C:\\c.exe', privileged: true, reqid: 3 });
        assert.deepEqual(state.native, [['open', 'C:\\a.txt', false], ['delete', 'C:\\b.txt', true], ['execute', 'C:\\c.exe', true]]);
        assert.deepEqual(writes.map(w => [w.action, w.operation, w.reqid, w.ok]), [['fileaction', 'open', 1, true], ['fileaction', 'delete', 2, true], ['fileaction', 'execute', 3, true]]);
        // 20 = "Opening: {0}", 45 = "Delete: \"{0}\"". Execute has no translated server message, so its
        // event carries plain text; it must never reuse "Opening".
        assert.deepEqual(state.audit.map(a => [a.msgid, a.args]), [[20, ['C:\\a.txt']], [45, ['C:\\b.txt']], [null, null]]);
        assert.match(state.audit[1].msg, /^Delete recursive: "C:\\b\.txt"/);
        assert.match(state.audit[2].msg, /^Execute privileged: "C:\\c\.exe"/);
        assert(state.audit.every(a => a.sessionid === 'session-1'));
    });

    test(core + ': a failed reply is reported, and the action is still audited', () => {
        const { sandbox, state } = loadNativeFileAction(core);
        const result = sandbox.nativeFileAction(socket(null, new Error('tunnel closed')), { action: 'delete', path: 'C:\\b.txt', reqid: 4 });
        assert.equal(result.ok, true);
        assert.equal(state.audit.length, 1);
        assert.equal(state.audit[0].msgid, 45);
        assert(state.console.some(c => /fileaction reply failed: Error: tunnel closed/.test(c.text) && c.sessionid === 'session-1'),
            'the lost reply must be visible: ' + JSON.stringify(state.console));
    });
}

// The Files tunnel command cases from "case 'rm'" up to the given end marker, as handle(cmd) with the
// tunnel as `this`.
const RM_CASES = { 'meshcore.js': ["case 'rm': {", "case 'markcoredump': {"], 'recoverycore.js': ["case 'rm':", "case 'rename':"] };
function loadFilesCases(core, platform, fileAction, openFileOnDesktop) {
    const source = sources[core];
    const [startMarker, endMarker] = RM_CASES[core];
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert(start >= 0 && end > start, core + ': files rm case must be found');
    const { sandbox, state } = loadNativeFileAction(core, fileAction);
    const pathModule = platform == 'win32' ? path.win32 : path.posix;
    state.deleted = [];
    Object.assign(sandbox, {
        path: pathModule, obj: { path: pathModule },
        deleteFolderRecursive(target, rec) { if (/locked/.test(target)) { throw new Error('EBUSY'); } state.deleted.push([target, rec]); return 1; },
        openFileOnDesktop
    });
    sandbox.process.platform = platform;
    vm.runInNewContext('function handle(cmd) { switch (cmd.action) {\n' + source.slice(start, end) + '\n} }', sandbox);
    const writes = [];
    const tunnel = { httprequest: { rights: RIGHTS_ALL, sessionid: 'session-1' }, write(data) { writes.push(JSON.parse(data)); } };
    return { handle: cmd => sandbox.handle.call(tunnel, cmd), writes, state };
}

for (const core of CORES) {
    for (const platform of ['win32', 'linux']) {
        test(core + ' (' + platform + '): batch delete answers every entry and ends with one rm reply', () => {
            const files = loadFilesCases(core, platform, action => action == 'delete' ? { ok: false, error: 5 } : { ok: true });
            files.handle({ action: 'rm', reqid: 7, path: platform == 'win32' ? 'C:\\dir' : '/dir', rec: false, delfiles: ['..', 'a/b', 42, '', 'locked.txt'] });
            const replies = files.writes.map(w => JSON.parse(JSON.stringify(w)));
            assert(replies.every(r => r.action === 'fileaction' && r.reqid === 7 && r.path === undefined), 'replies never carry path (the viewer reads that as a listing)');
            const rejected = replies.filter(r => r.operation === 'delete' && r.ok === false && r.error === 'Invalid file name.');
            assert.deepEqual(rejected.map(r => r.name), ['..', 'a/b', '42', '']);
            assert.deepEqual(replies[replies.length - 1], { action: 'fileaction', operation: 'rm', reqid: 7, ok: false, done: true, failed: 5 });
            assert.equal(replies.filter(r => r.operation === 'rm').length, 1);
        });

        test(core + ' (' + platform + '): a batch delete without a file list is answered', () => {
            const files = loadFilesCases(core, platform);
            files.handle({ action: 'rm', reqid: 8, path: '/dir', delfiles: 'a.txt' });
            assert.deepEqual(JSON.parse(JSON.stringify(files.writes)), [{ action: 'fileaction', operation: 'rm', reqid: 8, ok: false, done: true, failed: 0, error: 'Invalid delete request.' }]);
        });
    }

    test(core + ': a clean batch delete reports success', () => {
        const files = loadFilesCases(core, 'win32');
        files.handle({ action: 'rm', reqid: 9, path: 'C:\\dir', rec: true, delfiles: ['a.txt', 'b'] });
        assert.deepEqual(files.state.native, [['delete', 'C:\\dir\\a.txt', true], ['delete', 'C:\\dir\\b', true]]);
        const replies = JSON.parse(JSON.stringify(files.writes));
        assert.deepEqual(replies.map(r => [r.operation, r.ok]), [['delete', true], ['delete', true], ['rm', true]]);
    });
}

test('meshcore.js (linux): Files open is audited and answered', () => {
    let opened = null;
    const files = loadFilesCases('meshcore.js', 'linux', null, file => { opened = file; });
    files.handle({ action: 'open', reqid: 3, path: '/home/a.txt' });
    assert.equal(opened, '/home/a.txt');
    assert.deepEqual(files.state.audit.map(a => [a.msgid, a.args, a.sessionid]), [[20, ['/home/a.txt'], 'session-1']]);
    assert.deepEqual(JSON.parse(JSON.stringify(files.writes)), [{ action: 'fileaction', operation: 'open', reqid: 3, ok: true }]);

    const failing = loadFilesCases('meshcore.js', 'linux', null, () => { throw new Error('no desktop session'); });
    failing.handle({ action: 'open', reqid: 4, path: '/home/b.txt' });
    assert.equal(failing.state.audit.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(failing.writes)), [{ action: 'fileaction', operation: 'open', reqid: 4, ok: false, error: 'Error: no desktop session' }]);
});

test('meshcore.js: openFileOnDesktop reports why an open failed', () => {
    for (const [platform, mesh, child, expected] of [
        ['win32', { fileAction: () => ({ ok: false, error: 1155 }) }, null, /Native open failed: 1155/],
        ['win32', {}, null, /Update the agent/],
        ['linux', {}, null, /launch was denied/],
        ['freebsd', {}, null, /not supported on this platform/]]) {
        const sandbox = { process: { platform }, mesh, require(name) {
            if (name === 'child_process') { return { execFile: () => child }; }
            if (name === 'user-sessions') { return { consoleUid: () => 1000 }; }
            throw new Error('unexpected require: ' + name);
        } };
        vm.runInNewContext(extractFunction(sources['meshcore.js'], 'function openFileOnDesktop('), sandbox);
        assert.throws(() => sandbox.openFileOnDesktop('/x'), expected, platform);
    }
});
