// Trackpad adapter for the classic mobile page (views/default-mobile.handlebars). Upstream offers
// trackpad mode there only in fullscreen, and the page has no pinch zoom (its zoom is a 1x / 0.5x
// button). Everything it reads from the page is pinned by MeshAgent's
// test/meshcentral_trackpad_default_mobile_coupling_contract.js.
var MeshTrackpadAdapters = MeshTrackpadAdapters || {};
MeshTrackpadAdapters.defaultMobile = (function () {
    'use strict';

    function el(id) { return document.getElementById(id); }

    return {
        id: 'default-mobile',
        detect: function () { return !!(el('p10desktop') && el('DeskParent') && (typeof window.fullscreenzoom !== 'undefined')); },
        isActive: function () { return (window.fullscreen === true) && (window.trackpadMode === true) && !!window.desktop; },
        captureRoot: function () { return el('DeskParent'); },
        canvas: function () { return el('Desk'); },
        isCanvas: function (target) { return !!(target && target.id === 'Desk' && target.tagName === 'CANVAS'); },
        // This page has no WebRTC soft desktop.
        module: function () { return window.desktop ? window.desktop.m : null; },
        // No Input toggle here: view-only is the module's stopInput, which the controller checks.
        inputAllowed: function () { return true; },
        dialogOpen: function () { return !!window.xxdialogMode; },
        onUserActivity: function () { if (typeof window.setSessionActivity === 'function') window.setSessionActivity(); },
        // The page's trackpad edge-scroll interval only runs in its own trackpad mode; stop it in case.
        prepare: function () { if (typeof window.trackpadStopEdgeScroll === 'function') window.trackpadStopEdgeScroll(); },
        scrollContainer: function () { return el('p10desktop'); },
        zoom: function () { return { pinchSupported: function () { return false; }, apply: function () { } }; }
    };
})();
