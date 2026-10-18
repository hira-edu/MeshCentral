// Connects the trackpad gesture engine (agent-desktop-trackpad-0.0.1.js) to a remote desktop page
// through a view adapter (agent-desktop-trackpad-default3-0.0.1.js, -mobile-0.0.1.js,
// -sharing-mobile-0.0.1.js, -sharing-0.0.1.js).
//
// While the adapter says trackpad mode is on, one capture-phase listener on the canvas's parent
// owns every touch that targets the canvas: it cancels the browser default (so no compatibility
// mouse events turn a tap into an absolute click) and stops propagation (so the page's own
// ontouch* handlers never see it), then feeds the engine. While it is off, nothing is intercepted
// and the page behaves exactly as without this file. The engine's output goes to the viewer's
// remote-pixel pointer API (SendRemotePointer / SendRemoteWheel), and a fork-owned overlay shows
// the remote pointer in place of the page's own trackpad cursor.
var MeshTrackpadController = (function () {
    'use strict';

    var ACTIVE_CLASS = 'mc-trackpad-engine';
    var TOUCH_TYPES = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
    var FOLLOW_MARGIN_CSS_PX = 48;
    var WATCH_MS = 200;                 // while a button is held, how often to re-check mode, Input and dialogs
    var SETTLE_MS = [0, 120, 350, 800]; // re-place the overlay after layout changes the page makes on timers
    // The overlay arrow is drawn at the size a 100%-scaled Windows arrow has in the remote picture,
    // kept between these on-screen heights so it stays visible in fit mode and small when zoomed.
    var ARROW_REMOTE_PX = 20, ARROW_MIN_PX = 16, ARROW_MAX_PX = 24, ARROW_ASPECT = 0.6;
    // Arrow shape adapted from the page's own trackpad cursor (upstream MeshCentral, Apache-2.0).
    var ARROW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 20" width="12" height="20" style="display:block;overflow:visible">' +
        '<path d="M0.5,0.5 L0.5,15.5 L4.2,12 L6.6,17.6 L8.6,16.8 L6.2,11.2 L11,11.2 Z" fill="#fff" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/></svg>';

    // Touch coordinates are turned into a frame whose axes run along the remote screen's axes, so
    // finger motion moves the remote pointer the way the rotated picture shows it.
    function toFrame(x, y, r) {
        if (r === 1) return { x: y, y: -x };
        if (r === 2) return { x: -x, y: -y };
        if (r === 3) return { x: -y, y: x };
        return { x: x, y: y };
    }

    function fromFrame(x, y, r) {
        if (r === 1) return { x: -y, y: x };
        if (r === 2) return { x: -x, y: -y };
        if (r === 3) return { x: y, y: -x };
        return { x: x, y: y };
    }

    function intersect(a, b) {
        var left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
        var right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
        return (right > left && bottom > top) ? { left: left, top: top, right: right, bottom: bottom } : null;
    }

    // options.adapter:  view adapter (see the adapter files for the members)
    // options.engine:   MeshTrackpadEngine
    // options.enabled:  () => boolean, the feature flag for this adapter
    // options.window:   optional window (tests)
    function create(options) {
        var adapter = options.adapter, win = options.window || window, doc = win.document;
        var enabled = options.enabled || function () { return false; };
        var clock = options.clock || {
            now: function () { return Date.now(); },
            setTimeout: function (fn, ms) { return win.setTimeout(fn, ms); },
            clearTimeout: function (id) { win.clearTimeout(id); }
        };
        var installed = false, active = false;
        var sinkModule = null;                  // the viewer module the engine's output goes to
        var lastScreen = null;                  // remote size and rotation the current gesture started on
        var zoomAnchor = null;                  // client point a pinch keeps fixed (from its first zoom step)
        var sentButtons = 0;                    // buttons held in the last pointer sent to sinkModule
        var overlay = null, style = null, root = null, probe = null, arrowHeight = 0;
        var listeners = [], watchTimer = null, settleTimers = [], placeTimer = null, placeTries = 0;

        function call(fn, fallback) { try { return fn(); } catch (ex) { return fallback; } }

        function geometry() {
            var m = sinkModule;
            return (m && m.GetRemoteGeometry) ? m.GetRemoteGeometry() : null;
        }

        var engine = options.engine.create({
            clock: clock,
            geometry: geometry,
            output: {
                pointer: function (x, y, buttons) {
                    // With Input off or a dialog open, send nothing new (not even the pointer move
                    // that enabling the mode makes), but never leave a press behind.
                    if (inputBlocked(sinkModule)) {
                        if (sentButtons !== 0) { sentButtons = 0; releaseSink(); }
                        return;
                    }
                    if (sinkModule && sinkModule.SendRemotePointer) { sinkModule.SendRemotePointer(x, y, buttons); sentButtons = buttons; }
                    follow();
                    placeOverlay();
                },
                wheel: function (x, y, notches) { if (sinkModule && sinkModule.SendRemoteWheel) sinkModule.SendRemoteWheel(x, y, notches); },
                zoom: function (ratio, fx, fy) {
                    var g = geometry(), z = adapter.zoom();
                    if (!g || !z || !z.pinchSupported()) return;
                    // Upstream keeps the point where the two fingers landed fixed; fall back to the
                    // current midpoint only if the pinch did not start as a two-finger touch.
                    if (zoomAnchor === null) zoomAnchor = fromFrame(fx, fy, g.rotation || 0);
                    z.apply(ratio, zoomAnchor.x, zoomAnchor.y);
                    placeOverlay();
                },
                pinchSupported: function () { var z = adapter.zoom(); return !!(z && z.pinchSupported()); }
            }
        });

        function listen(target, type, fn, opts) {
            if (!target) return;
            target.addEventListener(type, fn, opts);
            listeners.push([target, type, fn, opts]);
        }

        // A viewer module this controller can drive: Intel AMT desktops share the canvas but have no
        // remote-pixel API, and upstream keeps handling those.
        function supported(m) { return !!(m && m.GetRemoteGeometry && m.SendRemotePointer && m.SendRemoteWheel && m.ReleaseAllPointerButtons); }

        // Trackpad mode acts only on a connected module.
        function connected(m) { return !!(m && m.State === 3); }

        // Release everything the engine holds on the module it was sending to, and anything else
        // that module still has pressed.
        function teardown() {
            zoomAnchor = null;
            lastScreen = null;
            stopPlacing();
            if (engine.isActive()) engine.reset();
            releaseSink();
        }

        function releaseSink() {
            sentButtons = 0;
            if (sinkModule && sinkModule.ReleaseAllPointerButtons) call(function () { sinkModule.ReleaseAllPointerButtons(); });
        }

        function canvasRect() {
            var c = adapter.canvas();
            return c ? c.getBoundingClientRect() : null;
        }

        // Null while the canvas is not laid out (a page panel other than the desktop is shown).
        function cursorClientPoint() {
            var g = geometry(), rect = canvasRect();
            if (!g || !rect || !(g.width > 0) || !(rect.width > 0 && rect.height > 0)) return null;
            var c = engine.getCursor(), css = g.remoteToCss(c.x, c.y);
            return { x: rect.left + css.x, y: rect.top + css.y, rotation: g.rotation || 0 };
        }

        function placeOverlay() {
            if (!overlay) return;
            if (active) sizeArrow();
            var p = (active && !inputBlocked(sinkModule)) ? cursorClientPoint() : null;
            var view = adapter.scrollContainer(), vr = view ? view.getBoundingClientRect() : null;
            if (!p || (vr && (p.x < vr.left || p.x > vr.right || p.y < vr.top || p.y > vr.bottom))) { overlay.style.display = 'none'; return; }
            overlay.style.left = p.x + 'px';
            overlay.style.top = p.y + 'px';
            overlay.style.transform = 'rotate(' + (p.rotation * 90) + 'deg)';
            overlay.style.display = 'block';
        }

        // How far the browser itself is pinch-zoomed (1 when it is not, or cannot tell).
        function pageScale() {
            var vv = win.visualViewport, s = vv ? vv.scale : 1;
            return (s > 0 && isFinite(s)) ? s : 1;
        }

        // Size the arrow like the remote picture's own pointer would be at the current zoom, within
        // on-screen bounds, so it neither covers the picture in native zoom nor vanishes in fit mode.
        function sizeArrow() {
            var g = geometry(), svg = overlay.firstChild, s = pageScale();
            if (!g || !(g.remotePerCss > 0) || !svg) return;
            var h = Math.max(ARROW_MIN_PX, Math.min(ARROW_MAX_PX, ARROW_REMOTE_PX * s / g.remotePerCss)) / s;
            h = Math.round(h * 2) / 2;
            if (h === arrowHeight) return;
            arrowHeight = h;
            svg.setAttribute('height', String(h));
            svg.setAttribute('width', String(Math.round(h * ARROW_ASPECT * 2) / 2));
        }

        // Scroll one container the least that brings the pointer inside it, with a margin. Returns
        // whether it scrolled.
        function reveal(el, r, p) {
            var mx = Math.min(FOLLOW_MARGIN_CSS_PX, (r.right - r.left) / 4), my = Math.min(FOLLOW_MARGIN_CSS_PX, (r.bottom - r.top) / 4);
            var dx = 0, dy = 0;
            if (p.x < r.left + mx) dx = p.x - (r.left + mx); else if (p.x > r.right - mx) dx = p.x - (r.right - mx);
            if (p.y < r.top + my) dy = p.y - (r.top + my); else if (p.y > r.bottom - my) dy = p.y - (r.bottom - my);
            var x = el.scrollLeft, y = el.scrollTop;
            if (dx) el.scrollLeft = x + dx;
            if (dy) el.scrollTop = y + dy;
            return el.scrollLeft !== x || el.scrollTop !== y;
        }

        // Keep the remote pointer in view, as an RDP client does when zoomed in: first the page's
        // scroll container, then the browser's own pinch zoom. The remote pointer itself does not move.
        function follow() {
            var view = adapter.scrollContainer(), p = cursorClientPoint();
            if (!view || !p) return;
            var vr = view.getBoundingClientRect();
            if (reveal(view, vr, p)) p = cursorClientPoint();
            if (p) followZoom(p, vr);
        }

        // A pinch-zoomed page shows only part of the layout viewport. Bring the pointer, with a margin
        // in screen pixels, into what is shown by revealing a fixed-position probe there: browsers pan
        // only the zoomed view for that, never the page's scroll containers.
        function followZoom(p, viewRect) {
            var vv = win.visualViewport, s = pageScale();
            if (!vv || s <= 1.01 || !probe || typeof probe.scrollIntoView !== 'function') return;
            var m = FOLLOW_MARGIN_CSS_PX / s;
            var left = Math.max(p.x - m, viewRect.left), top = Math.max(p.y - m, viewRect.top);
            var right = Math.min(p.x + m, viewRect.right), bottom = Math.min(p.y + m, viewRect.bottom);
            if (!(right > left && bottom > top)) return;
            if (left >= vv.offsetLeft && top >= vv.offsetTop && right <= vv.offsetLeft + vv.width && bottom <= vv.offsetTop + vv.height) return;
            probe.style.left = left + 'px';
            probe.style.top = top + 'px';
            probe.style.width = (right - left) + 'px';
            probe.style.height = (bottom - top) + 'px';
            call(function () { probe.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        }

        // The canvas is sized to the remote screen by the first frame after a SCREEN message; until
        // then its pixels (and so the CSS scale) still describe the previous screen.
        function canvasCurrent(g) {
            var c = adapter.canvas(), r = g.rotation || 0;
            return !!(c && c.width === ((r % 2) ? g.height : g.width) && c.height === ((r % 2) ? g.width : g.height));
        }

        function stopPlacing() {
            if (placeTimer !== null) { clock.clearTimeout(placeTimer); placeTimer = null; }
            placeTries = 0;
        }

        // Enabling trackpad mode puts the pointer at the centre of what is visible and sends it there.
        // A module that does not know its screen yet (a WebRTC soft desktop before its first SCREEN)
        // is retried for a few seconds instead.
        function placeInitialCursor() {
            var g = geometry(), rect = canvasRect();
            if (!g || !rect || !(g.width > 0) || !(g.remotePerCss > 0)) {
                if (active && placeTimer === null && placeTries < 25) {
                    placeTries++;
                    placeTimer = clock.setTimeout(function () { placeTimer = null; if (active) placeInitialCursor(); }, WATCH_MS);
                }
                return;
            }
            stopPlacing();
            var p = { x: g.width / 2, y: g.height / 2 };
            if (canvasCurrent(g)) {
                var view = adapter.scrollContainer();
                var vis = view ? intersect(rect, view.getBoundingClientRect()) : null;
                if (!vis) vis = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
                p = g.cssToRemote((vis.left + vis.right) / 2 - rect.left, (vis.top + vis.bottom) / 2 - rect.top);
            }
            engine.reset();
            engine.setCursor(p.x, p.y);
            settle();
        }

        // Re-place the overlay over the next moments: the page resizes the canvas on its first frame,
        // on rotation and on zoom changes from timers, none of which raises an event here.
        function settle() {
            placeOverlay();
            for (var i = 0; i < settleTimers.length; i++) clock.clearTimeout(settleTimers[i]);
            settleTimers = [];
            for (var j = 0; j < SETTLE_MS.length; j++) settleTimers.push(clock.setTimeout(placeOverlay, SETTLE_MS[j]));
        }

        // While a button is held (or a tap's release is pending), look again regularly: a dialog, an
        // Input change or a mode change can arrive from the server with no click and no touch.
        function watch() {
            if (watchTimer !== null || !installed || !active || !engine.isActive()) return;
            watchTimer = clock.setTimeout(function () { watchTimer = null; evaluate(); watch(); }, WATCH_MS);
        }

        function inputBlocked(m) { return !call(adapter.inputAllowed, false) || call(adapter.dialogOpen, true) || !m || (m.stopInput === true); }

        // Re-read whether trackpad mode is on, and act on a change. Also releases a held button when
        // input became blocked (Input off, a dialog) since the last touch.
        function evaluate() {
            if (!installed) return;
            var module = call(adapter.module, null);
            var now = !!(call(enabled, false) && call(adapter.isActive, false) && supported(module) && connected(module));
            if (now !== active) {
                if (now) {
                    active = true;
                    doc.documentElement.classList.add(ACTIVE_CLASS);
                    sinkModule = call(adapter.module, null);
                    call(adapter.prepare);
                    placeInitialCursor();
                } else {
                    teardown();
                    active = false;
                    doc.documentElement.classList.remove(ACTIVE_CLASS);
                    placeOverlay();
                }
                return;
            }
            if (active && engine.isActive() && inputBlocked(sinkModule)) teardown();
            if (active) placeOverlay();
        }

        function touchList(touches, r) {
            var list = [];
            for (var i = 0; touches && i < touches.length; i++) {
                var t = touches[i], f = toFrame(t.clientX, t.clientY, r);
                list.push({ id: t.identifier, x: f.x, y: f.y });
            }
            return list;
        }

        function onTouch(e) {
            if (!call(function () { return adapter.isCanvas(e.target); }, false)) return;
            evaluate();
            if (!active) return;
            var m = call(adapter.module, null);
            if (m !== sinkModule) {
                // The viewer instance changed (WebRTC soft desktop): release on the old one first.
                teardown();
                sinkModule = m;
            }
            if (e.type !== 'touchcancel' && e.cancelable !== false) e.preventDefault();
            e.stopPropagation();
            call(adapter.onUserActivity);
            if (e.type === 'touchstart') {
                // What the page's own dtouchstart would have done for a new touch (stop its timers,
                // close its menus), and the pinch anchor for a two-finger start.
                call(adapter.prepare);
                var t = e.touches;
                zoomAnchor = (t && t.length === 2) ? { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 } : null;
            }
            if (inputBlocked(m)) { if (engine.isActive()) teardown(); return; }
            var g = geometry();
            if (!g) return;
            var key = g.width + 'x' + g.height + 'r' + (g.rotation || 0);
            if (lastScreen !== null && key !== lastScreen && engine.isActive()) engine.reset();
            lastScreen = key;
            var r = g.rotation || 0;
            if (e.type === 'touchstart') engine.touchStart(touchList(e.touches, r));
            else if (e.type === 'touchmove') engine.touchMove(touchList(e.touches, r));
            else if (e.type === 'touchend') engine.touchEnd(touchList(e.touches, r));
            else engine.touchCancel();
            if (!engine.isActive()) lastScreen = null;
            watch();
        }

        // iOS Safari pinch-zooms the page on its own gesture events unless they are cancelled.
        function onGesture(e) {
            if (active && root && e.target && root.contains(e.target) && e.cancelable !== false) e.preventDefault();
        }

        function onHidden() { if (active) teardown(); }

        function install() {
            if (installed) return true;
            root = call(adapter.captureRoot, null);
            if (!root || !doc.body) { root = null; return false; }
            installed = true;
            for (var i = 0; i < TOUCH_TYPES.length; i++) listen(root, TOUCH_TYPES[i], onTouch, { capture: true, passive: false });
            listen(doc, 'gesturestart', onGesture, { capture: true, passive: false });
            listen(doc, 'gesturechange', onGesture, { capture: true, passive: false });
            // The page toggles trackpad mode, Input and fullscreen from buttons: look again after each click.
            listen(doc, 'click', function () { clock.setTimeout(function () { evaluate(); if (active) settle(); }, 0); }, true);
            listen(doc, 'visibilitychange', function () { if (doc.visibilityState === 'hidden') onHidden(); }, false);
            listen(win, 'pagehide', onHidden, false);
            listen(win, 'blur', onHidden, false);
            listen(doc, 'scroll', placeOverlay, true);
            listen(win, 'resize', function () { if (active) settle(); }, false);
            listen(win, 'orientationchange', function () { if (active) settle(); }, false);
            // The arrow's on-screen size depends on the browser's own pinch zoom.
            listen(win.visualViewport, 'resize', placeOverlay, false);
            if (!style) {
                style = doc.createElement('style');
                style.textContent = 'html.' + ACTIVE_CLASS + ' #trackpadCursor{display:none!important}';
                (doc.head || doc.documentElement).appendChild(style);
            }
            if (!overlay) {
                overlay = doc.createElement('div');
                overlay.setAttribute('aria-hidden', 'true');
                overlay.style.cssText = 'display:none;position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483000;transform-origin:0 0;filter:drop-shadow(1px 1px 2px rgba(0,0,0,0.8))';
                overlay.innerHTML = ARROW_SVG;
                arrowHeight = 0;
                doc.body.appendChild(overlay);
            }
            if (!probe) {
                probe = doc.createElement('div');
                probe.setAttribute('aria-hidden', 'true');
                probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none';
                doc.body.appendChild(probe);
            }
            // Page controls the adapter adds (a guest page has no trackpad toggle of its own).
            call(adapter.attach);
            evaluate();
            return true;
        }

        function uninstall() {
            if (!installed) return;
            if (active) { teardown(); active = false; doc.documentElement.classList.remove(ACTIVE_CLASS); }
            installed = false;
            stopPlacing();
            if (watchTimer !== null) { clock.clearTimeout(watchTimer); watchTimer = null; }
            for (var t = 0; t < settleTimers.length; t++) clock.clearTimeout(settleTimers[t]);
            settleTimers = [];
            for (var i = 0; i < listeners.length; i++) { var l = listeners[i]; l[0].removeEventListener(l[1], l[2], l[3]); }
            listeners = [];
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
            if (style && style.parentNode) style.parentNode.removeChild(style);
            call(adapter.detach);
            overlay = null; style = null; root = null; probe = null;
        }

        // The page's desktop connection changed state. A different module coming up (the WebRTC soft
        // desktop) first releases on the module that was being driven. Going down deactivates, since
        // only a connected module counts. The page updates its own state after the module reports, so
        // look again once its handlers have run.
        function onStateChanged(state) {
            if (!installed) return;
            var m = call(adapter.module, null);
            if (active && m !== sinkModule) { teardown(); sinkModule = m; }
            var wasActive = active;
            evaluate();
            if (wasActive && active && state === 3) placeInitialCursor();
            clock.setTimeout(evaluate, 0);
        }

        // A viewer module reported a state change (agent-desktop addStateListener): act on it when it
        // is the module the engine sends to, or the one the page would use next.
        function onModuleState(module, state) {
            if (module && (module === sinkModule || module === call(adapter.module, null))) onStateChanged(state);
        }

        return {
            install: install,
            uninstall: uninstall,
            evaluate: evaluate,
            onStateChanged: onStateChanged,
            onModuleState: onModuleState,
            isActive: function () { return active; },
            overlay: function () { return overlay; },
            engine: engine
        };
    }

    return { create: create, ACTIVE_CLASS: ACTIVE_CLASS };
})();
