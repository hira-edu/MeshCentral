/**
* @description MeshCentral Desktop Audio player (tunnel protocol 20)
* @author MeshAgent system-audio feature
* @version v0.0.1
*
* Receives framed audio packets from the agent's desktop-audio helper over a
* relay tunnel (protocol 20) and plays endpoint speaker output live in the
* browser. Live only, never recorded. See the shared system-audio spec,
* sections 3 and 6.
*
* Decoding: WebCodecs AudioDecoder when the browser reports Opus support
* (probed with isConfigSupported); otherwise the vendored MIT opus-decoder
* WASM build (loaded lazily, main-thread OpusDecoder class).
*
* Scheduling: a bounded jitter buffer modeled on Apache Guacamole's
* Guacamole.RawAudioPlayer (AudioPlayer.js, Apache-2.0). The approach of
* advancing a Web Audio timeline cursor and clamping the scheduled lead to a
* maximum latency is adapted from that project; the implementation here is
* original. Maximum added latency is capped at 300 ms; the pipeline resets on
* a DISCONTINUITY flag or a CONFIG change.
*
* The pure logic (packet parser, scheduler math, controller state machine) is
* exported for Node-based unit tests and carries no DOM or Web Audio
* dependency. The browser player (createMeshDesktopAudioPlayer) is only used
* when a real AudioContext and decoder are available.
*/

(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        // Node: expose the pure, testable surface.
        module.exports = api;
    }
    if (typeof root !== 'undefined' && root !== null) {
        // Browser: publish on the global object for custom.js to consume.
        root.MeshDesktopAudio = api;
        root.createMeshDesktopAudioPlayer = api.createMeshDesktopAudioPlayer;
    }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
    'use strict';

    // ---- Protocol constants (spec section 3) -------------------------------
    var HEADER_LENGTH = 16;
    var MAX_PAYLOAD = 4096;
    var PACKET_VERSION = 1;

    var PACKET_TYPE = { CONFIG: 1, AUDIO: 2, SILENCE: 3, STATUS: 4 };
    var FLAG_DISCONTINUITY = 1; // flags bit0
    var CODEC_OPUS = 1;
    var CONFIG_PAYLOAD_LENGTH = 16; // u32 codec, u32 sampleRate, u16 channels, u16 frameMs, u32 bitrate
    var MAX_STATUS_REASON = 256;

    // ---- Scheduler / latency defaults (spec section 6) ---------------------
    var MAX_LATENCY_MS = 300;   // hard cap on scheduled playback lead
    var BUFFER_LEAD_MS = 60;    // initial jitter cushion when (re)priming
    var ACTIVITY_HOLD_MS = 600; // audio counts as flowing until this long after the last frame was scheduled
    var CONTEXT_START_TIMEOUT_MS = 2000; // a context still not running this long after resume() is blocked
    var VOLUME_RAMP_SEC = 0.03; // gain time constant, so volume changes do not click

    // ---- Packet parser (strict, fail-closed) ------------------------------
    // Accepts a Uint8Array holding exactly one complete packet (the agent
    // module delivers one validated packet per binary websocket message, but
    // the viewer re-validates as defense in depth). Returns a parsed object or
    // throws on any malformation so the caller can fail closed.
    function parsePacket(bytes) {
        if (!bytes || typeof bytes.length !== 'number') { throw new Error('audio packet: no data'); }
        if (bytes.length < HEADER_LENGTH) { throw new Error('audio packet: short header'); }
        var view = toDataView(bytes);
        var version = view.getUint8(0);
        if (version !== PACKET_VERSION) { throw new Error('audio packet: bad version ' + version); }
        var type = view.getUint8(1);
        if (type !== PACKET_TYPE.CONFIG && type !== PACKET_TYPE.AUDIO && type !== PACKET_TYPE.SILENCE && type !== PACKET_TYPE.STATUS) {
            throw new Error('audio packet: unknown type ' + type);
        }
        var flags = view.getUint16(2, true);
        var sequence = view.getUint32(4, true);
        var timestampMs = view.getUint32(8, true);
        var payloadLength = view.getUint32(12, true);
        if (payloadLength > MAX_PAYLOAD) { throw new Error('audio packet: payload too large ' + payloadLength); }
        if (bytes.length !== HEADER_LENGTH + payloadLength) {
            throw new Error('audio packet: length mismatch, header says ' + payloadLength + ' have ' + (bytes.length - HEADER_LENGTH));
        }
        var payload = subarray(bytes, HEADER_LENGTH, HEADER_LENGTH + payloadLength);
        var packet = {
            version: version,
            type: type,
            flags: flags,
            discontinuity: (flags & FLAG_DISCONTINUITY) !== 0,
            sequence: sequence >>> 0,
            timestampMs: timestampMs >>> 0,
            payload: payload
        };
        if (type === PACKET_TYPE.CONFIG) {
            if (payloadLength !== CONFIG_PAYLOAD_LENGTH) { throw new Error('audio packet: bad CONFIG length ' + payloadLength); }
            packet.config = parseConfigPayload(payload);
        } else if (type === PACKET_TYPE.SILENCE) {
            if (payloadLength !== 0) { throw new Error('audio packet: SILENCE must be empty'); }
        } else if (type === PACKET_TYPE.STATUS) {
            if (payloadLength < 4) { throw new Error('audio packet: STATUS too short'); }
            packet.status = parseStatusPayload(payload);
        }
        return packet;
    }

    function parseConfigPayload(payload) {
        var view = toDataView(payload);
        var codec = view.getUint32(0, true);
        if (codec !== CODEC_OPUS) { throw new Error('audio packet: unsupported codec ' + codec); }
        var sampleRate = view.getUint32(4, true);
        var channels = view.getUint16(8, true);
        var frameMs = view.getUint16(10, true);
        var bitrate = view.getUint32(12, true);
        if (sampleRate <= 0 || channels <= 0 || channels > 8 || frameMs <= 0) { throw new Error('audio packet: bad CONFIG values'); }
        return { codec: codec, sampleRate: sampleRate, channels: channels, frameMs: frameMs, bitrate: bitrate };
    }

    function parseStatusPayload(payload) {
        var view = toDataView(payload);
        var code = view.getUint32(0, true);
        var reasonBytes = subarray(payload, 4, payload.length);
        if (reasonBytes.length > MAX_STATUS_REASON) { throw new Error('audio packet: STATUS reason too long'); }
        return { code: code >>> 0, reason: utf8Decode(reasonBytes) };
    }

    function toDataView(bytes) {
        // Works for Uint8Array (browser and Node) and Node Buffer.
        return new DataView(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength != null ? bytes.byteLength : bytes.length);
    }

    function subarray(bytes, start, end) {
        if (typeof bytes.subarray === 'function') { return bytes.subarray(start, end); }
        return bytes.slice(start, end);
    }

    function utf8Decode(bytes) {
        if (bytes.length === 0) { return ''; }
        if (typeof TextDecoder !== 'undefined') { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
        // Minimal UTF-8 decoder fallback (Node without global TextDecoder).
        var out = '', i = 0, c, c2, c3, c4;
        while (i < bytes.length) {
            c = bytes[i++];
            if (c < 0x80) { out += String.fromCharCode(c); }
            else if (c < 0xE0) { c2 = bytes[i++] & 0x3F; out += String.fromCharCode(((c & 0x1F) << 6) | c2); }
            else if (c < 0xF0) { c2 = bytes[i++] & 0x3F; c3 = bytes[i++] & 0x3F; out += String.fromCharCode(((c & 0x0F) << 12) | (c2 << 6) | c3); }
            else {
                c2 = bytes[i++] & 0x3F; c3 = bytes[i++] & 0x3F; c4 = bytes[i++] & 0x3F;
                var cp = ((c & 0x07) << 18) | (c2 << 12) | (c3 << 6) | c4;
                cp -= 0x10000;
                out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
            }
        }
        return out;
    }

    // ---- Jitter-buffer scheduler (pure, testable) -------------------------
    // Advances a monotonic playback cursor on a Web Audio timeline. Caller
    // passes the current context time (seconds) and the frame duration
    // (seconds); schedule() returns where to start the frame, or that it
    // should be dropped to keep latency bounded. No Web Audio dependency.
    function createAudioScheduler(options) {
        options = options || {};
        var maxLatencySec = (options.maxLatencyMs != null ? options.maxLatencyMs : MAX_LATENCY_MS) / 1000;
        var bufferLeadSec = (options.bufferLeadMs != null ? options.bufferLeadMs : BUFFER_LEAD_MS) / 1000;
        var nextStartTime = null; // null => not primed
        var stats = { scheduled: 0, dropped: 0, underruns: 0, resets: 0 };

        function reset() {
            if (nextStartTime !== null) { stats.resets++; }
            nextStartTime = null;
        }

        // nowSec: AudioContext.currentTime; frameDurSec: decoded frame length.
        // Returns { startTime } to play, or { dropped:true } to discard the
        // frame. reset/underrun flags report why the cursor was re-primed.
        function schedule(nowSec, frameDurSec) {
            if (!(frameDurSec > 0)) { return { dropped: true }; }
            if (nextStartTime === null) {
                var primeStart = nowSec + bufferLeadSec;
                nextStartTime = primeStart + frameDurSec;
                stats.scheduled++;
                return { startTime: primeStart, reset: true };
            }
            if (nextStartTime < nowSec) {
                // Cursor fell behind real time (underrun): re-prime with cushion.
                stats.underruns++;
                var reStart = nowSec + bufferLeadSec;
                nextStartTime = reStart + frameDurSec;
                stats.scheduled++;
                return { startTime: reStart, underrun: true, reset: true };
            }
            if ((nextStartTime - nowSec) > maxLatencySec) {
                // Too much queued: drop to shed latency. The cursor is left in
                // place so the backlog plays out and new frames resume once the
                // lead drops back under the cap (no overlap, no cursor jump).
                stats.dropped++;
                return { dropped: true };
            }
            var start = nextStartTime;
            nextStartTime += frameDurSec;
            stats.scheduled++;
            return { startTime: start };
        }

        return {
            schedule: schedule,
            reset: reset,
            getStats: function () { return { scheduled: stats.scheduled, dropped: stats.dropped, underruns: stats.underruns, resets: stats.resets }; },
            // Exposed for tests/inspection only.
            peekNextStartTime: function () { return nextStartTime; }
        };
    }

    // ---- Controller state machine (pure, testable) ------------------------
    // Tracks icon visibility and playback state independent of the DOM.
    // States: off, connecting, playing, unavailable, error.
    var AUDIO_STATES = { OFF: 'off', CONNECTING: 'connecting', PLAYING: 'playing', UNAVAILABLE: 'unavailable', ERROR: 'error' };

    // Maps an agent ctrl "state" to a controller state + whether it is terminal.
    function mapAgentStatus(agentState) {
        switch (agentState) {
            case 'started': return { state: AUDIO_STATES.PLAYING };
            case 'stopped': return { state: AUDIO_STATES.OFF };
            case 'unavailable': return { state: AUDIO_STATES.UNAVAILABLE };
            case 'nodesktop': return { state: AUDIO_STATES.UNAVAILABLE };
            case 'denied': return { state: AUDIO_STATES.UNAVAILABLE };
            case 'error': return { state: AUDIO_STATES.ERROR };
            default: return null;
        }
    }

    function defaultReasonFor(agentState) {
        switch (agentState) {
            case 'unavailable': return 'Audio is not available on this device';
            case 'nodesktop': return 'Audio needs an active desktop session';
            case 'denied': return 'Not permitted to listen to this device';
            case 'error': return 'Audio error';
            default: return '';
        }
    }

    function createAudioStateMachine() {
        var available = false; // icon visible only after the agent advertises it
        var state = AUDIO_STATES.OFF;
        var reason = '';
        // PLAYING needs both: the agent started capture, and the browser proved it outputs the stream
        // (player 'ready'). Either may come first; until both have, the session stays CONNECTING.
        var agentStarted = false;
        var playbackReady = false;
        function resetSession() { agentStarted = false; playbackReady = false; }
        function connectingOrPlaying() { return (agentStarted && playbackReady) ? AUDIO_STATES.PLAYING : AUDIO_STATES.CONNECTING; }

        function snapshot() { return { available: available, state: state, reason: reason }; }

        // Each handler returns the new snapshot. Unknown transitions are no-ops.
        return {
            getState: snapshot,
            isActive: function () { return state === AUDIO_STATES.CONNECTING || state === AUDIO_STATES.PLAYING; },
            // Agent advertised audio capability on the desktop tunnel.
            onAvailable: function () { available = true; return snapshot(); },
            // User clicked the icon to start listening.
            onStartRequested: function () {
                if (state === AUDIO_STATES.CONNECTING || state === AUDIO_STATES.PLAYING) { return snapshot(); }
                resetSession();
                state = AUDIO_STATES.CONNECTING; reason = ''; return snapshot();
            },
            // User clicked again (or desktop ended) to stop.
            onStopRequested: function () { resetSession(); state = AUDIO_STATES.OFF; reason = ''; return snapshot(); },
            // The player proved browser output is live (context running, decoder ready, stream live).
            onPlaybackReady: function () {
                if (state !== AUDIO_STATES.CONNECTING && state !== AUDIO_STATES.PLAYING) { return snapshot(); }
                playbackReady = true;
                state = connectingOrPlaying(); return snapshot();
            },
            // Agent ctrl status message.
            onAgentStatus: function (agentState, agentReason) {
                var mapped = mapAgentStatus(agentState);
                if (mapped === null) { return snapshot(); }
                if (mapped.state === AUDIO_STATES.PLAYING) {
                    // Capture started on the device; this alone does not mean the viewer hears anything.
                    if (state !== AUDIO_STATES.CONNECTING && state !== AUDIO_STATES.PLAYING) { return snapshot(); }
                    agentStarted = true;
                    state = connectingOrPlaying(); reason = ''; return snapshot();
                }
                resetSession();
                state = mapped.state;
                reason = (agentReason != null && agentReason !== '') ? String(agentReason) : defaultReasonFor(agentState);
                return snapshot();
            },
            // Local decode / audio-context failure.
            onLocalError: function (message) { resetSession(); state = AUDIO_STATES.ERROR; reason = message || 'Audio playback error'; return snapshot(); },
            // Audio tunnel closed unexpectedly while active.
            onTunnelClosed: function () {
                if (state === AUDIO_STATES.CONNECTING || state === AUDIO_STATES.PLAYING) { resetSession(); state = AUDIO_STATES.ERROR; reason = 'Audio connection closed'; }
                return snapshot();
            },
            // Desktop session ended: hide the icon and stop.
            onDesktopClosed: function () { resetSession(); available = false; state = AUDIO_STATES.OFF; reason = ''; return snapshot(); }
        };
    }

    // ---- Playback readiness (pure, testable) -----------------------------
    // "Playing" means the browser really outputs the stream, not just that the agent started capture:
    // the AudioContext is running, an Opus decoder is configured, and the stream has proven live (a
    // decoded frame was scheduled, or a SILENCE heartbeat arrived because nothing plays on the device).
    // Each setter returns 'ready' when that first becomes true, 'suspended' when the context stops
    // running after it, otherwise null.
    function createPlaybackReadiness() {
        var contextRunning = false, decoderReady = false, streamLive = false, ready = false;
        function evaluate() {
            if (!ready && contextRunning && decoderReady && streamLive) { ready = true; return 'ready'; }
            if (ready && !contextRunning) { ready = false; return 'suspended'; }
            return null;
        }
        return {
            setContextRunning: function (value) { contextRunning = !!value; return evaluate(); },
            setDecoderReady: function () { decoderReady = true; return evaluate(); },
            markStreamLive: function () { streamLive = true; return evaluate(); },
            isReady: function () { return ready; }
        };
    }

    // ---- Volume ----------------------------------------------------------
    // Maps any input (slider percent / stored string / number) to a gain in [0, 1]. Anything that is
    // not a finite number falls back to full volume rather than silently muting the session.
    function normalizeVolume(value) {
        var v = (typeof value === 'string') ? parseFloat(value) : value;
        if (typeof v !== 'number' || !isFinite(v)) { return 1; }
        if (v > 1) { v = v / 100; } // percent
        return Math.min(1, Math.max(0, v));
    }

    // ---- WebCodecs Opus support probe -------------------------------------
    // Returns a Promise<boolean>. Safe to call where WebCodecs is absent.
    function probeWebCodecsOpus(config) {
        try {
            if (typeof AudioDecoder === 'undefined' || typeof AudioDecoder.isConfigSupported !== 'function') {
                return Promise.resolve(false);
            }
            return AudioDecoder.isConfigSupported(config).then(function (result) {
                return !!(result && result.supported);
            }, function () { return false; });
        } catch (ex) {
            return Promise.resolve(false);
        }
    }

    // =======================================================================
    // Browser player. Only exercised in a browser with Web Audio; the Node
    // tests cover the pure helpers above and never reach this path.
    // =======================================================================
    function createMeshDesktopAudioPlayer(playerOptions) {
        playerOptions = playerOptions || {};
        var onStatus = typeof playerOptions.onStatus === 'function' ? playerOptions.onStatus : function () { };
        var onError = typeof playerOptions.onError === 'function' ? playerOptions.onError : function () { };
        // onActivity(true|false): non-silent decoded PCM was recently scheduled.
        var onActivity = typeof playerOptions.onActivity === 'function' ? playerOptions.onActivity : function () { };
        // onPlayback('ready' | 'blocked' | 'suspended', reason): the browser output path started, was
        // refused by the autoplay policy, or stopped (for example the OS took the audio device).
        var onPlayback = typeof playerOptions.onPlayback === 'function' ? playerOptions.onPlayback : function () { };
        var decoderScriptUrl = playerOptions.decoderScriptUrl || 'scripts/opus-decoder-0.7.11.min.js';
        var maxLatencyMs = playerOptions.maxLatencyMs != null ? playerOptions.maxLatencyMs : MAX_LATENCY_MS;
        var bufferLeadMs = playerOptions.bufferLeadMs != null ? playerOptions.bufferLeadMs : BUFFER_LEAD_MS;

        var audioContext = playerOptions.audioContext || null;
        var ownsContext = !audioContext;
        var gainNode = null;
        var scheduler = createAudioScheduler({ maxLatencyMs: maxLatencyMs, bufferLeadMs: bufferLeadMs });
        var config = null;              // last CONFIG payload
        var decoderKind = null;         // 'webcodecs' | 'opus-decoder'
        var webDecoder = null;          // WebCodecs AudioDecoder
        var wasmDecoder = null;         // opus-decoder OpusDecoder
        var wasmReady = false;          // decoder initialization completed
        var decoderGeneration = 0;     // invalidates asynchronous setup and output
        var activeSources = [];         // scheduled AudioBufferSourceNodes
        var running = false;
        var teardownCalled = false;
        var decodeTimestamp = 0;        // microseconds for WebCodecs chunks
        var volume = normalizeVolume(playerOptions.volume != null ? playerOptions.volume : 1);
        var active = false;             // last value reported through onActivity
        var activityTimer = null;
        var readiness = createPlaybackReadiness();
        var contextTimer = null;        // fires 'blocked' if the context never starts running
        var sawRunning = false;         // the context ran at least once in this session

        function reportPlayback(transition, reason) {
            if (transition == null || !running) { return; }
            try { onPlayback(transition, reason || ''); } catch (ex) { /* UI callback errors must not stop playback */ }
        }

        function onContextStateChange() {
            if (audioContext == null) { return; }
            var isRunning = (audioContext.state === 'running');
            if (isRunning && contextTimer != null) { clearTimeout(contextTimer); contextTimer = null; }
            var transition = readiness.setContextRunning(isRunning);
            // A context that ran and then stopped before playback was ready (device switch, OS audio
            // interruption) is a suspension too; with a silent device nothing else would ever report it.
            if (transition == null && !isRunning && sawRunning) { transition = 'suspended'; }
            sawRunning = sawRunning || isRunning;
            reportPlayback(transition, 'The browser paused audio playback');
        }

        // Use (or create) the AudioContext and make it run. The caller should pass a context created
        // and resumed inside the user's click, because autoplay policy only lets a gesture start
        // audio. The context's real state decides readiness: a resume() that is refused, or that never
        // completes, reports 'blocked' instead of letting the UI claim playback.
        function ensureContext() {
            if (audioContext == null) {
                var Ctor = (typeof AudioContext !== 'undefined') ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
                if (Ctor == null) { throw new Error('Web Audio is not supported'); }
                audioContext = new Ctor({ latencyHint: 'interactive', sampleRate: 48000 });
                ownsContext = true;
            }
            if (gainNode == null) {
                gainNode = audioContext.createGain();
                gainNode.gain.value = volume;
                gainNode.connect(audioContext.destination);
            }
            if (typeof audioContext.addEventListener === 'function') { audioContext.addEventListener('statechange', onContextStateChange); }
            if (audioContext.state !== 'running' && typeof audioContext.resume === 'function') {
                var resumed = null;
                try { resumed = audioContext.resume(); } catch (ex) { resumed = null; }
                if (resumed && typeof resumed.then === 'function') {
                    resumed.then(onContextStateChange, function (err) {
                        reportPlayback('blocked', 'The browser blocked audio playback (' + (err && err.message ? err.message : err) + '); click the speaker to try again');
                    });
                }
                contextTimer = setTimeout(function () {
                    contextTimer = null;
                    if (running && audioContext != null && audioContext.state !== 'running') {
                        reportPlayback('blocked', 'The browser blocked audio playback; click the speaker to try again');
                    }
                }, CONTEXT_START_TIMEOUT_MS);
            }
            onContextStateChange();
            return audioContext;
        }

        // Pick a decoder for the negotiated CONFIG. Resolves to the decoder kind.
        function selectDecoder(cfg, generation) {
            var webConfig = { codec: 'opus', sampleRate: cfg.sampleRate, numberOfChannels: cfg.channels };
            return probeWebCodecsOpus(webConfig).then(function (supported) {
                if (!running || generation !== decoderGeneration) { return; }
                if (supported) {
                    decoderKind = 'webcodecs';
                    webDecoder = new AudioDecoder({
                        output: function (audioData) {
                            try {
                                if (running && generation === decoderGeneration) { onDecodedAudioData(audioData); }
                            } finally { audioData.close(); }
                        },
                        error: function (err) {
                            if (running && generation === decoderGeneration) { failLocal('Audio decode error: ' + err.message); }
                        }
                    });
                    webDecoder.configure(webConfig);
                    return;
                }
                return loadDecoderScript().then(function (OpusDecoder) {
                    if (!running || generation !== decoderGeneration) { return; }
                    var decoder = new OpusDecoder({ channels: cfg.channels, sampleRate: cfg.sampleRate, forceStereo: cfg.channels === 2 });
                    // An initializing WASM decoder cannot safely be freed until ready.
                    return decoder.ready.then(function () {
                        if (!running || generation !== decoderGeneration) { decoder.free(); return; }
                        wasmDecoder = decoder;
                        wasmReady = true;
                        decoderKind = 'opus-decoder';
                    }, function (err) {
                        try { decoder.free(); } catch (ex) { }
                        throw err;
                    });
                });
            });
        }

        // Lazily load the vendored opus-decoder only when WebCodecs is absent.
        var decoderScriptPromise = null;
        function loadDecoderScript() {
            if (decoderScriptPromise) { return decoderScriptPromise; }
            decoderScriptPromise = new Promise(function (resolve, reject) {
                var existing = window['opus-decoder'];
                if (existing && existing.OpusDecoder) { resolve(existing.OpusDecoder); return; }
                var script = document.createElement('script');
                script.src = decoderScriptUrl;
                script.async = true;
                script.onload = function () {
                    var mod = window['opus-decoder'];
                    if (mod && mod.OpusDecoder) { resolve(mod.OpusDecoder); }
                    else { reject(new Error('opus-decoder did not register')); }
                };
                script.onerror = function () { reject(new Error('Failed to load opus-decoder')); };
                document.head.appendChild(script);
            });
            return decoderScriptPromise;
        }

        // ---- Packet intake ----
        // Called with a Uint8Array holding exactly one packet. Returns false
        // (and fails closed) on any malformed frame.
        function handlePacket(bytes) {
            if (!running) { return true; }
            var packet;
            try { packet = parsePacket(bytes); } catch (ex) { failLocal('Malformed audio packet: ' + ex.message); return false; }
            switch (packet.type) {
                case PACKET_TYPE.CONFIG: applyConfig(packet); break;
                case PACKET_TYPE.AUDIO: handleAudio(packet); break;
                case PACKET_TYPE.SILENCE:
                    if (packet.discontinuity) { resetPlayback(); }
                    // Silence, not loss: keep the cursor as-is. After CONFIG it proves the stream is live
                    // even when nothing plays on the device.
                    if (config != null) { reportPlayback(readiness.markStreamLive()); }
                    break;
                case PACKET_TYPE.STATUS: onStatus({ state: 'error', code: packet.status.code, reason: packet.status.reason }); break;
                default: break;
            }
            return true;
        }

        function applyConfig(packet) {
            // Device changes and replayed CONFIG are boundaries, including when
            // the format is unchanged. Discard queued output from the old decoder.
            config = packet.config;
            resetPlayback();
            resetDecoder();
            var generation = decoderGeneration;
            selectDecoder(config, generation).then(function () {
                if (running && generation === decoderGeneration) { reportPlayback(readiness.setDecoderReady()); }
            }).catch(function (err) {
                if (running && generation === decoderGeneration) { failLocal('No usable Opus decoder: ' + (err && err.message ? err.message : err)); }
            });
        }

        function setActive(value) {
            if (active === value) { return; }
            active = value;
            try { onActivity(value); } catch (ex) { /* UI callback errors must not stop playback */ }
        }

        function markActivity() {
            setActive(true);
            if (activityTimer != null) { clearTimeout(activityTimer); }
            activityTimer = setTimeout(function () { activityTimer = null; setActive(false); }, ACTIVITY_HOLD_MS);
        }

        function setVolume(value) {
            volume = normalizeVolume(value);
            if (gainNode == null || audioContext == null) { return volume; }
            try { gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, VOLUME_RAMP_SEC); }
            catch (ex) { gainNode.gain.value = volume; }
            return volume;
        }

        function handleAudio(packet) {
            // Reset is driven solely by the DISCONTINUITY flag, never by gaps in
            // sequence/timestamp. The agent replays the live CONFIG (and may
            // deliver audio) with the original sequence/timestamp and the
            // DISCONTINUITY flag set to a viewer that joins a running helper, so
            // a backward/forward jump is a resync point, not packet loss.
            if (packet.discontinuity) { resetPlayback(); }
            if (config == null) { return; } // no CONFIG yet; drop until negotiated
            if (decoderKind === 'webcodecs') {
                if (webDecoder == null || webDecoder.decodeQueueSize >= Math.ceil(maxLatencyMs / config.frameMs)) { return; }
                try {
                    var chunk = new EncodedAudioChunk({ type: 'key', timestamp: decodeTimestamp, duration: config.frameMs * 1000, data: packet.payload });
                    decodeTimestamp += config.frameMs * 1000;
                    webDecoder.decode(chunk);
                } catch (ex) { failLocal('Audio decode error: ' + ex.message); }
            } else if (decoderKind === 'opus-decoder') {
                // Drop while initializing: never queue live audio in ready.then().
                if (wasmDecoder == null || !wasmReady) { return; }
                try {
                    var decoded = wasmDecoder.decodeFrame(packet.payload);
                    if (decoded && decoded.errors && decoded.errors.length) { throw new Error('Invalid Opus frame'); }
                    if (decoded && decoded.channelData && decoded.samplesDecoded > 0) {
                        playPcm(decoded.channelData, decoded.samplesDecoded, decoded.sampleRate || config.sampleRate);
                    }
                } catch (ex) { failLocal('Audio decode error: ' + ex.message); }
            }
        }

        // WebCodecs AudioData -> per-channel Float32 -> schedule.
        function onDecodedAudioData(audioData) {
            if (!running || audioContext == null) { return; }
            var channels = audioData.numberOfChannels;
            var frames = audioData.numberOfFrames;
            var rate = audioData.sampleRate || (config ? config.sampleRate : 48000);
            var channelData = [];
            for (var c = 0; c < channels; c++) {
                var plane = new Float32Array(frames);
                try { audioData.copyTo(plane, { planeIndex: c, format: 'f32-planar' }); }
                catch (ex) { failLocal('Audio copy error: ' + ex.message); return; }
                channelData.push(plane);
            }
            playPcm(channelData, frames, rate);
        }

        // Build an AudioBuffer from decoded PCM and schedule it per the jitter buffer.
        function playPcm(channelData, frames, rate) {
            if (!running || audioContext == null || frames <= 0) { return; }
            // Not running yet (resume() still settling) or paused: drop the frame. A context that never
            // starts is reported by the start timer, one that stops by the statechange handler.
            if (audioContext.state !== 'running') { return; }
            try {
                var frameDurSec = frames / rate;
                var decision = scheduler.schedule(audioContext.currentTime, frameDurSec);
                if (decision.dropped) { return; }
                var buffer = audioContext.createBuffer(channelData.length, frames, rate);
                for (var c = 0; c < channelData.length; c++) {
                    if (typeof buffer.copyToChannel === 'function') { buffer.copyToChannel(channelData[c], c, 0); }
                    else { buffer.getChannelData(c).set(channelData[c]); }
                }
                var src = audioContext.createBufferSource();
                src.buffer = buffer;
                src.connect(gainNode);
                src.onended = function () { removeSource(src); };
                activeSources.push(src);
                src.start(decision.startTime);
                // Any scheduled frame proves the stream is live (readiness below); only audible
                // samples drive the playing animation, so encoded silence does not animate it.
                var audible = false;
                for (var ch = 0; ch < channelData.length && !audible; ch++) {
                    for (var sample = 0; sample < frames; sample++) {
                        if (Math.abs(channelData[ch][sample]) > 0.00001) { audible = true; break; }
                    }
                }
                if (audible) { markActivity(); }
                reportPlayback(readiness.markStreamLive());
            } catch (ex) { failLocal('Audio playback error: ' + ex.message); }
        }

        function removeSource(src) {
            var i = activeSources.indexOf(src);
            if (i >= 0) { activeSources.splice(i, 1); }
            try { src.disconnect(); } catch (ex) { /* ignore */ }
        }

        function resetPlayback() {
            for (var i = 0; i < activeSources.length; i++) {
                try { activeSources[i].stop(); } catch (ex) { }
                try { activeSources[i].disconnect(); } catch (ex2) { }
            }
            activeSources = [];
            scheduler.reset();
        }

        function resetDecoder() {
            decoderGeneration++;
            decoderKind = null;
            if (webDecoder != null) { try { webDecoder.close(); } catch (ex) { } webDecoder = null; }
            if (wasmDecoder != null) { try { wasmDecoder.free(); } catch (ex) { } wasmDecoder = null; wasmReady = false; }
            decodeTimestamp = 0;
        }

        function failLocal(message) {
            if (!running) { return; }
            teardown();
            onError(message);
        }

        function start() {
            if (running) { return; }
            running = true;
            teardownCalled = false;
            readiness = createPlaybackReadiness();
            try { ensureContext(); } catch (ex) { failLocal('Audio playback error: ' + ex.message); }
        }

        function teardown() {
            if (teardownCalled) { return; }
            teardownCalled = true;
            running = false;
            config = null;
            if (activityTimer != null) { clearTimeout(activityTimer); activityTimer = null; }
            if (contextTimer != null) { clearTimeout(contextTimer); contextTimer = null; }
            if (audioContext != null && typeof audioContext.removeEventListener === 'function') { audioContext.removeEventListener('statechange', onContextStateChange); }
            setActive(false);
            resetPlayback();
            resetDecoder();
            if (gainNode != null) { try { gainNode.disconnect(); } catch (ex) { } gainNode = null; }
            if (ownsContext && audioContext != null) { try { audioContext.close(); } catch (ex) { } audioContext = null; }
        }

        return {
            start: start,
            handlePacket: handlePacket,
            stop: teardown,
            setVolume: setVolume,
            getVolume: function () { return volume; },
            isActive: function () { return active; },
            isPlaybackReady: function () { return readiness.isReady(); },
            getDecoderKind: function () { return decoderKind; },
            getStats: function () { return scheduler.getStats(); },
            isRunning: function () { return running; }
        };
    }

    return {
        // Protocol constants
        HEADER_LENGTH: HEADER_LENGTH,
        MAX_PAYLOAD: MAX_PAYLOAD,
        PACKET_VERSION: PACKET_VERSION,
        PACKET_TYPE: PACKET_TYPE,
        FLAG_DISCONTINUITY: FLAG_DISCONTINUITY,
        CODEC_OPUS: CODEC_OPUS,
        MAX_LATENCY_MS: MAX_LATENCY_MS,
        ACTIVITY_HOLD_MS: ACTIVITY_HOLD_MS,
        BUFFER_LEAD_MS: BUFFER_LEAD_MS,
        AUDIO_STATES: AUDIO_STATES,
        // Pure, testable helpers
        parsePacket: parsePacket,
        createAudioScheduler: createAudioScheduler,
        createAudioStateMachine: createAudioStateMachine,
        createPlaybackReadiness: createPlaybackReadiness,
        normalizeVolume: normalizeVolume,
        mapAgentStatus: mapAgentStatus,
        defaultReasonFor: defaultReasonFor,
        probeWebCodecsOpus: probeWebCodecsOpus,
        // Browser player
        createMeshDesktopAudioPlayer: createMeshDesktopAudioPlayer
    };
}));
