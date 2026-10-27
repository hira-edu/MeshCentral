'use strict';
// Exercise the production browser player with deterministic Web Audio/WebCodecs
// adapters. No endpoint capture or audio content is retained.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/scripts/agent-desktop-audio-0.0.1.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function packet(type, flags = 0) {
    const b = Buffer.alloc(type === 1 ? 32 : type === 2 ? 17 : 16);
    b[0] = 1; b[1] = type; b.writeUInt16LE(flags, 2); b.writeUInt32LE(b.length - 16, 12);
    if (type === 1) { b.writeUInt32LE(1, 16); b.writeUInt32LE(48000, 20); b.writeUInt16LE(2, 24); b.writeUInt16LE(20, 26); b.writeUInt32LE(64000, 28); }
    return b;
}
function fixture(options = {}) {
    const errors = [], activity = [], playback = [], decoders = [], sources = [], timers = new Map(), stateListeners = [];
    let timer = 0;
    const context = {
        state: options.state || 'running', currentTime: 0,
        resume() { if (options.resume) return options.resume(this); this.state = 'running'; return Promise.resolve(); },
        createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
        createBuffer: () => ({ copyToChannel() {} }),
        createBufferSource() { const s = { connect() {}, disconnect() {}, start() { if (options.startError) throw Error('output failed'); s.started = true; }, stop() { s.stopped = true; } }; sources.push(s); return s; },
        addEventListener(type, fn) { if (type === 'statechange') stateListeners.push(fn); },
        removeEventListener(type, fn) { const i = stateListeners.indexOf(fn); if (i >= 0) stateListeners.splice(i, 1); },
        setState(state) { this.state = state; for (const fn of [...stateListeners]) fn(); }
    };
    class Decoder {
        static isConfigSupported() { return options.probe || Promise.resolve({ supported: true }); }
        constructor(callbacks) { this.callbacks = callbacks; this.decodeQueueSize = 0; decoders.push(this); }
        configure() {}
        close() { this.closed = true; }
        decode() { if (options.noOutput) return; this.output(options.pcm == null ? 0.2 : options.pcm); }
        output(value) { this.callbacks.output({ numberOfChannels: 2, numberOfFrames: 960, sampleRate: 48000, copyTo(plane) { plane.fill(value); }, close() {} }); }
    }
    const sandbox = { AudioDecoder: Decoder, EncodedAudioChunk: class {}, setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); } };
    vm.runInNewContext(source, sandbox);
    const player = sandbox.MeshDesktopAudio.createMeshDesktopAudioPlayer({ audioContext: context, onError: e => errors.push(e), onPlayback: p => playback.push(p), onActivity: a => activity.push(a) });
    return { player, context, errors, activity, playback, decoders, sources, timers };
}

test('a resume that leaves the context suspended reports failure', async () => {
    const f = fixture({ state: 'suspended', resume: () => Promise.resolve() });
    await f.player.start();
    for (const fn of [...f.timers.values()]) fn();
    assert.ok(f.playback.includes('blocked'));
    assert.equal(f.player.isPlaybackReady(), false);
    f.player.stop();
});
test('receiving encoded packets without decoded output is not playback activity', async () => {
    const f = fixture({ noOutput: true }); await f.player.start();
    f.player.handlePacket(packet(1, 1)); await flush(); f.player.handlePacket(packet(2));
    assert.deepEqual(f.activity, []); f.player.stop();
});
test('decoded silence does not animate the sound waves', async () => {
    const f = fixture({ pcm: 0 }); await f.player.start();
    f.player.handlePacket(packet(1, 1)); await flush(); f.player.handlePacket(packet(2));
    assert.deepEqual(f.activity, []); f.player.stop();
});
test('stopping during decoder probing cannot create a decoder afterward', async () => {
    const probe = deferred(); const f = fixture({ probe: probe.promise }); await f.player.start();
    f.player.handlePacket(packet(1, 1)); f.player.stop(); probe.resolve({ supported: true }); await flush();
    assert.equal(f.decoders.length, 0);
});
test('a discontinuity stops queued sources before reprime so frames do not overlap', async () => {
    const f = fixture(); await f.player.start(); f.player.handlePacket(packet(1, 1)); await flush();
    f.player.handlePacket(packet(2)); f.player.handlePacket(packet(2, 1));
    assert.equal(f.sources[0].stopped, true); f.player.stop();
});
test('failure to schedule a source is surfaced and stops playback', async () => {
    const f = fixture({ startError: true }); await f.player.start(); f.player.handlePacket(packet(1, 1)); await flush(); f.player.handlePacket(packet(2));
    assert.equal(f.errors.length, 1); assert.equal(f.player.isRunning(), false);
});
test('replaced CONFIG invalidates old decoder output and errors', async () => {
    const f = fixture(); f.player.start(); f.player.handlePacket(packet(1, 1)); await flush(); const old = f.decoders[0];
    f.player.handlePacket(packet(1, 1)); await flush(); old.output(0.3); old.callbacks.error(Error('late decode failure'));
    assert.equal(f.sources.length, 0); assert.deepEqual(f.errors, []); assert.equal(old.closed, true);
    f.player.handlePacket(packet(2)); assert.equal(f.sources.length, 1); f.player.stop();
});
test('WebCodecs decoder backlog is bounded while output is delayed', async () => {
    const f = fixture({ noOutput: true }); f.player.start(); f.player.handlePacket(packet(1, 1)); await flush();
    const decoder = f.decoders[0]; let submitted = 0;
    decoder.decode = () => { submitted++; decoder.decodeQueueSize++; };
    for (let i = 0; i < 1000; i++) f.player.handlePacket(packet(2));
    assert.ok(submitted > 0 && submitted <= 15); f.player.stop();
});
test('WASM initialization never queues live packets and frees a cancelled decoder after ready', async () => {
    const ready = deferred(), decoders = [];
    class WasmDecoder {
        constructor() { this.ready = ready.promise; this.decoded = 0; decoders.push(this); }
        decodeFrame() { this.decoded++; }
        free() { this.freed = (this.freed || 0) + 1; }
    }
    const sandbox = { window: { 'opus-decoder': { OpusDecoder: WasmDecoder } }, setTimeout() { return 1; }, clearTimeout() {} };
    vm.runInNewContext(source, sandbox);
    const context = { state: 'running', createGain: () => ({ gain: {}, connect() {}, disconnect() {} }) };
    const player = sandbox.MeshDesktopAudio.createMeshDesktopAudioPlayer({ audioContext: context });
    player.start(); player.handlePacket(packet(1, 1)); await flush();
    for (let i = 0; i < 1000; i++) player.handlePacket(packet(2));
    player.stop(); ready.resolve(); await flush();
    assert.equal(decoders.length, 1); assert.equal(decoders[0].decoded, 0); assert.equal(decoders[0].freed, 1);
});
test('a discontinuity on a silence heartbeat clears old scheduled audio', async () => {
    const f = fixture(); f.player.start(); f.player.handlePacket(packet(1, 1)); await flush();
    f.player.handlePacket(packet(2)); f.player.handlePacket(packet(3, 1));
    assert.equal(f.sources[0].stopped, true); f.player.stop();
});

test('a device-silent stream is ready once CONFIG and a SILENCE heartbeat arrive', async () => {
    const f = fixture(); f.player.start();
    f.player.handlePacket(packet(1, 1)); await flush();
    assert.deepEqual(f.playback, [], 'decoder ready alone is not playback');
    f.player.handlePacket(packet(3));
    assert.deepEqual(f.playback, ['ready']);
    assert.deepEqual(f.activity, [], 'silence never animates');
    f.player.stop();
});
test('a context that suspends before playback is ready is reported, not left connecting', async () => {
    const f = fixture(); f.player.start();
    f.context.setState('suspended'); // e.g. the OS switched audio devices right after the click
    f.player.handlePacket(packet(1, 1)); await flush(); f.player.handlePacket(packet(3));
    assert.deepEqual(f.playback, ['suspended']);
    assert.equal(f.player.isPlaybackReady(), false);
    f.player.stop();
});
test('a frame decoded while resume() is still settling is dropped, not fatal', async () => {
    const f = fixture({ state: 'suspended', resume: () => new Promise(() => {}) }); f.player.start();
    f.player.handlePacket(packet(1, 1)); await flush(); f.player.handlePacket(packet(2));
    assert.deepEqual(f.errors, []); assert.equal(f.sources.length, 0); assert.equal(f.player.isRunning(), true);
    f.context.setState('running');
    f.player.handlePacket(packet(2));
    assert.equal(f.sources.length, 1); assert.deepEqual(f.playback, ['ready']);
    f.player.stop();
});
test('diagnostics distinguish decoder drops from scheduled frames without exposing audio', async () => {
    const f = fixture(); f.player.start(); f.player.handlePacket(packet(2));
    f.player.handlePacket(packet(1, 1)); await flush();
    f.decoders[0].decodeQueueSize = 20; f.player.handlePacket(packet(2));
    f.decoders[0].decodeQueueSize = 0; f.player.handlePacket(packet(2)); f.player.handlePacket(packet(3));
    const d = f.player.getDiagnostics();
    assert.equal(d.audioPackets, 3); assert.equal(d.decoderNotReadyDrops, 1); assert.equal(d.decoderBackpressureDrops, 1);
    assert.equal(d.decodedFrames, 1); assert.equal(d.silencePackets, 1); assert.equal(d.discontinuities, 1);
    assert.equal(d.scheduler.scheduled, 1); assert.equal(d.decoder, 'webcodecs'); assert.equal(d.context, 'running');
    d.audioPackets = -1; assert.equal(f.player.getDiagnostics().audioPackets, 3); f.player.stop();
});
