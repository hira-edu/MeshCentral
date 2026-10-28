'use strict';

// Which Windows session a user terminal (tunnel protocols 8 and 9) runs in, for both agent cores.
// The served win-terminal SelectUserSession decides: the viewer's choice, else the console user, else
// the only active user session; anything else is refused. A user terminal never falls back to
// another user's session or to the agent's own (SYSTEM) token.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stream = require('node:stream');

const agents = path.join(__dirname, '../../agents');
const read = name => fs.readFileSync(path.join(agents, name), 'utf8').replace(/\r\n?/g, '\n');
const terminalSource = read('modules_meshcore/win-terminal.js');
const meshcore = read('meshcore.js');
const recoverycore = read('recoverycore.js');

// Returns the text of the brace block that starts at the first '{' after `marker`.
function extractBlock(source, marker, from = 0) {
    const start = source.indexOf(marker, from);
    assert(start >= 0, 'missing: ' + marker);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; ++i) {
        if (source[i] === '{') { depth++; }
        if (source[i] === '}' && --depth === 0) { return source.slice(start, i + 1); }
    }
    throw new Error('unterminated block: ' + marker);
}

// sessions: { active: [ids], console: id | Error }
function loadSelect(sessions) {
    const sandbox = {
        process: { platform: 'win32', pid: 1 }, module: { exports: {} }, Buffer, Date, Error, parseInt, isFinite,
        require(name) {
            if (name === 'user-sessions') {
                return {
                    Current() { return { Active: sessions.active.map(id => ({ SessionId: id, State: 'Active' })) }; },
                    consoleUid() { if (sessions.console instanceof Error) { throw sessions.console; } return sessions.console; }
                };
            }
            if (name === 'stream') { return stream; }
            if (name === 'child_process' || name === 'net') { return {}; }
            throw new Error('unexpected require: ' + name);
        }
    };
    vm.runInNewContext(terminalSource, sandbox);
    return requested => sandbox.module.exports.SelectUserSession(requested);
}

test('SelectUserSession: the viewer selection wins and must be an active user session', () => {
    const select = loadSelect({ active: [1, 2], console: 1 });
    assert.equal(select(2), 2);
    assert.throws(() => select(7), /the selected session 7 has no active user/);
    assert.throws(() => select(0), /the selected session 0 has no active user/);
});

test('SelectUserSession: without a selection, the console user, then the only active user', () => {
    assert.equal(loadSelect({ active: [1, 2], console: 2 })(null), 2);
    assert.equal(loadSelect({ active: [4], console: new Error('Nobody logged in') })(null), 4);
    assert.equal(loadSelect({ active: [4], console: 1 })(null), 4, 'a console session without an active user is not a user session');
});

test('SelectUserSession: no user, or several users and no choice, is refused', () => {
    assert.throws(() => loadSelect({ active: [], console: 1 })(null), /no active user session found/);
    assert.throws(() => loadSelect({ active: [2, 3], console: new Error('Nobody logged in') })(null),
        /several user sessions are active and none was selected \(console: Error: Nobody logged in\)/);
    assert.throws(() => loadSelect({ active: [2, 3], console: 1 })(null), /several user sessions .*session 1 has no active user/);
});

// meshcore: terminal_promise_consent_resolved on Windows with the tunnel's tsid.
function runMeshcore(protocol, tsid, sessions) {
    const started = [], results = [];
    const select = loadSelect(sessions);
    function Promise() { this.then = () => { }; }
    const sandbox = {
        process: { platform: 'win32' },
        promise: function (init) { const p = new Promise(); init.call(p, v => results.push(['res', v]), e => results.push(['rej', e])); return p; },
        promise_init(res, rej) { this._res = res; this._rej = rej; },
        terminal_promise_connection_resolved() { }, terminal_promise_connection_rejected() { },
        require(name) {
            assert.equal(name, 'win-terminal');
            return {
                SelectUserSession: select,
                Start(cols, rows, id) { started.push(['Start', cols, rows, id]); return 'terminal'; },
                StartPowerShell(cols, rows, id) { started.push(['StartPowerShell', cols, rows, id]); return 'terminal'; }
            };
        }
    };
    const program = extractBlock(meshcore, 'function terminal_windows_start(') + '\n' + extractBlock(meshcore, 'function terminal_promise_consent_resolved(');
    vm.runInNewContext(program, sandbox);
    const tpromise = { that: { tsid }, httprequest: { protocol, xoptions: { cols: 100, rows: 30 } } };
    sandbox.terminal_promise_consent_resolved.call(tpromise);
    return { started, results };
}

test('meshcore.js: the user terminal starts in the selected session', () => {
    const run = runMeshcore(9, 2, { active: [1, 2], console: 1 });
    assert.deepEqual(run.started, [['StartPowerShell', 100, 30, 2]]);
    assert.deepEqual(run.results, [['res', 'terminal']]);
});

test('meshcore.js: the user terminal never falls back to another user session', () => {
    const run = runMeshcore(8, null, { active: [2, 3], console: new Error('Nobody logged in') });
    assert.deepEqual(run.started, []);
    assert.equal(run.results.length, 1);
    assert.equal(run.results[0][0], 'rej');
    assert.match(run.results[0][1], /^Failed to start remote terminal session, Error: several user sessions are active and none was selected/);
});

test('meshcore.js: the admin terminal keeps the agent token', () => {
    const run = runMeshcore(1, 2, { active: [], console: 1 });
    assert.deepEqual(run.started, [['Start', 100, 30, null]]);
});

// recoverycore: the Windows terminal block of the tunnel data handler, with the tunnel as `this`.
function runRecovery(protocol, tsid, sessions) {
    const marker = '// Remote Terminal';
    const block = extractBlock(recoverycore, 'if (process.platform == "win32") {', recoverycore.indexOf(marker));
    const started = [], written = [];
    let ended = 0;
    const select = loadSelect(sessions);
    const sandbox = {
        process: { platform: 'win32' }, JSON,
        sendConsoleText() { },
        require(name) {
            assert.equal(name, 'win-terminal');
            const terminal = (method) => (cols, rows, id) => { started.push([method, cols, rows, id]); return { pipe() { } }; };
            return { SelectUserSession: select, Start: terminal('Start'), StartPowerShell: terminal('StartPowerShell') };
        }
    };
    vm.runInNewContext('function terminal() {\n' + block + '\n}', sandbox);
    const tunnel = {
        httprequest: { protocol, xoptions: (tsid == null) ? { cols: 90, rows: 20 } : { cols: 90, rows: 20, tsid } },
        write(data) { written.push(JSON.parse(data)); }, end() { ended++; }, pipe() { }, prependListener() { }
    };
    sandbox.terminal.call(tunnel);
    return { started, written, ended };
}

test('recoverycore.js: a user terminal without a user session is refused, not started as SYSTEM', () => {
    const run = runRecovery(9, null, { active: [], console: new Error('Nobody logged in') });
    assert.deepEqual(run.started, []);
    assert.equal(run.ended, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(run.written)), [{ ctrlChannel: '102938', type: 'console', msg: 'Failed to start remote terminal session, Error: no active user session found', msgid: 2 }]);
});

test('recoverycore.js: the user terminal starts in the selected or console session', () => {
    assert.deepEqual(runRecovery(8, 3, { active: [1, 3], console: 1 }).started, [['Start', 90, 20, 3]]);
    assert.deepEqual(runRecovery(9, null, { active: [1, 3], console: 1 }).started, [['StartPowerShell', 90, 20, 1]]);
    assert.deepEqual(runRecovery(6, null, { active: [], console: 1 }).started, [['StartPowerShell', 90, 20, null]], 'the admin terminal keeps the agent token');
});
