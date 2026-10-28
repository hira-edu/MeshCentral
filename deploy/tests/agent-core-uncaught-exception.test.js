'use strict';

// agents/meshcore.js reports uncaught exceptions on the server console (sendMeshCoreConsole). When the
// console channel cannot be used, the report goes to the agent's own console with the reason it could
// not be sent; it is never dropped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../agents/meshcore.js'), 'utf8').replace(/\r\n?/g, '\n');

function extractFunction(signature) {
    const start = source.indexOf(signature);
    assert(start >= 0, 'missing function: ' + signature);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; ++i) {
        if (source[i] === '{') { depth++; }
        if (source[i] === '}' && --depth === 0) { return source.slice(start, i + 1); }
    }
    throw new Error('unterminated function: ' + signature);
}

function load(agent) {
    const state = { sent: [], printed: [] };
    const sandbox = {
        console: { error(text) { state.printed.push(String(text)); } },
        require(name) { assert.equal(name, 'MeshAgent'); if (agent instanceof Error) { throw agent; } return agent; }
    };
    vm.runInNewContext(extractFunction('function formatUncaughtException(ex)') + '\n' + extractFunction('function sendMeshCoreConsole(text, sessionid)'), sandbox);
    return { sandbox, state };
}

test('an uncaught exception is sent to the server console with its stack', () => {
    const run = load({ SendCommand(msg) { run.state.sent.push(JSON.parse(JSON.stringify(msg))); } });
    const error = new Error('boom');
    assert.equal(run.sandbox.sendMeshCoreConsole('uncaughtException1: ' + run.sandbox.formatUncaughtException(error), 's-1'), true);
    assert.equal(run.state.sent.length, 1);
    assert.equal(run.state.sent[0].action, 'msg');
    assert.equal(run.state.sent[0].type, 'console');
    assert.equal(run.state.sent[0].sessionid, 's-1');
    assert.match(run.state.sent[0].value, /^uncaughtException1: Error: boom\n {4}at /);
    assert.deepEqual(run.state.printed, []);
});

test('when the server console cannot be used, the agent console gets the report and the reason', () => {
    const failing = load({ SendCommand() { throw new Error('not connected'); } });
    assert.equal(failing.sandbox.sendMeshCoreConsole('report', null), false);
    assert.deepEqual(failing.state.printed, ['report (not sent to the server: Error: not connected)']);

    const missing = load(new Error('no MeshAgent'));
    assert.equal(missing.sandbox.sendMeshCoreConsole('report', null), false);
    assert.deepEqual(missing.state.printed, ['report (not sent to the server: Error: no MeshAgent)']);

    const old = load({});
    assert.equal(old.sandbox.sendMeshCoreConsole('report', null), false);
    assert.deepEqual(old.state.printed, ['report (not sent to the server: the agent has no SendCommand)']);
});
