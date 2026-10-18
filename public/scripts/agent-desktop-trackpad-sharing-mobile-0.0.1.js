// Trackpad adapter for the guest desktop share page on phones (views/sharing-mobile.handlebars).
// The page is the classic mobile page without its trackpad mode, so this adapter keeps the mode
// itself and adds the classic page's fullscreen toggle button for it. As there, the mode is offered
// only in fullscreen with input allowed, and leaving fullscreen turns it off. Everything it reads
// from the page is pinned by MeshAgent's test/meshcentral_trackpad_sharing_mobile_coupling_contract.js.
var MeshTrackpadAdapters = MeshTrackpadAdapters || {};
MeshTrackpadAdapters.sharingMobile = (function () {
    'use strict';

    var BUTTON_IDS = ['meshTrackpadOn', 'meshTrackpadOff'];
    var mode = false, buttons = null;

    function el(id) { return document.getElementById(id); }

    // The page closes its top menu (dialog mode 999) on a document click, which the controller
    // suppresses while trackpad mode is on. Close it on the next tick instead: the touch that does
    // it still sees the menu open, so like the page's own tap it closes the menu and sends nothing.
    function closeTopMenu() {
        if (window.xxdialogMode !== 999 || typeof window.QV !== 'function') return;
        setTimeout(function () { if (window.xxdialogMode === 999) { window.QV('topMenu', false); window.xxdialogMode = 0; } }, 0);
    }

    function module() { return window.desktop ? window.desktop.m : null; }

    // What the classic page checks before offering the toggle, plus the module's own view-only
    // flag (a share link's view-only or the server's input-disabled feature).
    function offered() {
        var m = module();
        return (window.fullscreen === true) && (window.currentDevicePanel === 1) && (window.viewOnly !== 1) && !!(m && m.GetRemoteGeometry && (m.stopInput !== true));
    }

    // Leaving fullscreen or losing input turns the mode off, then the buttons show the state.
    function sync() {
        var shown = offered();
        if (!shown) mode = false;
        if (buttons) {
            buttons[0].style.display = (shown && !mode) ? 'block' : 'none';
            buttons[1].style.display = (shown && mode) ? 'block' : 'none';
        }
    }

    function toggle() { mode = !mode; sync(); }

    function button(id, image, title) {
        var b = document.createElement('img');
        b.id = id;
        b.src = 'images/' + image;
        b.className = 'deskButton';
        b.title = title;
        b.style.cssText = 'top:260px;display:none';
        b.addEventListener('click', toggle, false);
        return b;
    }

    return {
        id: 'sharing-mobile',
        // The classic mobile page has the same markers and its own trackpad mode.
        detect: function () { return !!(el('p10desktop') && el('DeskParent') && el('deskkeybutton2b') && (typeof window.fullscreenzoom !== 'undefined') && (typeof window.viewOnly !== 'undefined') && (typeof window.trackpadMode === 'undefined')); },
        // Next to the page's other fullscreen buttons, at the classic page's trackpad button position.
        attach: function () {
            if (buttons) return;
            var anchor = el('deskkeybutton2b');
            if (!anchor || !anchor.parentNode) return;
            buttons = [button(BUTTON_IDS[0], 'mobile-touch.png', 'Switch to trackpad mode'), button(BUTTON_IDS[1], 'mobile-desk-mouse.png', 'Switch to direct touch mode')];
            anchor.parentNode.insertBefore(buttons[1], anchor.nextSibling);
            anchor.parentNode.insertBefore(buttons[0], buttons[1]);
            sync();
        },
        detach: function () {
            mode = false;
            if (!buttons) return;
            for (var i = 0; i < buttons.length; i++) { if (buttons[i].parentNode) buttons[i].parentNode.removeChild(buttons[i]); }
            buttons = null;
        },
        isActive: function () { sync(); return mode && !!window.desktop; },
        captureRoot: function () { return el('DeskParent'); },
        canvas: function () { return el('Desk'); },
        isCanvas: function (target) { return !!(target && target.id === 'Desk' && target.tagName === 'CANVAS'); },
        // This page has no WebRTC soft desktop.
        module: module,
        // No Input toggle here: view-only is the share link's viewOnly and the module's stopInput.
        inputAllowed: function () { return window.viewOnly !== 1; },
        dialogOpen: function () { return !!window.xxdialogMode; },
        onUserActivity: function () { if (typeof window.setSessionActivity === 'function') window.setSessionActivity(); },
        prepare: closeTopMenu,
        scrollContainer: function () { return el('p10desktop'); },
        // The page's zoom is its 1x / 0.5x fullscreen button.
        zoom: function () { return { pinchSupported: function () { return false; }, apply: function () { } }; }
    };
})();
