// Trackpad adapter for the Modern UI page (views/default3.handlebars) on phones and tablets.
// Everything it reads from the page is pinned by MeshAgent's
// test/meshcentral_trackpad_default3_coupling_contract.js.
var MeshTrackpadAdapters = MeshTrackpadAdapters || {};
MeshTrackpadAdapters.default3 = (function () {
    'use strict';

    function el(id) { return document.getElementById(id); }

    // Smallest size a pinch that started in fit mode may shrink to, for the screen size it was taken
    // on: that fit size, when it is below upstream's quarter-size floor (a large screen on a phone).
    var fitFloor = null;
    // The pinch point and the fraction of the canvas under it when the pinch began, plus the scroll
    // the last step left, so every step of one pinch scales around the same picture point even
    // when a scroll was clamped at an edge.
    var anchor = null;

    // The canvas fraction under the pinch point, kept for the rest of this pinch.
    function anchorAt(clientX, clientY) {
        var sc = el('deskarea3x'), desk = el('Desk');
        if (anchor && anchor.x === clientX && anchor.y === clientY && sc && sc.scrollLeft === anchor.left && sc.scrollTop === anchor.top) return anchor;
        var r = desk ? desk.getBoundingClientRect() : null;
        if (!r || !(r.width > 0 && r.height > 0)) return null;
        anchor = { x: clientX, y: clientY, fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height, left: sc ? sc.scrollLeft : 0, top: sc ? sc.scrollTop : 0 };
        return anchor;
    }

    // A pinch in fit mode switches to native zoom at the width the canvas has now, so the zoom
    // starts from what is shown instead of jumping to 1:1, and the view can then pan. The height
    // follows the remote screen's shape: landscape fullscreen stretches the fit canvas.
    function enterNativeAtFitSize(dm) {
        var desk = el('Desk'), rootStyle = document.documentElement.style;
        if (!desk || !(desk.width > 0 && desk.height > 0) || typeof window._mobileSetZoom !== 'function') return false;
        var w = Math.round(desk.getBoundingClientRect().width), h = Math.round(w * desk.height / desk.width);
        if (!(w > 0 && h > 0)) return false;
        window._mobileSetZoom('native');
        if (window._mobileZoomMode !== 'native') return false;
        rootStyle.setProperty('--native-desk-w', w + 'px');
        rootStyle.setProperty('--native-desk-h', h + 'px');
        fitFloor = { w: w, h: h, sw: dm.ScreenWidth, sh: dm.ScreenHeight };
        return true;
    }

    function zoomApply(ratio, clientX, clientY) {
        var dm = desktopModule();
        if (!dm || !(ratio > 0) || !isFinite(ratio)) return;
        if (window._mobileZoomMode !== 'native') {
            // The picture point under the fingers is taken before the canvas moves to native layout.
            if (!document.body.classList.contains('is-mobile') || !anchorAt(clientX, clientY) || !enterNativeAtFitSize(dm)) return;
        }
        nativeZoomApply(dm, ratio, clientX, clientY);
    }

    function nativeZoomApply(dm, ratio, clientX, clientY) {
        // Upstream's own native pinch (dtouchmove), with the pinch point held where the pinch began.
        var sc = el('deskarea3x'), desk = el('Desk'), rootStyle = document.documentElement.style;
        var a = anchorAt(clientX, clientY);
        var curW = parseFloat(rootStyle.getPropertyValue('--native-desk-w')), curH = parseFloat(rootStyle.getPropertyValue('--native-desk-h'));
        if (!(curW > 0)) curW = sc ? sc.scrollWidth : 640;
        if (!(curH > 0)) curH = sc ? sc.scrollHeight : 480;
        var sw = dm.ScreenWidth || 640, sh = dm.ScreenHeight || 480;
        var minW = Math.round(sw * 0.25), minH = Math.round(sh * 0.25);
        if (fitFloor && fitFloor.sw === dm.ScreenWidth && fitFloor.sh === dm.ScreenHeight) { minW = Math.min(minW, fitFloor.w); minH = Math.min(minH, fitFloor.h); }
        var newW = Math.max(minW, Math.min(Math.round(sw * 4), Math.round(curW * ratio)));
        var newH = Math.max(minH, Math.min(Math.round(sh * 4), Math.round(curH * ratio)));
        if (newW === curW && newH === curH) return;
        rootStyle.setProperty('--native-desk-w', newW + 'px');
        rootStyle.setProperty('--native-desk-h', newH + 'px');
        if (sc && desk && a) {
            // Put the anchored picture point back under the pinch point, wherever the canvas now sits.
            var d = desk.getBoundingClientRect();
            sc.scrollLeft += (d.left + a.fx * d.width) - clientX;
            sc.scrollTop += (d.top + a.fy * d.height) - clientY;
            a.left = sc.scrollLeft; a.top = sc.scrollTop;
        }
    }

    function desktopModule() {
        if (window.webRtcDesktop && window.webRtcDesktop.softdesktop) return window.webRtcDesktop.softdesktop.m;
        return window.desktop ? window.desktop.m : null;
    }

    return {
        id: 'default3',
        detect: function () { return !!(el('deskarea3x') && el('DeskParent') && (typeof window._mobileZoomMode !== 'undefined') && (typeof window.trackpadMode !== 'undefined')); },
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
        // Pinch zooms in native mode, and in fit mode by switching to native zoom first.
        zoom: function () {
            return {
                pinchSupported: function () { return (window._mobileZoomMode === 'native') || ((window._mobileZoomMode === 'fit') && (typeof window._mobileSetZoom === 'function')); },
                apply: zoomApply
            };
        }
    };
})();
