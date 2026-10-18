/*! @license
 * Trackpad ("mouse pointer") gesture engine for the remote desktop viewer.
 *
 * This file is a modified derivative of two works. It is distributed under the
 * Apache License, Version 2.0, with the BSD-licensed portion also under the
 * terms reproduced below.
 *
 * 1. Apache Guacamole, guacamole-common-js/src/main/webapp/modules/Mouse.js
 *    (Guacamole.Mouse.Touchpad and Guacamole.Mouse.Touchscreen), at
 *    apache/guacamole-client commit 31d2a6f6accc5ed4fecd491c30fc51728db940eb.
 *
 *    Licensed to the Apache Software Foundation (ASF) under one
 *    or more contributor license agreements.  See the NOTICE file
 *    distributed with this work for additional information
 *    regarding copyright ownership.  The ASF licenses this file
 *    to you under the Apache License, Version 2.0 (the
 *    "License"); you may not use this file except in compliance
 *    with the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing,
 *    software distributed under the License is distributed on an
 *    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 *    KIND, either express or implied.  See the License for the
 *    specific language governing permissions and limitations
 *    under the License.
 *
 *    Apache Guacamole
 *    Copyright 2020 The Apache Software Foundation
 *    This product includes software developed at
 *    The Apache Software Foundation (https://www.apache.org/).
 *
 *    Modified: the touch handling was rewritten as a DOM-free state machine
 *    driven by an injected clock and emitting absolute pointer state in remote
 *    pixels. The changes include: Euclidean tap slop measured from the touch
 *    start and not scaled by devicePixelRatio; double-tap timing measured per
 *    tap; no cursor movement while a tapped button is held until the finger
 *    passes the slop; the Touchscreen long-press timer used for a right click
 *    on lift; multi-finger taps timed from the last finger to land; every
 *    scroll step emitted; a velocity time floor and gain cap; touch lists
 *    reconciled against the fingers in the gesture; and button release on
 *    cancel, on finger-count changes and on teardown, with the left button
 *    never stranded by a multi-finger second touch.
 *
 * 2. The two-finger swipe/pinch classifier is a JavaScript re-implementation of
 *    Chromium remoting/android/java/src/org/chromium/chromoting/
 *    SwipePinchDetector.java, at Chromium tag 90.0.4430.0, which carries
 *    "Copyright 2013 The Chromium Authors. All rights reserved." and is
 *    governed by the Chromium LICENSE file:
 *
 *    Copyright 2015 The Chromium Authors. All rights reserved.
 *
 *    Redistribution and use in source and binary forms, with or without
 *    modification, are permitted provided that the following conditions are
 *    met:
 *
 *       * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *       * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following disclaimer
 *    in the documentation and/or other materials provided with the
 *    distribution.
 *       * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 *    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 *    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 *    LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 *    A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 *    OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 *    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 *    LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 *    DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 *    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 *    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 *    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
// The engine turns touch samples into an absolute remote pointer: a cursor in remote pixels moved
// by relative finger motion, a button mask, wheel notches and local zoom requests. It knows nothing
// about the DOM or the wire protocol; an adapter feeds it touches and forwards what it emits.
//
// Gestures: one-finger drag moves the cursor (accelerated); tap = left click; two taps = double
// click; tap then touch-and-drag = left drag; long press then lift = right click; two-finger tap =
// right click; three-finger tap = middle click; two-finger parallel drag = wheel; pinch = zoom
// (when the adapter supports it).
//
// Contract for adapters:
// - touchStart/touchMove take the full list of touches now down (TouchEvent.touches); touchEnd
//   takes the touches still down. Each is [{ id, x, y }] in CSS pixels. Ids the gesture never saw
//   start are ignored, and a known finger missing from a list is treated as lifted.
// - Output is delivered after the engine's state is updated, so a callback may call back into the
//   engine (for example reset() from pointer()).
// - pointer(x, y, buttons): integer remote pixels on the current screen; buttons 1 left, 2 right,
//   4 middle. Only a release is ever sent while the geometry is unusable, at the last position.
// - wheel(x, y, notches): integer, non-zero; positive when the fingers move down, matching the
//   upstream view (wheelDelta = -dy). A sink for an agent that takes one notch per packet must
//   send |notches| packets.
// - zoom(ratio, cssX, cssY): incremental ratio since the previous zoom call, at the current
//   two-finger midpoint.
// - setCursor() is ignored while a button is held.
var MeshTrackpadEngine = (function () {
    'use strict';

    var LEFT = 1, RIGHT = 2, MIDDLE = 4;
    var TAP_BUTTONS = { 1: LEFT, 2: RIGHT, 3: MIDDLE };

    var DEFAULTS = {
        tapMaxMs: 250,              // a tap lasts at most this long (Guacamole clickTimingThreshold); multi-finger taps are timed from the last finger to land
        tapSlopCssPx: 10,           // a finger displaced further than this from its start is not a tap
        clickReleaseDelayMs: 250,   // after a tap the button stays down this long, so a second touch can drag or double-click
        longPressMs: 500,           // one finger held still this long, then lifted, is a right click
        scrollCssPxPerNotch: 30,    // two-finger travel per wheel notch
        pinchSlopCssPx: 8,          // swipe/pinch classifier touch slop
        velocityWindowMs: 0,        // 0: Guacamole's whole-gesture average velocity; >0: velocity over this recent window
        velocityMinMs: 16,          // whole-gesture velocity time floor, so a move in the touch's own frame cannot spike the gain
        maxGain: 3                  // upper bound on the acceleration gain
    };

    function merge(base, extra) {
        var out = {}, k;
        for (k in base) { out[k] = base[k]; }
        if (extra) {
            for (k in extra) {
                if (!Object.prototype.hasOwnProperty.call(base, k)) continue;
                var v = Number(extra[k]);
                if (isFinite(v) && v >= 0 && !(k === 'maxGain' && v < 1)) { out[k] = v; }
            }
        }
        return out;
    }

    function clamp(v, lo, hi) { return (v < lo) ? lo : ((v > hi) ? hi : v); }
    function finite(v) { return (typeof v === 'number') && isFinite(v); }

    // options.clock:    { now(), setTimeout(fn, ms), clearTimeout(id) }
    // options.geometry: () => { width, height, remotePerCss } for the current remote screen and zoom
    // options.output:   { pointer(x, y, buttons), wheel(x, y, notches), zoom(ratio, cssX, cssY), pinchSupported() }
    function create(options) {
        var clock = options.clock, geometry = options.geometry, output = options.output;
        var config = merge(DEFAULTS, options.config);
        var cursor = { x: 0, y: 0 };            // remote pixels, kept fractional
        var buttons = 0;
        var lastSent = null;                    // { x, y, buttons } last queued for output.pointer
        var seq = null;                         // the touch sequence in progress
        var pendingTimer = null, pendingButton = 0;
        var longPressTimer = null;
        var queue = [], depth = 0;

        // Every entry point runs through this, and output waits until the outermost one is done.
        function entry(fn) {
            return function () {
                depth++;
                try { return fn.apply(null, arguments); }
                finally { depth--; if (depth === 0) { flush(); } }
            };
        }

        function flush() {
            while (queue.length) {
                var item = queue.shift();
                item[0].apply(null, item[1]);
            }
        }

        function send(fn, args) { if (typeof fn === 'function') { queue.push([fn, args]); } }

        function now() { return clock.now(); }

        function screen() {
            var g = geometry();
            return (g && g.width > 0 && g.height > 0 && finite(g.remotePerCss) && g.remotePerCss > 0) ? g : null;
        }

        function emit() {
            var g = screen();
            if (!g) {
                // No usable screen: only release what was already sent, at the last position.
                if (lastSent && buttons !== lastSent.buttons && (buttons & ~lastSent.buttons) === 0) {
                    lastSent = { x: lastSent.x, y: lastSent.y, buttons: buttons };
                    send(output.pointer, [lastSent.x, lastSent.y, buttons]);
                }
                return;
            }
            cursor.x = clamp(cursor.x, 0, g.width - 1);
            cursor.y = clamp(cursor.y, 0, g.height - 1);
            var x = clamp(Math.round(cursor.x), 0, g.width - 1), y = clamp(Math.round(cursor.y), 0, g.height - 1);
            if (lastSent && lastSent.x === x && lastSent.y === y && lastSent.buttons === buttons) return;
            lastSent = { x: x, y: y, buttons: buttons };
            send(output.pointer, [x, y, buttons]);
        }

        function press(b) { if (!(buttons & b) && screen()) { buttons |= b; emit(); } }
        function release(b) { if (buttons & b) { buttons &= ~b; emit(); } }
        function click(b) { press(b); release(b); }

        function clearPending() {
            if (pendingTimer !== null) { clock.clearTimeout(pendingTimer); pendingTimer = null; }
            pendingButton = 0;
        }

        var pendingFired = entry(function () {
            pendingTimer = null;
            var held = pendingButton;
            pendingButton = 0;
            release(held);
        });

        function schedulePending(b) {
            clearPending();
            if (!(buttons & b)) return;
            pendingButton = b;
            pendingTimer = clock.setTimeout(pendingFired, config.clickReleaseDelayMs);
        }

        function clearLongPress() {
            if (longPressTimer !== null) { clock.clearTimeout(longPressTimer); longPressTimer = null; }
        }

        var longPressFired = entry(function () {
            longPressTimer = null;
            if (seq && seq.kind === 'one' && !seq.moved && !seq.holding) { seq.longPressFired = true; }
        });

        function startLongPress() {
            clearLongPress();
            longPressTimer = clock.setTimeout(longPressFired, config.longPressMs);
        }

        function releaseAll() {
            clearPending();
            if (buttons) { buttons = 0; emit(); }
        }

        // Valid touches only, first occurrence of each id.
        function fingerList(touches) {
            var list = [], seen = {};
            for (var i = 0; touches && i < touches.length; i++) {
                var t = touches[i];
                if (!t || seen[t.id] || !finite(t.x) || !finite(t.y)) continue;
                seen[t.id] = true;
                list.push({ id: t.id, x: t.x, y: t.y });
            }
            return list;
        }

        function findTouch(touches, id) {
            for (var i = 0; i < touches.length; i++) { if (touches[i].id === id) return touches[i]; }
            return null;
        }

        function addFinger(t) {
            seq.fingers[t.id] = { sx: t.x, sy: t.y, x: t.x, y: t.y, lx: t.x, ly: t.y, lifted: false };
            seq.order.push(t.id);
        }

        function activeIds() {
            var ids = [];
            for (var i = 0; i < seq.order.length; i++) { if (!seq.fingers[seq.order[i]].lifted) ids.push(seq.order[i]); }
            return ids;
        }

        function kindFor(count) { return (count === 1) ? 'one' : ((count === 2) ? 'two' : 'three'); }

        function newSequence(touches, holding) {
            seq = {
                start: now(), lastJoin: now(), fingers: {}, order: [], max: touches.length,
                kind: kindFor(touches.length), holding: holding, dragging: false, moved: false, lifting: false,
                longPressFired: false, classified: null, pairStart: null, scrollAcc: 0, lastMidY: 0, lastDist: 0,
                startCursor: { x: cursor.x, y: cursor.y }, pixels: 0, samples: []
            };
            for (var i = 0; i < touches.length; i++) addFinger(touches[i]);
        }

        // A known finger is missing from the touches now down: it lifted (its touchend may have been
        // lost). Returns false when no finger of the gesture is down any more.
        function noteLifts(touches) {
            var lifted = false, ids = activeIds();
            for (var i = 0; i < ids.length; i++) {
                if (!findTouch(touches, ids[i])) { seq.fingers[ids[i]].lifted = true; lifted = true; }
            }
            if (activeIds().length === 0) return false;
            if (lifted) {
                // Some fingers lifted: the gesture can still end as a multi-finger tap, but nothing
                // else happens until every finger is up.
                if (buttons) releaseAll();
                seq.lifting = true;
            }
            return true;
        }

        // Every finger of the gesture vanished without the end being seen: drop it without a click.
        function abandon() {
            clearLongPress();
            seq = null;
            releaseAll();
        }

        function touchStart(touches) {
            touches = fingerList(touches);
            if (touches.length === 0) return;
            if (seq !== null && !noteLifts(touches)) abandon();
            if (seq === null) {
                var holding = false;
                if (pendingTimer !== null) {
                    if (touches.length === 1) {
                        // Tap-and-a-half: keep the tapped button down for a drag or a second click.
                        clock.clearTimeout(pendingTimer);
                        pendingTimer = null;
                        holding = true;
                    } else {
                        releaseAll();
                    }
                } else if (buttons) {
                    releaseAll();
                }
                newSequence(touches, holding);
                if (seq.kind === 'one' && !holding) startLongPress();
                if (seq.kind === 'two') beginPair();
                return;
            }
            var added = 0;
            for (var i = 0; i < touches.length; i++) {
                if (!seq.fingers[touches[i].id]) { addFinger(touches[i]); added++; }
            }
            if (added === 0) return;                        // a repeated start for fingers already known
            if (seq.kind === 'dead' || seq.lifting) return;
            var count = activeIds().length;
            seq.max = Math.max(seq.max, count);
            seq.lastJoin = now();
            clearLongPress();
            if (buttons) {
                // A finger joined while a button is held: end the press before anything else.
                releaseAll();
                seq.kind = 'dead';
                return;
            }
            var kind = kindFor(count);
            if (kind !== seq.kind) {
                seq.kind = kind;
                if (kind === 'two') beginPair();
            }
        }

        function updateFingers(touches) {
            for (var i = 0; i < touches.length; i++) {
                var f = seq.fingers[touches[i].id];
                if (!f || f.lifted) continue;
                f.lx = f.x; f.ly = f.y;
                f.x = touches[i].x; f.y = touches[i].y;
                var dx = f.x - f.sx, dy = f.y - f.sy;
                if (dx * dx + dy * dy > config.tapSlopCssPx * config.tapSlopCssPx) seq.moved = true;
            }
        }

        function gainFor(t, distance) {
            var v;
            if (config.velocityWindowMs > 0) {
                seq.samples.push({ t: t, d: distance });
                while (seq.samples.length && seq.samples[0].t < t - config.velocityWindowMs) seq.samples.shift();
                var sum = 0;
                for (var i = 0; i < seq.samples.length; i++) sum += seq.samples[i].d;
                v = sum / config.velocityWindowMs;
            } else {
                seq.pixels += distance;
                v = seq.pixels / Math.max(config.velocityMinMs, 1, t - seq.start);
            }
            return Math.min(config.maxGain, 1 + v);
        }

        function moveCursor(dx, dy) {
            var g = screen();
            if (!g || !finite(dx) || !finite(dy)) return;
            var gain = gainFor(now(), Math.abs(dx) + Math.abs(dy));
            cursor.x += dx * gain * g.remotePerCss;
            cursor.y += dy * gain * g.remotePerCss;
            emit();
        }

        // Swipe/pinch classification (Chromium SwipePinchDetector).
        function pair() {
            var ids = activeIds();
            var a = seq.fingers[ids[0]], b = seq.fingers[ids[1]];
            return (a && b) ? [a, b] : null;
        }

        function beginPair() {
            var p = pair();
            if (!p) return;
            seq.classified = null;
            seq.pairStart = [{ x: p[0].x, y: p[0].y }, { x: p[1].x, y: p[1].y }];
            seq.lastMidY = (p[0].y + p[1].y) / 2;
            seq.lastDist = Math.sqrt(Math.pow(p[0].x - p[1].x, 2) + Math.pow(p[0].y - p[1].y, 2));
            seq.scrollAcc = 0;
        }

        function classify(p) {
            var s0 = seq.pairStart[0], s1 = seq.pairStart[1];
            var dx0 = p[0].x - s0.x, dy0 = p[0].y - s0.y, dx1 = p[1].x - s1.x, dy1 = p[1].y - s1.y;
            var d0 = dx0 * dx0 + dy0 * dy0, d1 = dx1 * dx1 + dy1 * dy1;
            var slopSq = config.pinchSlopCssPx * config.pinchSlopCssPx, pinchSq = 4 * slopSq;
            var moved0 = d0 > slopSq, moved1 = d1 > slopSq;
            if (!moved0 && !moved1) return null;
            if (moved0 && !moved1) return (d0 > pinchSq) ? 'pinch' : null;
            if (!moved0 && moved1) return (d1 > pinchSq) ? 'pinch' : null;
            return ((dx0 * dx1 + dy0 * dy1) > 0) ? 'swipe' : 'pinch';
        }

        function twoFingerMove() {
            var p = pair();
            if (!p) return;
            if (seq.classified === null) {
                seq.classified = classify(p);
                if (seq.classified === null) return;
            }
            var midY = (p[0].y + p[1].y) / 2;
            if (seq.classified === 'swipe') {
                seq.scrollAcc += midY - seq.lastMidY;
                seq.lastMidY = midY;
                var notches = 0, step = config.scrollCssPxPerNotch;
                if (!(step > 0)) return;
                while (seq.scrollAcc >= step) { seq.scrollAcc -= step; notches++; }
                while (seq.scrollAcc <= -step) { seq.scrollAcc += step; notches--; }
                var g = screen();
                if (notches !== 0 && g) {
                    send(output.wheel, [clamp(Math.round(cursor.x), 0, g.width - 1), clamp(Math.round(cursor.y), 0, g.height - 1), notches]);
                }
            } else {
                var dist = Math.sqrt(Math.pow(p[0].x - p[1].x, 2) + Math.pow(p[0].y - p[1].y, 2));
                if (seq.lastDist > 0 && dist > 0 && output.pinchSupported && output.pinchSupported()) {
                    send(output.zoom, [dist / seq.lastDist, (p[0].x + p[1].x) / 2, midY]);
                }
                if (dist > 0) seq.lastDist = dist;
            }
        }

        function touchMove(touches) {
            if (seq === null) return;
            touches = fingerList(touches);
            if (!noteLifts(touches)) { finish(); return; }
            updateFingers(touches);
            if (seq.kind === 'dead' || seq.lifting) return;
            if (seq.kind === 'one') {
                if (seq.moved) { clearLongPress(); seq.longPressFired = false; }
                var f = seq.fingers[activeIds()[0]];
                if (seq.holding) {
                    // The tapped button is still down: jitter below the slop must not drag. Once the
                    // finger passes the slop this is a drag, applied from the touch start.
                    if (!seq.moved) return;
                    if (!seq.dragging) { seq.dragging = true; moveCursor(f.x - f.sx, f.y - f.sy); return; }
                }
                moveCursor(f.x - f.lx, f.y - f.ly);
            } else if (seq.kind === 'two') {
                twoFingerMove();
            }
        }

        // remaining: the touches still down after this one lifted.
        function touchEnd(remaining) {
            if (seq === null) return;
            if (noteLifts(fingerList(remaining))) return;
            finish();
        }

        function finish() {
            clearLongPress();
            var s = seq;
            seq = null;
            var t = now();
            var tap = !s.moved && !s.classified && (s.lastJoin - s.start) <= config.tapMaxMs && (t - s.lastJoin) <= config.tapMaxMs;
            if (s.kind === 'one') {
                if (s.holding) {
                    var held = buttons;
                    if (tap && held) {
                        // Second tap of a double click: the cursor has not moved, so it is the same point.
                        release(held);
                        press(held);
                        schedulePending(held);
                    } else {
                        releaseAll();
                    }
                    return;
                }
                if (s.longPressFired && !s.moved) {
                    cursor.x = s.startCursor.x; cursor.y = s.startCursor.y;
                    click(RIGHT);
                    return;
                }
                if (tap) {
                    cursor.x = s.startCursor.x; cursor.y = s.startCursor.y;
                    press(LEFT);
                    schedulePending(LEFT);
                }
                return;
            }
            if ((s.kind === 'two' || s.kind === 'three') && tap && TAP_BUTTONS[s.max]) {
                cursor.x = s.startCursor.x; cursor.y = s.startCursor.y;
                click(TAP_BUTTONS[s.max]);
            }
        }

        // The browser cancelled the touches, or the adapter is tearing down: release everything.
        function reset() {
            clearLongPress();
            seq = null;
            releaseAll();
            lastSent = null;
        }

        function setCursor(x, y) {
            if (buttons || !finite(x) || !finite(y)) return false;
            cursor.x = x; cursor.y = y;
            emit();
            return true;
        }

        return {
            touchStart: entry(touchStart),
            touchMove: entry(touchMove),
            touchEnd: entry(touchEnd),
            touchCancel: entry(reset),
            reset: entry(reset),
            setCursor: entry(setCursor),
            getCursor: function () { return { x: Math.round(cursor.x), y: Math.round(cursor.y) }; },
            getButtons: function () { return buttons; },
            isActive: function () { return (seq !== null) || (pendingTimer !== null) || (buttons !== 0); },
            config: config
        };
    }

    return { create: create, DEFAULTS: DEFAULTS, LEFT: LEFT, RIGHT: RIGHT, MIDDLE: MIDDLE };
})();
