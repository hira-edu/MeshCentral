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
