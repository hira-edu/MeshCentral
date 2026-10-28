'use strict';

// Runs the Windows run-commands path of both agent cores (agents/meshcore.js 'runcommands' and
// agents/recoverycore.js recoveryRunCommands) against the served win-terminal module
// (agents/modules_meshcore/win-terminal.js), whose pipes, rundll32 child and timers are emulated.
// Both cores must go through the one shared win-terminal RunCommand helper, so output, failures and
// time limits behave the same in each.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stream = require('node:stream');
const { EventEmitter } = require('node:events');

const agents = path.join(__dirname, '../../agents');
const read = name => fs.readFileSync(path.join(agents, name), 'utf8').replace(/\r\n?/g, '\n');
const terminalSource = read('modules_meshcore/win-terminal.js');
const meshcore = read('meshcore.js');
const recoverycore = read('recoverycore.js');
const MARKER = '\x1b]MeshConsoleBridgeReady\x07';

function slice(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert(start >= 0, 'missing: ' + startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert(end > start, 'missing end: ' + endMarker);
    return source.slice(start, end);
}
function constant(source, name) {
    const match = source.match(new RegExp('^var ' + name + ' = .*$', 'm'));
    assert(match, name + ' must be declared in the core');
    return match[0];
}

// The served win-terminal module in a sandbox with emulated pipes, child process and timers.
function loadTerminal(options = {}) {
    const env = { servers: [], children: [], timers: new Map(), immediates: [], log: [], nextTimer: 1 };
    const sandbox = {
        process: { platform: 'win32', pid: 4242 }, Buffer, Date, Math, String, isFinite, parseInt, isNaN, Error,
        module: { exports: {} },
        _MSH() { return {}; },
        setTimeout(callback, ms) { const id = env.nextTimer++; env.timers.set(id, { callback, ms }); return id; },
        clearTimeout(id) { if (!env.timers.has(id)) { throw new Error('clearTimeout of an unknown or fired timer'); } env.timers.delete(id); },
        setImmediate(callback) { env.immediates.push(callback); },
        require(name) {
            switch (name) {
                case 'stream': return stream;
                case 'net': return { createServer(onConnection) {
                    const server = new EventEmitter();
                    server.listen = pipe => { server.pipe = pipe; };
                    server.close = () => { server.closed = true; };
                    server.connect = socket => onConnection(socket);
                    env.servers.push(server);
                    return server;
                } };
                case 'child_process': return { execFile(file, args) {
                    if (options.launchDenied) { return null; }
                    const child = new EventEmitter();
                    child.file = file; child.args = Array.from(args); child.pid = 900 + env.children.length; child.killed = 0;
                    child.kill = () => { child.killed++; };
                    env.children.push(child);
                    return child;
                } };
                case 'win-system-paths': return {
                    system32Path: file => 'C:\\Windows\\System32\\' + file,
                    installedServiceRuntimeDll: name => 'C:\\Program Files\\' + name + '\\agent.dll'
                };
                case '_agentNodeId': return { serviceName: () => 'Mesh Agent' };
                case 'MeshAgent': return { log: line => env.log.push(line) };
                case 'user-sessions': return options.sessions;
                default: throw new Error('unexpected require: ' + name);
            }
        }
    };
    vm.runInNewContext(terminalSource, sandbox);
    env.module = sandbox.module.exports;
    env.flush = () => { while (env.immediates.length > 0) { env.immediates.shift()(); } };
    // Connects the bridge's two pipes the way rundll32 MeshConsoleBridgeW does.
    env.connect = () => {
        env.flush();
        const input = new EventEmitter(), output = new EventEmitter();
        input.written = []; input.ended = 0;
        input.write = (data, callback) => { input.written.push(data.toString()); if (callback) { callback(); } return true; };
        input.end = () => { input.ended++; };
        output.end = () => { output.ended = (output.ended || 0) + 1; };
        env.servers[env.servers.length - 2].connect(input);
        env.servers[env.servers.length - 1].connect(output);
        return {
            input, output,
            child: env.children[env.children.length - 1],
            send: text => output.emit('data', Buffer.from(text)),
            exit: () => { env.children[env.children.length - 1].emit('exit', 0); output.emit('close'); }
        };
    };
    env.fireTimer = ms => {
        const entry = [...env.timers.entries()].find(([, timer]) => timer.ms === ms);
        assert(entry, 'no pending timer of ' + ms + ' ms');
        env.timers.delete(entry[0]);
        entry[1].callback();
    };
    return env;
}

const CONSOLE_SESSION = 3;
function sessions(consoleId) {
    return { consoleUid() { if (consoleId == null) { throw new Error('Nobody logged in'); } return consoleId; } };
}

// One core's run-commands entry point, wired to the emulated win-terminal module.
function loadCore(core, terminal) {
    const state = { replies: [], console: [] };
    const sandbox = {
        process: { platform: 'win32' }, Array, String, Buffer,
        mesh: { SendCommand: msg => state.replies.push(JSON.parse(JSON.stringify(msg))) },
        sendConsoleText(text) { state.console.push(String(text)); },
        require(name) {
            if (name === 'win-terminal') { return terminal.module; }
            if (name === 'user-sessions') { return terminal.sessions; }
            if (name === 'MeshAgent') { return sandbox.mesh; }
            if (name === 'child_process') { return { SpawnTypes: { TERM: 2 } }; }
            throw new Error('unexpected require: ' + name);
        }
    };
    let program;
    if (core === 'meshcore.js') {
        program = constant(meshcore, 'RUN_COMMANDS_TIMEOUT_MS') + '\nfunction run(data) { switch (data.action) {\n' +
            slice(meshcore, "case 'runcommands': {", "case 'uninstallagent':") + '\n} }';
    } else {
        program = constant(recoverycore, 'RUN_COMMANDS_TIMEOUT_MS') + '\nvar recoveryRunCommandChild = null;\n' +
            slice(recoverycore, 'function recoveryRunCommands(data) {', '\nrequire(\'MeshAgent\').AddCommandHandler(') + '\nfunction run(data) { recoveryRunCommands(data); }';
    }
    vm.runInNewContext(program, sandbox);
    state.run = fields => sandbox.run(Object.assign({ action: 'runcommands', reply: true, runAsUser: 0, type: 2, cmds: 'Write-Output HEALTH', sessionid: 's-1', responseid: 'r-1' }, fields));
    return state;
}

function setup(core, options = {}) {
    const terminal = loadTerminal(options);
    terminal.sessions = sessions(options.consoleId === undefined ? CONSOLE_SESSION : options.consoleId);
    const agent = loadCore(core, terminal);
    return { terminal, agent };
}

for (const core of ['meshcore.js', 'recoverycore.js']) {
    test(core + ': the script runs after the ready handshake and its output is returned', () => {
        const { terminal, agent } = setup(core);
        agent.run({ cmds: ['Write-Output HEALTH_', 'Write-Output MARKER'] });
        const bridge = terminal.connect();
        assert.deepEqual(bridge.child.args.slice(3), ['powershell', '80', '25', 'token=privileged-agent', 'mode=exec']);
        assert.equal(bridge.child.args[0], 'C:\\Program Files\\Mesh Agent\\agent.dll,MeshConsoleBridgeW');
        assert.deepEqual(bridge.input.written, [], 'nothing is written before the bridge is ready');
        bridge.send('banner' + MARKER.slice(0, 9));
        assert.deepEqual(bridge.input.written, [], 'a partial marker does not release the script');
        bridge.send(MARKER.slice(9) + 'HEALTH_');
        assert.deepEqual(bridge.input.written, ['Write-Output HEALTH_\r\nWrite-Output MARKER\r\n']);
        assert.equal(bridge.input.ended, 1, 'input closes after the script, so the shell exits');
        bridge.send('MARKER\r\n');
        bridge.exit();
        assert.deepEqual(agent.replies, [{ action: 'msg', type: 'runcommands', result: 'bannerHEALTH_MARKER\r\n', sessionid: 's-1', responseid: 'r-1' }]);
        assert.equal(terminal.timers.size, 0, 'completion clears the time limit');
    });

    test(core + ': a second request while one runs is refused, and the next one after it runs', () => {
        const { terminal, agent } = setup(core);
        agent.run({});
        agent.run({ responseid: 'r-2' });
        assert.deepEqual(agent.replies, [{ action: 'msg', type: 'runcommands', result: "Run commands can't execute, already busy.", sessionid: 's-1', responseid: 'r-2' }]);
        const bridge = terminal.connect();
        bridge.send(MARKER + 'ok\r\n');
        bridge.exit();
        agent.run({ responseid: 'r-3' });
        terminal.connect();
        assert.equal(terminal.children.length, 2, 'the finished run released the agent');
    });

    test(core + ': a bridge that fails before the handshake is reported as a failure', () => {
        const { terminal, agent } = setup(core);
        agent.run({});
        const bridge = terminal.connect();
        bridge.output.emit('close');
        assert.equal(agent.replies.length, 1);
        assert.equal(agent.replies[0].result, 'Windows run commands failed: Windows terminal bridge output closed before ready handshake through MeshConsoleBridgeW.');
        assert.equal(bridge.child.killed, 1);
        assert.equal(terminal.timers.size, 0);
    });

    test(core + ': the time limit is reported as a timeout and stops the bridge', () => {
        const { terminal, agent } = setup(core);
        agent.run({});
        const bridge = terminal.connect();
        bridge.send(MARKER + 'partial');
        terminal.fireTimer(300000);
        assert.equal(agent.replies.length, 1);
        assert.equal(agent.replies[0].result, 'partialWindows run commands timed out: no result within 300 s');
        assert.equal(bridge.child.killed, 1);
        bridge.exit();
        assert.equal(agent.replies.length, 1, 'one reply only');
    });

    test(core + ': a launch that cannot start is reported', () => {
        const { terminal, agent } = setup(core, { launchDenied: true });
        agent.run({});
        terminal.flush();
        assert.deepEqual(agent.replies.map(r => r.result), ['Windows run commands failed: Windows terminal bridge launch was denied by process policy.']);
    });

    test(core + ': runAsUser 1 uses the console user, or the agent when there is none; runAsUser 2 needs the user', () => {
        let probe = setup(core);
        probe.agent.run({ runAsUser: 1 });
        assert.deepEqual(probe.terminal.connect().child.args.slice(6), ['token=session-user', 'tsid=3', 'mode=exec']);

        probe = setup(core, { consoleId: null });
        probe.agent.run({ runAsUser: 1 });
        assert.deepEqual(probe.terminal.connect().child.args.slice(6), ['token=privileged-agent', 'mode=exec']);

        probe = setup(core, { consoleId: null });
        probe.agent.run({ runAsUser: 2 });
        probe.terminal.flush();
        assert.equal(probe.terminal.children.length, 0);
        assert.deepEqual(probe.agent.replies.map(r => r.result), ['Run commands user session is unavailable: Error: Nobody logged in']);
    });

    test(core + ': without reply, output streams to the console and the outcome is reported', () => {
        const { terminal, agent } = setup(core);
        agent.run({ reply: false });
        const bridge = terminal.connect();
        bridge.send(MARKER + 'line 1\r\n');
        bridge.exit();
        assert.deepEqual(agent.replies, []);
        assert.deepEqual(agent.console.filter(text => !text.startsWith('Run commands (')), ['line 1\r\n', 'Run commands completed.']);

        const failing = setup(core);
        failing.agent.run({ reply: false });
        failing.terminal.connect().output.emit('close');
        assert.equal(failing.agent.console[failing.agent.console.length - 1],
            'Windows run commands failed: Windows terminal bridge output closed before ready handshake through MeshConsoleBridgeW.');
    });
}

test('RunCommand: a bridge closed before the script was sent is a failure, not a completion', () => {
    const terminal = loadTerminal();
    const results = [];
    const run = terminal.module.RunCommand('Write-Output x', { timeoutMs: 1000 }, result => results.push(result));
    run.closeBridge();
    assert.deepEqual(JSON.parse(JSON.stringify(results)), [{ ok: false, output: '', error: 'the bridge closed before the script was sent', timedOut: false }]);
});

test('RunCommand: the time limit and the completion callback are required', () => {
    const terminal = loadTerminal();
    assert.throws(() => terminal.module.RunCommand('x', {}, () => { }), /positive time limit/);
    assert.throws(() => terminal.module.RunCommand('x', { timeoutMs: 1000 }), /completion callback/);
});

test('RunCommand: a throwing output consumer fails the run instead of being ignored', () => {
    const terminal = loadTerminal();
    const results = [];
    terminal.module.RunCommand('x', { timeoutMs: 1000, onOutput() { throw new Error('consumer broke'); } }, result => results.push(result));
    const bridge = terminal.connect();
    bridge.send(MARKER + 'out');
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.equal(results[0].error, 'consumer broke');
    assert.equal(bridge.child.killed, 1);
});
