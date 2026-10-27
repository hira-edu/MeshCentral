// Trackpad adapter for the guest desktop share page for desktop browsers (views/sharing.handlebars),
// which is also what iPadOS gets by default. The page has no touch handling and no trackpad mode,
// so this adapter keeps the mode itself and adds a "Trackpad" checkbox beside the page's "Input"
// one, offered only on touch devices while input is possible. Losing the connection or input turns
// the mode off. Everything it reads from the page is pinned by MeshAgent's
// test/meshcentral_trackpad_sharing_coupling_contract.js.
var MeshTrackpadAdapters = MeshTrackpadAdapters || {};
MeshTrackpadAdapters.sharing = (function () {
    'use strict';

    var mode = false, label = null, box = null, gap = null;

    function el(id) { return document.getElementById(id); }

    function module() {
        if (window.webRtcDesktop && window.webRtcDesktop.softdesktop) return window.webRtcDesktop.softdesktop.m;
        return window.desktop ? window.desktop.m : null;
    }

    function touchDevice() { return (navigator.maxTouchPoints > 0) || ('ontouchstart' in window); }

    // A touch device, a link that is not view-only, and a connected viewer with the remote-pixel
    // API (not Intel AMT) whose input is not stopped.
    function offered() {
        var m = module();
        return touchDevice() && (window.viewOnly !== 1) && !!(m && m.GetRemoteGeometry && (m.State === 3) && (m.stopInput !== true));
    }

    // Losing the offer turns the mode off, then the checkbox shows the state.
    function sync() {
        var shown = offered();
        if (!shown) mode = false;
        if (label) {
            label.style.display = gap.style.display = shown ? '' : 'none';
            box.checked = mode;
        }
    }

    function changed() { mode = !!box.checked; sync(); }

    return {
        id: 'sharing',
        // The main desktop UI (default) has the same scroller and Input checkbox but no viewOnly; the
        // Modern UI has its own trackpad mode.
        detect: function () { return !!(el('deskarea3x') && el('DeskParent') && el('DeskControlSpan') && (typeof window.viewOnly !== 'undefined') && (typeof window.isInputAllowed === 'function') && (typeof window.trackpadMode === 'undefined') && (typeof window._mobileZoomMode === 'undefined')); },
        // After the page's "Input" checkbox, styled like it.
        attach: function () {
            if (label) return;
            var anchor = el('DeskControlSpan'), input = anchor && anchor.parentNode;
            if (!input || input.tagName !== 'LABEL' || !input.parentNode) return;
            label = document.createElement('label');
            label.id = 'meshTrackpadLabel';
            label.style.display = 'none';
            var span = document.createElement('span');
            span.title = 'Use touches like a laptop trackpad';
            box = document.createElement('input');
            box.id = 'meshTrackpadToggle';
            box.type = 'checkbox';
            box.addEventListener('keydown', function (e) { e.preventDefault(); }, false);
            box.addEventListener('change', changed, false);
            span.appendChild(box);
            span.appendChild(document.createTextNode('Trackpad'));
            label.appendChild(span);
            // Spaced from Input as the page spaces its own controls: Input, a space, Trackpad.
            gap = document.createElement('span');
            gap.style.display = 'none';
            gap.textContent = '\u00a0';
            input.parentNode.insertBefore(gap, input.nextSibling);
            input.parentNode.insertBefore(label, gap.nextSibling);
            sync();
        },
        detach: function () {
            mode = false;
            if (!label) return;
            if (gap.parentNode) gap.parentNode.removeChild(gap);
            if (label.parentNode) label.parentNode.removeChild(label);
            label = null; box = null; gap = null;
        },
        isActive: function () { sync(); return mode && !!window.desktop; },
        captureRoot: function () { return el('DeskParent'); },
        canvas: function () { return el('Desk'); },
        // The page replaces the canvas when it starts, so match it by id, not by reference.
        isCanvas: function (target) { return !!(target && target.id === 'Desk' && target.tagName === 'CANVAS'); },
        module: module,
        // The page's own rule: not a view-only link, and its Input checkbox checked.
        inputAllowed: function () { return window.isInputAllowed() === true; },
        dialogOpen: function () { return !!window.xxdialogMode; },
        onUserActivity: function () { if (typeof window.setSessionActivity === 'function') window.setSessionActivity(); },
        prepare: function () { },
        // The page's 1:1 view mode scrolls the canvas's parent; the other modes fit the canvas in it.
        scrollContainer: function () { return el('DeskParent'); },
        // The page has no pinch zoom.
        zoom: function () { return { pinchSupported: function () { return false; }, apply: function () { } }; }
    };
})();
