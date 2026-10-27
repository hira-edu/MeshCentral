'use strict';

// Execute the production handler: static source contracts cannot detect a second
// marker filter discarding output already filtered by win-terminal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--source'),
    'Usage: node runcommands-terminal-output.test.js [--source <core.js>]');
const sourcePath = args.length === 2 ? path.resolve(args[1]) : path.join(__dirname, '../agents/meshcore.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf("case 'runcommands': {");
const end = source.indexOf("case 'uninstallagent':", start);
assert(start >= 0 && end > start, 'production runcommands handler must be found');
const handler = source.slice(start, end);
const marker = '\x1b]MeshConsoleBridgeReady\x07';

function setup(options = {}) {
    const term = new EventEmitter();
    const replies = [], writes = [], timers = new Map();
    let readyCallback, dataCallback, inputCloses = 0, bridgeCloses = 0;
    term._meshTerminalReady = false;
    term._meshTerminalReadyMarkerProtocol = options.wrapper !== false;
    term._meshTerminalClosed = false;
    term.writeBridgeInput = (text, flush) => { writes.push(text); flush(); };
    term.closeInput = () => { inputCloses++; };
    term.closeBridge = () => { bridgeCloses++; term._meshTerminalClosed = true; term.emit('close'); };
    term.isBridgeReady = () => term._meshTerminalReady;
    if (options.wrapper !== false) {
        term.onBridgeReady = callback => { readyCallback = callback; };
        term.onBridgeData = callback => { dataCallback = callback; };
    }
    if (options.alreadyReady) {
        term._meshTerminalReady = true;
        delete term.onBridgeReady;
    }
    const mesh = { SendCommand: reply => replies.push(reply) };
    const sandbox = {
        mesh,
        data: { action: 'runcommands', reply: true, runAsUser: 0, type: 2,
            cmds: 'Write-Output HEALTH_MARKER', sessionid: 'session-test', responseid: 'response-test' },
        process: { platform: 'win32' },
        sendConsoleText() { throw new Error('Unexpected console reply'); },
        setTimeout(callback, ms) { assert.equal(ms, 300000); timers.set(1, callback); return 1; },
        clearTimeout(id) { timers.delete(id); },
        require(name) {
            assert.equal(name, 'win-terminal');
            return { RunPowerShellCommand() {
                if (options.launchError) throw new Error('launch denied');
                return term;
            } };
        }
    };
    vm.runInNewContext('switch (data.action) {\n' + (options.handler || handler) + '\n}', sandbox);
    return {
        term, mesh, replies, writes, timers,
        ready() { term._meshTerminalReady = true; if (readyCallback) readyCallback(); },
        output(text) { if (dataCallback) dataCallback(Buffer.from(text)); else term.emit('data', Buffer.from(text)); },
        close() { term._meshTerminalClosed = true; term.emit('close'); },
        get inputCloses() { return inputCloses; },
        get bridgeCloses() { return bridgeCloses; }
    };
}

function assertCompleted(probe, result) {
    assert.equal(probe.replies.length, 1, 'exactly one completion reply');
    assert.equal(probe.replies[0].result, result);
    assert.equal(probe.replies[0].action, 'msg');
    assert.equal(probe.replies[0].type, 'runcommands');
    assert.equal(probe.replies[0].responseid, 'response-test');
    assert.equal(probe.replies[0].sessionid, 'session-test');
    assert.equal(probe.mesh.cmdchild, undefined, 'completed child is released');
    assert.equal(probe.timers.size, 0, 'completion clears timeout');
}

// Modern wrapper strips the marker; readiness alone releases input, and plain
// output must survive the core. Repeated readiness/close cannot duplicate work.
const wrapped = setup();
assert.equal(wrapped.writes.length, 0, 'no command before wrapper readiness');
wrapped.ready(); wrapped.ready();
assert.deepEqual(wrapped.writes, ['Write-Output HEALTH_MARKER\r\n']);
assert.equal(wrapped.inputCloses, 1);
wrapped.output('HEALTH_'); wrapped.output('MARKER\r\n');
wrapped.close(); wrapped.close();
assertCompleted(wrapped, 'HEALTH_MARKER\r\n');

// Public readiness polling fallback also supports wrappers without callbacks.
const ready = setup({ alreadyReady: true });
assert.equal(ready.writes.length, 1);
ready.output('READY\r\n'); ready.close();
assertCompleted(ready, 'READY\r\n');

// Advertising the wrapper protocol alone never proves readiness. Its raw marker
// compatibility path remains intact, including markers split across chunks.
for (const wrapper of [false, true]) {
    const legacy = setup({ wrapper });
    legacy.output(marker.slice(0, 11));
    assert.equal(legacy.writes.length, 0, 'partial marker must not release input');
    legacy.output(marker.slice(11) + 'LEGACY\r\n');
    assert.equal(legacy.writes.length, 1);
    legacy.output('TAIL\r\n'); legacy.close();
    assertCompleted(legacy, 'LEGACY\r\nTAIL\r\n');
}

const errored = setup();
errored.term.emit('error', new Error('bridge denied'));
errored.close();
assert.match(errored.replies[0].result, /bridge denied/);
assertCompleted(errored, errored.replies[0].result);
assert.equal(errored.writes.length, 0);

const timedOut = setup();
timedOut.timers.get(1)(); timedOut.close();
assert.match(timedOut.replies[0].result, /timed out through MeshConsoleBridgeW/);
assert.equal(timedOut.bridgeCloses, 1);
assertCompleted(timedOut, timedOut.replies[0].result);

const launchFailed = setup({ launchError: true });
assert.match(launchFailed.replies[0].result, /failed before MeshConsoleBridgeW launch: Error: launch denied/);
assertCompleted(launchFailed, launchFailed.replies[0].result);

// Sensitivity check: removing just the fix reproduces the observed empty result.
const oldHandler = handler.replace(/^.*if \(mesh\.cmdchild != null && mesh\.cmdchild\._meshTerminalReadyMarkerProtocol === true && mesh\.cmdchild\._meshTerminalReady === true\) \{ return text; \}\r?\n/m, '');
assert.notEqual(oldHandler, handler, 'sensitivity check must remove the fix');
const old = setup({ handler: oldHandler });
old.ready(); old.output('HEALTH_MARKER\r\n'); old.close();
assertCompleted(old, '');

console.log('PASS runcommands terminal output: readiness, modern output, legacy split marker, errors, timeout, once-only completion; pre-fix reproduces empty reply');
