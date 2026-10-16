'use strict';

// Unit tests for the browser desktop-audio player's pure logic: the strict
// packet parser (spec section 3), the jitter-buffer scheduler math, and the
// controller state machine. These carry no DOM / Web Audio dependency and run
// under `node --test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const audio = require(path.join(__dirname, '../public/scripts/agent-desktop-audio-0.0.1.js'));
const { PACKET_TYPE, FLAG_DISCONTINUITY, HEADER_LENGTH, parsePacket, createAudioScheduler, createAudioStateMachine, mapAgentStatus, defaultReasonFor, AUDIO_STATES } = audio;

// ---- packet builders ----------------------------------------------------
function buildPacket({ version = 1, type, flags = 0, sequence = 0, timestampMs = 0, payload = Buffer.alloc(0), lengthOverride } = {}) {
    const payloadLen = lengthOverride != null ? lengthOverride : payload.length;
    const buf = Buffer.alloc(HEADER_LENGTH + payload.length);
    buf.writeUInt8(version, 0);
    buf.writeUInt8(type, 1);
    buf.writeUInt16LE(flags, 2);
    buf.writeUInt32LE(sequence >>> 0, 4);
    buf.writeUInt32LE(timestampMs >>> 0, 8);
    buf.writeUInt32LE(payloadLen >>> 0, 12);
    payload.copy(buf, HEADER_LENGTH);
    return new Uint8Array(buf);
}

function configPayload({ codec = 1, sampleRate = 48000, channels = 2, frameMs = 20, bitrate = 64000 } = {}) {
    const p = Buffer.alloc(16);
    p.writeUInt32LE(codec, 0);
    p.writeUInt32LE(sampleRate, 4);
    p.writeUInt16LE(channels, 8);
    p.writeUInt16LE(frameMs, 10);
    p.writeUInt32LE(bitrate, 12);
    return p;
}

function statusPayload(code, reason) {
    const r = Buffer.from(reason, 'utf8');
    const p = Buffer.alloc(4 + r.length);
    p.writeUInt32LE(code >>> 0, 0);
    r.copy(p, 4);
    return p;
}

// ---- parser -------------------------------------------------------------
test('parser: valid CONFIG round-trips all fields', () => {
    const pkt = parsePacket(buildPacket({ type: PACKET_TYPE.CONFIG, flags: FLAG_DISCONTINUITY, sequence: 7, timestampMs: 123, payload: configPayload() }));
    assert.equal(pkt.type, PACKET_TYPE.CONFIG);
    assert.equal(pkt.discontinuity, true);
    assert.equal(pkt.sequence, 7);
    assert.equal(pkt.timestampMs, 123);
    assert.deepEqual(pkt.config, { codec: 1, sampleRate: 48000, channels: 2, frameMs: 20, bitrate: 64000 });
});

test('parser: valid AUDIO carries the opus payload', () => {
    const opus = Buffer.from([0xfc, 0x01, 0x02, 0x03]);
    const pkt = parsePacket(buildPacket({ type: PACKET_TYPE.AUDIO, sequence: 42, payload: opus }));
    assert.equal(pkt.type, PACKET_TYPE.AUDIO);
    assert.equal(pkt.sequence, 42);
    assert.equal(pkt.discontinuity, false);
    assert.deepEqual(Buffer.from(pkt.payload), opus);
});

test('parser: SILENCE must be empty and is accepted', () => {
    const pkt = parsePacket(buildPacket({ type: PACKET_TYPE.SILENCE }));
    assert.equal(pkt.type, PACKET_TYPE.SILENCE);
    assert.equal(pkt.payload.length, 0);
});

test('parser: STATUS yields code and utf-8 reason', () => {
    const pkt = parsePacket(buildPacket({ type: PACKET_TYPE.STATUS, payload: statusPayload(0x80070005, 'Access denied') }));
    assert.equal(pkt.type, PACKET_TYPE.STATUS);
    assert.equal(pkt.status.code, 0x80070005);
    assert.equal(pkt.status.reason, 'Access denied');
});

test('parser: sequence/timestamp wrap values survive as unsigned', () => {
    const pkt = parsePacket(buildPacket({ type: PACKET_TYPE.AUDIO, sequence: 0xFFFFFFFF, timestampMs: 0xFFFFFFFE, payload: Buffer.from([1]) }));
    assert.equal(pkt.sequence, 0xFFFFFFFF);
    assert.equal(pkt.timestampMs, 0xFFFFFFFE);
});

test('parser rejects short header', () => {
    assert.throws(() => parsePacket(new Uint8Array(8)), /short header/);
});

test('parser rejects bad version', () => {
    assert.throws(() => parsePacket(buildPacket({ version: 2, type: PACKET_TYPE.SILENCE })), /bad version/);
});

test('parser rejects unknown type', () => {
    assert.throws(() => parsePacket(buildPacket({ type: 9 })), /unknown type/);
});

test('parser rejects payload over 4096', () => {
    // Header claims 5000 bytes without supplying them -> caught by the cap.
    assert.throws(() => parsePacket(buildPacket({ type: PACKET_TYPE.AUDIO, payload: Buffer.alloc(0), lengthOverride: 5000 })), /payload too large/);
});

test('parser rejects length mismatch', () => {
    assert.throws(() => parsePacket(buildPacket({ type: PACKET_TYPE.AUDIO, payload: Buffer.from([1, 2, 3]), lengthOverride: 2 })), /length mismatch/);
});

test('parser rejects CONFIG with wrong payload length', () => {
    assert.throws(() => parsePacket(buildPacket({ type: PACKET_TYPE.CONFIG, payload: Buffer.alloc(12) })), /bad CONFIG length/);
});

test('parser rejects CONFIG with unsupported codec', () => {
    assert.throws(() => parsePacket(buildPacket({ type: PACKET_TYPE.CONFIG, payload: configPayload({ codec: 2 }) })), /unsupported codec/);
});

test('parser rejects non-empty SILENCE', () => {
    assert.throws(() => parsePacket(buildPacket({ type: PACKET_TYPE.SILENCE, payload: Buffer.from([0]) })), /SILENCE must be empty/);
});

test('parser rejects STATUS shorter than 4 bytes', () => {
    assert.throws(() => parsePacket(buildPacket({ type: PACKET_TYPE.STATUS, payload: Buffer.from([1, 2]) })), /STATUS too short/);
});

// ---- scheduler ----------------------------------------------------------
const FRAME = 0.02; // 20 ms frame

test('scheduler primes with a lead cushion on the first frame', () => {
    const s = createAudioScheduler({ maxLatencyMs: 300, bufferLeadMs: 60 });
    const d = s.schedule(10.0, FRAME);
    assert.equal(d.reset, true);
    assert.equal(d.dropped, undefined);
    assert.ok(Math.abs(d.startTime - 10.06) < 1e-9, 'start = now + lead');
    assert.ok(Math.abs(s.peekNextStartTime() - (10.06 + FRAME)) < 1e-9);
});

test('scheduler advances the cursor by frame duration for contiguous frames', () => {
    const s = createAudioScheduler({ maxLatencyMs: 300, bufferLeadMs: 60 });
    const d1 = s.schedule(10.0, FRAME);
    const d2 = s.schedule(10.0, FRAME);
    assert.ok(!d2.dropped);
    assert.ok(Math.abs(d2.startTime - (d1.startTime + FRAME)) < 1e-9);
});

test('scheduler re-primes on underrun when the cursor falls behind real time', () => {
    const s = createAudioScheduler({ maxLatencyMs: 300, bufferLeadMs: 60 });
    s.schedule(10.0, FRAME);           // nextStart ~= 10.08
    const d = s.schedule(11.0, FRAME); // now jumped past the cursor
    assert.equal(d.underrun, true);
    assert.equal(d.reset, true);
    assert.ok(Math.abs(d.startTime - 11.18) < 1e-9);
    assert.equal(s.getStats().underruns, 1);
});

test('scheduler drops frames once the queued lead exceeds max latency', () => {
    const s = createAudioScheduler({ maxLatencyMs: 300, bufferLeadMs: 60 });
    // Keep scheduling at the same "now" so the cursor runs far ahead of it.
    let dropped = 0, scheduled = 0;
    for (let i = 0; i < 100; i++) {
        const d = s.schedule(10.0, FRAME);
        if (d.dropped) { dropped++; } else { scheduled++; }
    }
    assert.ok(dropped > 0, 'some frames are dropped to cap latency');
    // The cursor never exceeds now + maxLatency (0.3s): lead/frame ~= 15 + prime.
    assert.ok((s.peekNextStartTime() - 10.0) <= 0.3 + FRAME + 1e-9);
    assert.equal(s.getStats().dropped, dropped);
});

test('scheduler reset forces a re-prime on the next frame', () => {
    const s = createAudioScheduler({ maxLatencyMs: 300, bufferLeadMs: 60 });
    s.schedule(10.0, FRAME);
    s.reset();
    assert.equal(s.peekNextStartTime(), null);
    const d = s.schedule(12.0, FRAME);
    assert.equal(d.reset, true);
    assert.ok(Math.abs(d.startTime - 12.06) < 1e-9);
});

test('scheduler drops zero-length frames', () => {
    const s = createAudioScheduler();
    assert.equal(s.schedule(1.0, 0).dropped, true);
});

// ---- state machine ------------------------------------------------------
test('state machine starts hidden and off', () => {
    const m = createAudioStateMachine();
    assert.deepEqual(m.getState(), { available: false, state: AUDIO_STATES.OFF, reason: '' });
    assert.equal(m.isActive(), false);
});

test('state machine shows icon only after availability', () => {
    const m = createAudioStateMachine();
    assert.equal(m.onAvailable().available, true);
});

test('state machine start -> started -> playback ready -> stopped lifecycle', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    assert.equal(m.onStartRequested().state, AUDIO_STATES.CONNECTING);
    assert.equal(m.isActive(), true);
    assert.equal(m.onAgentStatus('started').state, AUDIO_STATES.CONNECTING, 'device capture alone is not browser playback');
    assert.equal(m.onPlaybackReady().state, AUDIO_STATES.PLAYING);
    assert.equal(m.onAgentStatus('stopped').state, AUDIO_STATES.OFF);
    assert.equal(m.isActive(), false);
});

test('state machine: Playing needs both agent start and browser readiness, in either order', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    m.onStartRequested();
    assert.equal(m.onPlaybackReady().state, AUDIO_STATES.CONNECTING, 'browser ready before the agent confirmed capture');
    assert.equal(m.onAgentStatus('started').state, AUDIO_STATES.PLAYING);
});

test('state machine: readiness is session-scoped and ignored when idle', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    assert.equal(m.onPlaybackReady().state, AUDIO_STATES.OFF, 'no session, no playback');
    m.onStartRequested(); m.onAgentStatus('started'); m.onPlaybackReady();
    m.onStopRequested();
    m.onStartRequested();
    assert.equal(m.onAgentStatus('started').state, AUDIO_STATES.CONNECTING, 'a new session does not inherit the old readiness');
});

test('state machine: a blocked or suspended browser ends the session with its reason', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    m.onStartRequested(); m.onAgentStatus('started');
    const snap = m.onLocalError('The browser blocked audio playback; click the speaker to try again');
    assert.equal(snap.state, AUDIO_STATES.ERROR);
    assert.match(snap.reason, /blocked audio playback/);
    assert.equal(m.onPlaybackReady().state, AUDIO_STATES.ERROR, 'a late readiness report cannot revive an ended session');
});

test('playback readiness reports ready once all three conditions hold, then suspended', () => {
    const { createPlaybackReadiness } = audio;
    const r = createPlaybackReadiness();
    assert.equal(r.setContextRunning(true), null);
    assert.equal(r.setDecoderReady(), null);
    assert.equal(r.isReady(), false, 'no stream proof yet');
    assert.equal(r.markStreamLive(), 'ready');
    assert.equal(r.markStreamLive(), null, 'reported once');
    assert.equal(r.setContextRunning(false), 'suspended');
    assert.equal(r.isReady(), false);
    assert.equal(r.setContextRunning(true), 'ready', 'a context that runs again is ready again');

    const blocked = createPlaybackReadiness();
    blocked.setDecoderReady(); blocked.markStreamLive();
    assert.equal(blocked.setContextRunning(false), null, 'never running: never ready, nothing to suspend');
    assert.equal(blocked.isReady(), false);
});

test('state machine maps denied/nodesktop/unavailable to unavailable with default reason', () => {
    for (const s of ['denied', 'nodesktop', 'unavailable']) {
        const m = createAudioStateMachine();
        m.onAvailable();
        const snap = m.onAgentStatus(s);
        assert.equal(snap.state, AUDIO_STATES.UNAVAILABLE);
        assert.equal(snap.reason, defaultReasonFor(s));
        assert.ok(snap.reason.length > 0);
    }
});

test('state machine uses the agent-supplied reason when present', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    const snap = m.onAgentStatus('error', 'WASAPI device invalidated');
    assert.equal(snap.state, AUDIO_STATES.ERROR);
    assert.equal(snap.reason, 'WASAPI device invalidated');
});

test('state machine: unexpected tunnel close while active becomes error', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    m.onStartRequested();
    const snap = m.onTunnelClosed();
    assert.equal(snap.state, AUDIO_STATES.ERROR);
    assert.equal(snap.reason, 'Audio connection closed');
});

test('state machine: tunnel close while idle is a no-op', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    assert.equal(m.onTunnelClosed().state, AUDIO_STATES.OFF);
});

test('state machine: desktop close hides the icon and resets', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    m.onStartRequested();
    const snap = m.onDesktopClosed();
    assert.deepEqual(snap, { available: false, state: AUDIO_STATES.OFF, reason: '' });
});

test('state machine: double start is idempotent', () => {
    const m = createAudioStateMachine();
    m.onAvailable();
    m.onStartRequested();
    m.onAgentStatus('started');
    m.onPlaybackReady();
    assert.equal(m.onStartRequested().state, AUDIO_STATES.PLAYING);
});

test('mapAgentStatus covers all known states and rejects unknown', () => {
    assert.equal(mapAgentStatus('started').state, AUDIO_STATES.PLAYING);
    assert.equal(mapAgentStatus('stopped').state, AUDIO_STATES.OFF);
    assert.equal(mapAgentStatus('unavailable').state, AUDIO_STATES.UNAVAILABLE);
    assert.equal(mapAgentStatus('nodesktop').state, AUDIO_STATES.UNAVAILABLE);
    assert.equal(mapAgentStatus('denied').state, AUDIO_STATES.UNAVAILABLE);
    assert.equal(mapAgentStatus('error').state, AUDIO_STATES.ERROR);
    assert.equal(mapAgentStatus('bogus'), null);
});

// ---- volume ---------------------------------------------------------------
test('normalizeVolume maps slider percents and gains to [0, 1] and never mutes by accident', () => {
    const { normalizeVolume } = audio;
    assert.equal(normalizeVolume(1), 1);
    assert.equal(normalizeVolume(0), 0);
    assert.equal(normalizeVolume(0.35), 0.35);
    assert.equal(normalizeVolume(70), 0.7, 'slider percent');
    assert.equal(normalizeVolume('40'), 0.4, 'stored string percent');
    assert.equal(normalizeVolume(250), 1, 'clamped high');
    assert.equal(normalizeVolume(-5), 0, 'clamped low');
    for (const bad of [undefined, null, NaN, Infinity, 'loud', {}]) {
        assert.equal(normalizeVolume(bad), 1, 'invalid input falls back to full volume: ' + String(bad));
    }
});

test('scheduler learns recurring 100ms delivery stalls without unbounded latency', () => {
    const scheduler = createAudioScheduler({ maxLatencyMs: 300, bufferLeadMs: 60 });
    // Repeated transport resyncs followed by a 100ms delivery stall.
    for (let i = 0; i < 300; i++) {
        const nominal = i * 0.02;
        const phase = i % 20;
        if (phase === 0) scheduler.reset();
        const arrival = phase >= 4 && phase <= 8 ? nominal + (8 - phase) * 0.02 : nominal;
        scheduler.schedule(arrival, 0.02);
    }
    assert.ok(scheduler.getStats().underruns <= 2, 'recurring jitter should not repeatedly drain playback');
    assert.ok(scheduler.getStats().targetLeadMs <= 180);
});
