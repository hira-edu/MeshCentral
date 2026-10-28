'use strict';
// A child server that refuses to start (agent binary pins, module version manifest) must stop its parent with
// exit code 1. Upstream's parent restarts any failed child every 5 seconds, which left the service "active" with
// nothing listening. The parent's real launchChildServer runs here against stand-in children.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(repoRoot, 'meshcentral.js'), 'utf8').replace(/\r\n/g, '\n');

function extract(start, endMarker) {
    const from = source.indexOf(start);
    assert.notStrictEqual(from, -1, 'meshcentral.js has ' + start);
    const to = source.indexOf(endMarker, from);
    assert.notStrictEqual(to, -1, 'end of ' + start);
    return source.slice(from, to + endMarker.length);
}

const marker = /const FATAL_STARTUP_MARKER = '([^']+)';/.exec(source);
const launchChild = extract('    obj.launchChildServer = function (startArgs) {', '\n    };\n');
const fatalHelper = extract('    obj.fatalStartupError = function (lines) {', '\n    };\n');

// Runs the parent's launchChildServer with a child script; resolves with what the parent did.
function runParent(t, childSource) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-fatal-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const child = path.join(dir, 'child.js');
    fs.writeFileSync(child, childSource);
    return new Promise((resolve) => {
        const timers = [];
        const sandbox = {
            require, console: { log() { }, error() { } }, Buffer,
            setTimeout: (fn, ms) => { timers.push(ms); resolve({ restartIn: ms }); return 0; },
            process: { argv: [process.execPath], execArgv: [], env: process.env, exit: (code) => resolve({ exit: code, timers }) },
            obj: { args: {}, config: { settings: {} }, parentpath: dir, logError() { } }, childProcess: null,
            FATAL_STARTUP_MARKER: marker[1]
        };
        vm.runInNewContext(launchChild, sandbox);
        sandbox.obj.launchChildServer([child]);
    });
}

test('meshcentral.js defines one fatal-startup marker, used by the child helper and the parent', () => {
    assert.ok(marker, 'FATAL_STARTUP_MARKER constant');
    assert.match(fatalHelper, /console\.log\(FATAL_STARTUP_MARKER\);\n\s*process\.exit\(1\);/);
    assert.match(launchChild, /data\.indexOf\(FATAL_STARTUP_MARKER\) >= 0\) \{ childProcess\.xrestart = 4; \}/);
});

test('both fork startup refusals go through fatalStartupError and never call process.exit themselves', () => {
    const pins = extract('        obj.agentDefaults = require(\'./agentbuilds\').CreateAgentDefaults(obj);', 'obj.agentDefaults.start();');
    assert.strictEqual((pins.match(/obj\.fatalStartupError\(/g) || []).length, 2, pins);
    assert.doesNotMatch(pins, /process\.exit/);
    const modules = extract('    function moduleVersionFailure(message) {', '}');
    assert.match(modules, /obj\.fatalStartupError\(\['agent core module versions: ' \+ message\]\)/);
    assert.doesNotMatch(modules, /process\.exit/);
});

test('a child that prints the marker and exits 1 stops the parent with exit code 1', async (t) => {
    const result = await runParent(t, "console.error('ERROR: fork agent binaries: test');\nconsole.log(" + JSON.stringify(marker[1]) + ");\nprocess.exit(1);\n");
    assert.deepStrictEqual(result, { exit: 1, timers: [] });
});

test('a child that fails without the marker is still restarted (upstream behaviour kept)', async (t) => {
    const result = await runParent(t, "console.error('some crash');\nprocess.exit(1);\n");
    assert.deepStrictEqual(result, { restartIn: 5000 });
});
