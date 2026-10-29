'use strict';

// Regression (2026-10-29, production): every Windows terminal showed "Denied" and closed after 0 seconds.
// win-terminal.js emitted a 'ready' event on its stream.Duplex at the bridge's ready handshake. In the
// agent's Duktape runtime a stream.Duplex has explicit events and no createEvent, so emitting an event
// nobody declared throws ("EventEmitter.emit(): Event 'ready' not found on object 'stream.Duplex'",
// MeshAgent microscript/ILibduktape_EventEmitter.c). The module turned that throw into a bridge failure,
// the core sent it as console msgid 2 ("Denied") and closed the tunnel. Node's stream.Duplex ignores unknown
// events, so the other tests, which run the module under Node streams, never saw it.
//
// Here the served module runs with a stream.Duplex that behaves like Duktape's: emitting an undeclared event
// throws, and there is no createEvent. A terminal must reach the ready handshake and stay open.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeStream = require('node:stream');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(path.join(__dirname, '../../agents/modules_meshcore/win-terminal.js'), 'utf8').replace(/\r\n?/g, '\n');
const MARKER = '\x1b]MeshConsoleBridgeReady\x07';

// The events a Duktape stream.Duplex declares: end, data, close, error (MeshAgent
// microscript/ILibDuktape_ReadableStream.c) and pipe, unpipe, drain, finish, error (ILibDuktape_WritableStream.c).
// Emitting, or registering a listener for, any other name throws, as in the agent (ILibduktape_EventEmitter.c).
const DUKTAPE_DUPLEX_EVENTS = new Set(['close', 'data', 'drain', 'end', 'error', 'finish', 'pipe', 'unpipe']);
// Events Node's own stream machinery emits on the stand-in (the module never emits these; the source check
// below holds the module to DUKTAPE_DUPLEX_EVENTS).
const NODE_STREAM_INTERNAL_EVENTS = new Set(['resume', 'pause', 'prefinish', 'newListener', 'removeListener']);
function declared(name) { return DUKTAPE_DUPLEX_EVENTS.has(name) || NODE_STREAM_INTERNAL_EVENTS.has(name); }
class DuktapeDuplex extends nodeStream.Duplex {
    emit(name, ...args) {
        if (!declared(name)) { throw new Error("EventEmitter.emit(): Event '" + name + "' not found on object 'stream.Duplex'"); }
        return super.emit(name, ...args);
    }
}
for (const method of ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener']) {
    const base = nodeStream.Duplex.prototype[method];
    DuktapeDuplex.prototype[method] = function (name, ...args) {
        if (!declared(name)) { throw new Error('Cannot register for non-existing event: ' + name); }
        return base.call(this, name, ...args);
    };
}
Object.defineProperty(DuktapeDuplex.prototype, 'createEvent', { value: undefined });

function loadTerminal() {
    const env = { servers: [], children: [], timers: new Map(), immediates: [], log: [], nextTimer: 1 };
    const sandbox = {
        process: { platform: 'win32', pid: 4242 }, Buffer, Date, Math, String, isFinite, parseInt, isNaN, Error,
        module: { exports: {} },
        _MSH() { return {}; },
        setTimeout(callback, ms) { const id = env.nextTimer++; env.timers.set(id, { callback, ms }); return id; },
        clearTimeout(id) { env.timers.delete(id); },
        setImmediate(callback) { env.immediates.push(callback); },
        require(name) {
            switch (name) {
                case 'stream': return { Duplex: DuktapeDuplex };
                case 'net': return { createServer(onConnection) {
                    const server = new EventEmitter();
                    server.listen = pipe => { server.pipe = pipe; };
                    server.close = () => { server.closed = true; };
                    server.connect = socket => onConnection(socket);
                    env.servers.push(server);
                    return server;
                } };
                case 'child_process': return { execFile(file, args) {
                    const child = new EventEmitter();
                    child.file = file; child.args = Array.from(args); child.pid = 900 + env.children.length;
                    child.kill = () => { child.killed = true; };
                    env.children.push(child);
                    return child;
                } };
                case 'win-system-paths': return {
                    system32Path: file => 'C:\\Windows\\System32\\' + file,
                    installedServiceRuntimeDll: name => 'C:\\Program Files\\' + name + '\\agent.dll'
                };
                case '_agentNodeId': return { serviceName: () => 'Mesh Agent' };
                case 'MeshAgent': return { log: line => env.log.push(line) };
                default: throw new Error('unexpected require: ' + name);
            }
        }
    };
    vm.runInNewContext(source, sandbox);
    env.module = sandbox.module.exports;
    env.connect = () => {
        while (env.immediates.length > 0) { env.immediates.shift()(); }
        const input = new EventEmitter(), output = new EventEmitter();
        input.written = [];
        input.write = (data, callback) => { input.written.push(data.toString()); if (callback) { callback(); } return true; };
        input.end = () => { };
        output.end = () => { };
        env.servers[env.servers.length - 2].connect(input);
        env.servers[env.servers.length - 1].connect(output);
        return { input, output, send: text => output.emit('data', Buffer.from(text)) };
    };
    return env;
}

// What the agent core's terminal tunnel does with the stream (agents/meshcore.js terminal_promise_connection_resolved).
function openTerminal(env, method) {
    const term = env.module[method](80, 25, null);
    const seen = { errors: [], closed: 0, data: '' };
    term.on('error', error => seen.errors.push(String(error)));
    term.on('close', () => { seen.closed++; });
    term.on('data', chunk => { seen.data += chunk.toString(); });
    return { term, seen };
}

for (const method of ['Start', 'StartPowerShell']) {
    test('win-terminal ' + method + ': the ready handshake keeps the terminal open on a Duktape-style stream', async () => {
        const env = loadTerminal();
        const { term, seen } = openTerminal(env, method);
        const pipes = env.connect();
        pipes.send(MARKER + 'Microsoft Windows [Version 10.0]\r\nC:\\>');
        // Node delivers pushed stream data on a later tick.
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(seen.errors, [], 'the bridge must not fail at the ready handshake');
        assert.equal(seen.closed, 0, 'the terminal must stay open');
        assert.equal(term.isBridgeReady(), true);
        assert.match(seen.data, /Microsoft Windows/, 'output after the marker reaches the terminal');
        assert.equal(term._bridge.lastError, '');
    });
}

test('win-terminal: onReady callbacks still run at the handshake (run commands depend on them)', () => {
    const env = loadTerminal();
    const { term, seen } = openTerminal(env, 'Start');
    let ready = 0;
    term._bridge.onReady(() => { ready++; });
    const pipes = env.connect();
    pipes.send(MARKER);
    assert.equal(ready, 1);
    assert.deepEqual(seen.errors, []);
});

test('win-terminal emits no undeclared stream events (Duktape refuses them)', () => {
    const calls = [...source.matchAll(/\.emit\(/g)].length;
    const literal = [...source.matchAll(/\.emit\('([A-Za-z]+)'/g)].map(match => match[1]);
    assert.equal(literal.length, calls, 'every emit in win-terminal.js names its event as a literal, so this check can see it');
    for (const name of literal) {
        assert.ok(DUKTAPE_DUPLEX_EVENTS.has(name), "win-terminal.js emits '" + name + "', which a Duktape stream.Duplex does not declare");
    }
    assert.ok(!/createEvent\(/.test(source), 'a Duktape stream.Duplex has no createEvent');
});

test('the stand-in refuses undeclared events like Duktape (so the tests above can catch this class of bug)', () => {
    const duplex = new DuktapeDuplex({ read() { }, write(chunk, encoding, done) { done(); } });
    assert.throws(() => duplex.emit('ready'), /Event 'ready' not found/);
    assert.throws(() => duplex.on('ready', () => { }), /non-existing event: ready/);
    assert.throws(() => duplex.emit('readable'), /Event 'readable' not found/);
});
