// Trackpad adapter for the Modern UI page (views/default3.handlebars) on phones and tablets.
// Everything it reads from the page is pinned by MeshAgent's
// test/meshcentral_trackpad_default3_coupling_contract.js.
var MeshTrackpadAdapters = MeshTrackpadAdapters || {};
MeshTrackpadAdapters.default3 = (function () {
    'use strict';

    function el(id) { return document.getElementById(id); }

    function nativeZoomApply(ratio, clientX, clientY) {
        // Upstream's own native pinch (dtouchmove), with the pinch point held where the pinch began.
        var dm = desktopModule(), sc = el('deskarea3x'), rootStyle = document.documentElement.style;
        if (!dm || !(ratio > 0) || !isFinite(ratio)) return;
        var curW = parseFloat(rootStyle.getPropertyValue('--native-desk-w')), curH = parseFloat(rootStyle.getPropertyValue('--native-desk-h'));
        if (!(curW > 0)) curW = sc ? sc.scrollWidth : 640;
        if (!(curH > 0)) curH = sc ? sc.scrollHeight : 480;
        var sw = dm.ScreenWidth || 640, sh = dm.ScreenHeight || 480;
        var newW = Math.max(Math.round(sw * 0.25), Math.min(Math.round(sw * 4), Math.round(curW * ratio)));
        var newH = Math.max(Math.round(sh * 0.25), Math.min(Math.round(sh * 4), Math.round(curH * ratio)));
        if (newW === curW && newH === curH) return;
        rootStyle.setProperty('--native-desk-w', newW + 'px');
        rootStyle.setProperty('--native-desk-h', newH + 'px');
        if (sc) {
            var r = sc.getBoundingClientRect(), mx = clientX - r.left, my = clientY - r.top;
            sc.scrollLeft = (sc.scrollLeft + mx) * (newW / curW) - mx;
            sc.scrollTop = (sc.scrollTop + my) * (newH / curH) - my;
        }
    }

    function desktopModule() {
        if (window.webRtcDesktop && window.webRtcDesktop.softdesktop) return window.webRtcDesktop.softdesktop.m;
        return window.desktop ? window.desktop.m : null;
    }

    return {
        id: 'default3',
        detect: function () { return !!(el('deskarea3x') && el('DeskParent') && (typeof window._mobileZoomMode !== 'undefined')); },
        isActive: function () { return document.body.classList.contains('is-mobile') && (window.trackpadMode === true) && !!window.desktop; },
        captureRoot: function () { return el('DeskParent'); },
        canvas: function () { return el('Desk'); },
        // The page replaces the canvas at runtime, so match it by id, not by reference.
        isCanvas: function (target) { return !!(target && target.id === 'Desk' && target.tagName === 'CANVAS'); },
        module: desktopModule,
        inputAllowed: function () { var c = el('DeskControl'); return !!(c && c.checked); },
        dialogOpen: function () { return !!window.xxdialogMode; },
        onUserActivity: function () {
            if (typeof window.setSessionActivity === 'function') window.setSessionActivity();
        },
        // On activation and on each new touch: what the page's dtouchstart does first. Stopping its
        // edge-scroll interval matters: once it runs (a direct-mode drag at the edge), only
        // dtouchstart stops it, and while trackpad mode is on it would keep moving the remote pointer.
        prepare: function () {
            if (typeof window.deskCloseMobileActions === 'function') window.deskCloseMobileActions();
            if (typeof window.trackpadStopEdgeScroll === 'function') window.trackpadStopEdgeScroll();
        },
        scrollContainer: function () { return el('deskarea3x') || el('DeskParent'); },
        zoom: function () {
            return { pinchSupported: function () { return window._mobileZoomMode === 'native'; }, apply: nativeZoomApply };
        }
    };
})();
