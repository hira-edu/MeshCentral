/**
* @description MeshCentral Desktop Audio toolbar control (tunnel protocol 20)
* @version v0.0.1
*
* The speaker button and volume slider of the remote desktop toolbar. Loaded by the five desktop
* templates (default, default3, default-mobile, sharing, sharing-mobile) after agent-desktop, so it
* works on every desktop page, including the mobile pages, without custom.js.
*
* How it attaches, through the viewer's own extension points only:
*  - window.MeshDesktopModuleObservers (agent-desktop): told about every desktop module created;
*  - module.addStateListener (agent-desktop): the module's connection state, and with it the
*    redirector carrying it (module.parent);
*  - redir.addControlListener (agent-redir-ws): the agent's "audio" control messages;
*  - the template's <span id="deskAudioMount"> toolbar slot, filled by mount().
* It never wraps a factory or a page handler and runs no timer.
*
* The player itself (agent-desktop-audio-0.0.1.js) and the vendored decoder are loaded on the first
* click, from the same scripts/ directory as this file.
*/
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  // One control per page. An older copy in an operator's custom.js loads after this file and sees
  // the flag, so the toolbar never gets two controls.
  if (window.__meshDesktopAudioControl) return;
  window.__meshDesktopAudioControl = true;

  var AUDIO_PROTOCOL = 20;
  var DESKTOP_PROTOCOL = 2;
  var MOUNT_ID = 'deskAudioMount';

  function logError(what, ex) {
    if (typeof console !== 'undefined' && console.warn) { console.warn('Desktop audio: ' + what, ex); }
  }

  // Sibling scripts load from the directory this file was served from.
  var scriptsBase = '';
  var selfSrc = (document.currentScript && document.currentScript.src) || '';
  if (selfSrc) { scriptsBase = selfSrc.substring(0, selfSrc.lastIndexOf('/') + 1); }
  var PLAYER_URL = scriptsBase ? (scriptsBase + 'agent-desktop-audio-0.0.1.js') : 'scripts/agent-desktop-audio-0.0.1.js';
  var DECODER_URL = scriptsBase ? (scriptsBase + 'opus-decoder-0.7.11.min.js') : 'scripts/opus-decoder-0.7.11.min.js';

  // ---- Lazy load of the player module -----------------------------------
  var playerModulePromise = null;
  function loadPlayerModule() {
    if (window.MeshDesktopAudio) { return Promise.resolve(window.MeshDesktopAudio); }
    if (playerModulePromise) { return playerModulePromise; }
    playerModulePromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PLAYER_URL;
      s.async = true;
      s.onload = function () { if (window.MeshDesktopAudio) { resolve(window.MeshDesktopAudio); } else { reject(new Error('audio player did not register')); } };
      s.onerror = function () { reject(new Error('failed to load audio player')); };
      document.head.appendChild(s);
    }).catch(function (err) { playerModulePromise = null; throw err; });
    return playerModulePromise;
  }

  // ---- Controller --------------------------------------------------------
  // Bound to the single desktop viewer tunnel (canvas id 'Desk'), tracked via
  // a tiny state machine from the player module when it is available. Before
  // the player loads we keep a minimal local mirror so the icon still works.
  var boundDesktop = null;   // the desktop redir object that advertised audio
  var audioRedir = null;     // the protocol-20 relay tunnel
  var player = null;         // MeshDesktopAudio player instance
  var audioCtx = null;       // AudioContext created inside the click that started the session
  var stateMachine = null;   // player state machine (loaded lazily)
  var uiState = { available: false, state: 'off', reason: '' };

  function getStateApi() {
    if (stateMachine) { return stateMachine; }
    if (window.MeshDesktopAudio && window.MeshDesktopAudio.createAudioStateMachine) {
      stateMachine = window.MeshDesktopAudio.createAudioStateMachine();
      // Re-apply current availability so the machine matches the UI.
      if (uiState.available) { stateMachine.onAvailable(); }
    }
    return stateMachine;
  }

  function applySnapshot(snap) {
    if (!snap) return;
    uiState = { available: snap.available, state: snap.state, reason: snap.reason };
    renderControl();
  }

  // ---- Toolbar control ---------------------------------------------------
  // A speaker button and a volume slider, grouped in the template's toolbar slot: the first button
  // of the desktop toolbar's right-hand group, left of Actions / Settings (Full Screen on the mobile
  // pages). The group is sized to the toolbar row, the slider shows only while audio is connecting
  // or playing, and the sound waves animate only while audio is actually flowing (not on silence).
  var mountEl = null;        // the template's #deskAudioMount slot
  var controlEl = null;      // #mc-desk-audio group
  var buttonEl = null;       // #mc-desk-audio-btn
  var sliderEl = null;       // #mc-desk-audio-vol
  var STYLE_ID = 'mc-desk-audio-style';
  var VOLUME_KEY = 'meshDesktopAudioVolume';
  var volumePercent = loadVolume();
  var audioFlowing = false;

  // The level is a per-browser convenience; storage can be unavailable (private mode, blocked
  // site data), in which case the session simply starts at full volume.
  function loadVolume() {
    var stored = null;
    try { stored = window.localStorage.getItem(VOLUME_KEY); } catch (ex) { stored = null; }
    var value = (stored == null) ? 100 : parseInt(stored, 10);
    return (isFinite(value) && value >= 0 && value <= 100) ? value : 100;
  }
  function saveVolume(value) { try { window.localStorage.setItem(VOLUME_KEY, String(value)); } catch (ex) { logError('volume not saved', ex); } }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = ''
      // Group: one inline row the height of the toolbar's buttons, spaced like the stock .mR buttons.
      // 'middle' centres the box itself, independent of whether the slider is showing (a baseline
      // offset would move with the first visible child) and of the share page's 24px line height;
      // with the stock 13.33px button font it lands ~1px low, hence the 1px optical lift.
      + '#mc-desk-audio{display:inline-flex;align-items:center;gap:4px;height:22px;margin:0 3px 0 0;vertical-align:middle;position:relative;top:-1px;white-space:nowrap;line-height:normal;text-align:left}'
      + '#mc-desk-audio[hidden]{display:none}'
      // Button: icon-only, same 22px box as the toolbar inputs; colour follows the bar (day black, night #CCC).
      + '#mc-desk-audio-btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:22px;height:22px;'
      + 'margin:0;padding:0;border:1px solid transparent;border-radius:3px;background:transparent;color:inherit;font:inherit;'
      + 'cursor:pointer;-webkit-appearance:none;appearance:none}'
      + '#mc-desk-audio-btn:hover{background:rgba(0,0,0,.08);border-color:rgba(0,0,0,.2)}'
      + '.night #mc-desk-audio-btn:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.25)}'
      + '#mc-desk-audio-btn:focus,#mc-desk-audio-vol:focus{outline:none}'
      + '#mc-desk-audio-btn:focus-visible,#mc-desk-audio-vol:focus-visible{outline:2px solid #1a5fb4;outline-offset:1px}'
      + '.night #mc-desk-audio-btn:focus-visible,.night #mc-desk-audio-vol:focus-visible{outline-color:#8ab4f8}'
      + '#mc-desk-audio-btn svg{display:block;width:18px;height:18px;fill:currentColor;overflow:visible;transform:scaleX(-1)}'
      + '#mc-desk-audio .mcaudio-line{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round}'
      // State colours keep at least 3:1 contrast on the day (#C0C0C0) and night (#333) bars.
      + '#mc-desk-audio[data-state="playing"] #mc-desk-audio-btn{color:#176428}'
      + '#mc-desk-audio[data-state="connecting"] #mc-desk-audio-btn{color:#8a4b00}'
      + '#mc-desk-audio[data-state="unavailable"] #mc-desk-audio-btn,#mc-desk-audio[data-state="error"] #mc-desk-audio-btn{color:#a61b1b}'
      + '.night #mc-desk-audio[data-state="playing"] #mc-desk-audio-btn{color:#5fd27a}'
      + '.night #mc-desk-audio[data-state="connecting"] #mc-desk-audio-btn{color:#f0b44c}'
      + '.night #mc-desk-audio[data-state="unavailable"] #mc-desk-audio-btn,.night #mc-desk-audio[data-state="error"] #mc-desk-audio-btn{color:#ff7b72}'
      // Animations: spinner while connecting, staggered waves while audio flows.
      + '#mc-desk-audio .mcaudio-spin{transform-origin:15px 10px;animation:mcaudiospin 1s linear infinite}'
      + '#mc-desk-audio.mcaudio-flowing .mcaudio-wave{animation:mcaudiowave 1.2s ease-in-out infinite}'
      + '#mc-desk-audio.mcaudio-flowing .mcaudio-wave2{animation-delay:.2s}'
      + '@keyframes mcaudiospin{to{transform:rotate(360deg)}}'
      + '@keyframes mcaudiowave{0%,100%{opacity:1}50%{opacity:.25}}'
      // Volume: native range input, tinted to the playing colour.
      + '#mc-desk-audio-vol{box-sizing:border-box;width:72px;height:22px;margin:0;padding:0;background:transparent;cursor:pointer;accent-color:#176428;border-radius:2px}'
      + '.night #mc-desk-audio-vol{accent-color:#5fd27a}'
      + '#mc-desk-audio[data-mobile="true"]{height:28px;top:0}'
      + '#mc-desk-audio[data-mobile="true"] #mc-desk-audio-btn{width:28px;height:28px;touch-action:manipulation}'
      + '#mc-desk-audio[data-mobile="true"] #mc-desk-audio-vol{width:52px;height:28px}'
      + '@media (max-width:800px){#mc-desk-audio-vol{width:52px}}'
      + '@media (prefers-reduced-motion:reduce){#mc-desk-audio .mcaudio-spin,#mc-desk-audio .mcaudio-wave{animation:none}}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  // Speaker body plus sound waves (playing), a cross (muted), a slash (unavailable/error) or a
  // spinner (connecting). Off shows the bare speaker. The glyph is drawn facing right and mirrored
  // by CSS so the speaker and its waves face the volume slider on its left.
  function iconSvg(glyph) {
    var body = '<path d="M3 7h3.4L11 3v14l-4.6-4H3z"/>';
    var inner = body;
    if (glyph === 'playing') {
      inner += '<path class="mcaudio-line mcaudio-wave mcaudio-wave1" d="M13.6 7.2a3.4 3.4 0 0 1 0 5.6"/>'
        + '<path class="mcaudio-line mcaudio-wave mcaudio-wave2" d="M15.6 4.9a6.3 6.3 0 0 1 0 10.2"/>';
    } else if (glyph === 'muted') {
      inner += '<path class="mcaudio-line" d="M13.5 7.5l5 5M18.5 7.5l-5 5"/>';
    } else if (glyph === 'connecting') {
      inner += '<g class="mcaudio-spin"><circle class="mcaudio-line" cx="15" cy="10" r="3.1" stroke-dasharray="14 6"/></g>';
    } else if (glyph === 'unavailable' || glyph === 'error') {
      inner += '<path class="mcaudio-line" d="M13 5l5 10"/>';
    }
    return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  function tooltipFor(state, reason, muted) {
    switch (state) {
      case 'playing': return muted ? 'Device audio muted (volume 0); click to stop listening' : (audioFlowing ? 'Playing device audio; click to stop listening' : 'Listening; no audible signal detected; click to stop');
      case 'connecting': return 'Connecting device audio... click to cancel';
      case 'unavailable': return reason || 'Device audio is unavailable';
      case 'error': return (reason || 'Device audio error') + '; click to retry';
      default: return 'Listen to device audio';
    }
  }

  function renderControl() {
    if (!controlEl) return;
    var state = uiState.state;
    var muted = (state === 'playing') && (volumePercent === 0);
    var glyph = muted ? 'muted' : state;
    // The slot is hidden with the control, so its trailing space adds no gap while audio is off.
    controlEl.hidden = !uiState.available;
    mountEl.hidden = !uiState.available;
    controlEl.setAttribute('data-state', state);
    controlEl.className = (state === 'playing' && audioFlowing && !muted) ? 'mcaudio-flowing' : '';
    // Rebuild the glyph only when it changes so a running animation is not restarted on every update.
    if (buttonEl.getAttribute('data-glyph') !== glyph) {
      buttonEl.innerHTML = iconSvg(glyph);
      buttonEl.setAttribute('data-glyph', glyph);
    }
    var tip = tooltipFor(state, uiState.reason, muted);
    buttonEl.title = tip;
    buttonEl.setAttribute('aria-label', tip);
    buttonEl.setAttribute('aria-pressed', (state === 'playing' || state === 'connecting') ? 'true' : 'false');
    sliderEl.hidden = !(state === 'playing' || state === 'connecting');
    if (String(volumePercent) !== sliderEl.value) { sliderEl.value = String(volumePercent); }
    sliderEl.title = 'Device audio volume ' + volumePercent + '%';
    sliderEl.setAttribute('aria-valuetext', volumePercent + '%');
  }

  function setVolumePercent(value) {
    var v = parseInt(value, 10);
    if (!isFinite(v)) { return; }
    volumePercent = Math.min(100, Math.max(0, v));
    if (player && typeof player.setVolume === 'function') { player.setVolume(volumePercent / 100); }
    renderControl();
  }

  // While a desktop session has input control, the page forwards every key to the device from
  // document-level handlers. Keys typed on this control stay here; a pointer click hands focus
  // back to the page so typing after clicking the speaker still reaches the device.
  function keepKeysLocal(el) {
    var stop = function (e) { e.stopPropagation(); };
    el.addEventListener('keydown', stop);
    el.addEventListener('keyup', stop);
    el.addEventListener('keypress', stop);
  }

  function createControl(mobile) {
    ensureStyle();
    var group = document.createElement('span');
    group.id = 'mc-desk-audio';
    group.hidden = true;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Device audio');
    group.setAttribute('data-mobile', mobile ? 'true' : 'false');

    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'mc-desk-audio-btn';
    button.addEventListener('click', function (e) {
      e.preventDefault();
      if (e.detail > 0) { button.blur(); }
      onIconActivate();
    });

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'mc-desk-audio-vol';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(volumePercent);
    slider.hidden = true;
    slider.setAttribute('aria-label', 'Device audio volume');
    slider.addEventListener('input', function () { setVolumePercent(slider.value); });
    slider.addEventListener('change', function () { saveVolume(volumePercent); });
    slider.addEventListener('pointerup', function () { slider.blur(); });

    keepKeysLocal(group);
    // The slider sits left of the button: the group is right-aligned beside Actions, so the button
    // keeps its position when the slider appears and a second click lands on it again.
    group.appendChild(slider);
    group.appendChild(button);
    controlEl = group;
    buttonEl = button;
    sliderEl = slider;
    return group;
  }

  // Put the control into the template's toolbar slot, once. The slot is an inline element directly
  // before the group's first button; the control is followed by a space so the gap matches the
  // stock buttons (.mR margin plus inline whitespace). The mobile templates mark their slot
  // data-mobile="true" for the larger touch targets. Returns false on a page without the slot.
  function mount() {
    if (controlEl) return true;
    var slot = document.getElementById(MOUNT_ID);
    if (!slot) return false;
    mountEl = slot;
    slot.appendChild(createControl(slot.getAttribute('data-mobile') === 'true'));
    slot.appendChild(document.createTextNode(' '));
    renderControl();
    return true;
  }

  // ---- Desktop binding / availability ------------------------------------
  function isSingleDesktopViewer(module) {
    var desk = document.getElementById('Desk');
    return !!(desk && module && module.CanvasId === desk);
  }

  function bindDesktop(desktopRedir) {
    if (boundDesktop === desktopRedir) return;
    stopAudio('rebind');
    boundDesktop = desktopRedir;
    var api = getStateApi();
    if (api) { applySnapshot(api.onAvailable()); }
    else { uiState.available = true; renderControl(); }
  }

  function onDesktopAudioAvailable(desktopRedir) {
    if (!mount()) { logError('this page has no #' + MOUNT_ID + ' toolbar slot; the audio control is not shown'); return; }
    bindDesktop(desktopRedir);
  }

  function onDesktopClosed(desktopRedir) {
    if (boundDesktop !== desktopRedir) return;
    stopAudio('desktop-closed');
    boundDesktop = null;
    var api = getStateApi();
    if (api) { applySnapshot(api.onDesktopClosed()); }
    else { uiState = { available: false, state: 'off', reason: '' }; renderControl(); }
  }

  // ---- Start / stop ------------------------------------------------------
  function onIconActivate() {
    if (!boundDesktop) return;
    if (uiState.state === 'connecting' || uiState.state === 'playing') { stopAudio('user'); return; }
    startAudio();
  }

  // Autoplay policy lets only a user gesture start audio, and the player script may still have to load
  // asynchronously, so the AudioContext is created and resumed here, synchronously inside the click.
  // The player then verifies that it actually runs before the control shows Playing.
  function createGestureAudioContext() {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { throw new Error('This browser cannot play audio (Web Audio is unavailable)'); }
    var ctx;
    try { ctx = new Ctor({ latencyHint: 'interactive', sampleRate: 48000 }); }
    catch (ex) { ctx = new Ctor(); } // engines that reject these options; 48 kHz buffers are resampled
    if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
      // The player re-checks the outcome (a context that never runs is reported as blocked); this
      // call only has to happen inside the gesture.
      try {
        var resumed = ctx.resume();
        if (resumed && typeof resumed.catch === 'function') { resumed.catch(function (ex) { logError('resume() was refused', ex); }); }
      } catch (ex2) { logError('resume() was refused', ex2); }
    }
    return ctx;
  }

  function onPlayerPlayback(transition, reason) {
    var api = getStateApi();
    if (transition === 'ready') {
      if (api) { applySnapshot(api.onPlaybackReady()); }
      return;
    }
    // 'blocked' or 'suspended': the browser produces no sound, so end the session instead of claiming playback.
    if (api) { applySnapshot(api.onLocalError(reason)); }
    else { uiState.state = 'error'; uiState.reason = reason || 'Audio playback stopped'; renderControl(); }
    stopTunnelOnly();
  }

  function startAudio() {
    var desktop = boundDesktop;
    if (!desktop) return;
    var api = getStateApi();
    if (api) { applySnapshot(api.onStartRequested()); }
    else { uiState.state = 'connecting'; uiState.reason = ''; renderControl(); }

    var ctx;
    try { ctx = createGestureAudioContext(); }
    catch (ex) { handleAgentStatus('error', ex.message); return; }
    audioCtx = ctx;

    loadPlayerModule().then(function (mod) {
      if (boundDesktop !== desktop || audioCtx !== ctx) { return; } // stopped or rebound while loading
      if (!stateMachine && mod.createAudioStateMachine) { stateMachine = mod.createAudioStateMachine(); stateMachine.onAvailable(); stateMachine.onStartRequested(); }
      player = mod.createMeshDesktopAudioPlayer({
        audioContext: ctx,
        decoderScriptUrl: DECODER_URL,
        onStatus: function (st) { if (audioCtx === ctx && st && st.state === 'error') { handleAgentStatus('error', st.reason); } },
        onError: function (message) { if (audioCtx === ctx) { handleAgentStatus('error', message); } },
        onActivity: function (flowing) { if (audioCtx === ctx) { audioFlowing = flowing; renderControl(); } },
        onPlayback: function (transition, reason) { if (audioCtx === ctx) { onPlayerPlayback(transition, reason); } },
        volume: volumePercent / 100
      });
      player.start(); // attaches to the click-created context and watches whether it really runs
      if (player) { openAudioTunnel(desktop); } // start() may already have reported the context as blocked
    }).catch(function (err) {
      if (audioCtx === ctx) { handleAgentStatus('error', (err && err.message) ? err.message : 'audio unavailable'); }
    });
  }

  function openAudioTunnel(desktop) {
    var make = window.CreateAgentRedirect;
    if (typeof make !== 'function') { handleAgentStatus('error', 'relay unavailable'); return; }
    var module = {
      protocol: AUDIO_PROTOCOL,
      parent: null,
      ProcessBinaryData: function (u8) { if (audioRedir === redir && player) { if (player.handlePacket(u8) === false) { stopTunnelOnly(); } } },
      ProcessData: function () { /* protocol 20 carries no inner string data */ },
      xxStateChange: function () { /* redir drives state; see onStateChanged */ }
    };
    var meshserver = desktop.meshserver != null ? desktop.meshserver : null;
    var authCookie = desktop.authCookie != null ? desktop.authCookie : window.authCookie;
    var rauthCookie = desktop.rauthCookie != null ? desktop.rauthCookie : window.authRelayCookie;
    var nodeid = desktop.nodeid != null ? desktop.nodeid : (window.desktopNode && window.desktopNode._id != null ? window.desktopNode._id : null);
    var redir;
    try {
      redir = make(meshserver, module, window.serverPublicNamePort, authCookie, rauthCookie, window.domainUrl);
    } catch (ex) { logError('could not create the audio tunnel', ex); handleAgentStatus('error', 'relay error'); return; }
    if (typeof redir.addControlListener !== 'function') { handleAgentStatus('error', 'relay unavailable'); return; }
    audioRedir = redir;
    redir.options = {};
    var tsid = desktop.audioTsid ? desktop.audioTsid.value : (desktop.options ? desktop.options.tsid : null);
    if (tsid != null) { redir.options.tsid = tsid; }
    redir.onStateChanged = function (obj, state) { if (state === 0 && audioRedir === redir) { onAudioTunnelClosed(); } };
    redir.addControlListener(function (m) {
      if (audioRedir === redir && m.type === 'audio' && m.state) { handleAgentStatus(m.state, m.reason); }
    });
    try { redir.Start(nodeid); } catch (ex2) { logError('could not start the audio tunnel', ex2); handleAgentStatus('error', 'relay error'); }
  }

  function onAudioTunnelClosed() {
    // Unexpected close while active becomes an error; an intentional stop has
    // already cleared audioRedir/player before the socket closes.
    if (!audioRedir && !player) return;
    var api = getStateApi();
    if (api && api.isActive()) { applySnapshot(api.onTunnelClosed()); }
    stopTunnelOnly();
  }

  function handleAgentStatus(agentState, reason) {
    var api = getStateApi();
    if (api) { applySnapshot(api.onAgentStatus(agentState, reason)); }
    else {
      // Capture starting on the device is not playback in the browser; only the player's 'ready' is.
      uiState.state = (agentState === 'started') ? 'connecting' : (agentState === 'stopped' ? 'off' : (agentState === 'error' ? 'error' : 'unavailable'));
      uiState.reason = reason || '';
      renderControl();
    }
    if (agentState === 'stopped' || agentState === 'unavailable' || agentState === 'nodesktop' || agentState === 'denied' || agentState === 'error') {
      stopTunnelOnly();
    }
  }

  // Tear down only the tunnel + player, leaving the icon state as set by the
  // caller (used after a terminal agent status or a local error).
  function stopTunnelOnly() {
    if (audioRedir) { var r = audioRedir; audioRedir = null; r.onStateChanged = null; try { r.Stop(); } catch (ex) { logError('closing the audio tunnel failed', ex); } }
    if (player) { var p = player; player = null; try { p.stop(); } catch (ex2) { logError('stopping the player failed', ex2); } }
    // The player does not own the click-created context, so the controller closes it.
    if (audioCtx) {
      var c = audioCtx; audioCtx = null;
      try {
        var closing = c.close();
        if (closing && typeof closing.catch === 'function') { closing.catch(function (ex3) { logError('closing the audio context failed', ex3); }); }
      } catch (ex4) { logError('closing the audio context failed', ex4); }
    }
    audioFlowing = false;
  }

  // Full stop initiated by the user or by desktop teardown.
  function stopAudio(cause) {
    stopTunnelOnly();
    var api = getStateApi();
    if (api) { applySnapshot(api.onStopRequested()); }
    else { uiState.state = 'off'; uiState.reason = ''; renderControl(); }
  }

  // ---- Desktop module observation -----------------------------------------
  // The page's desktop tunnel is the redirector its module reports as parent once it starts. The
  // agent advertises audio on that tunnel's control channel; the module's state 0 ends it.
  function attachDesktopRedirector(redir) {
    if (!redir || redir.audioControlAttached) return;
    // Only the relay redirector (agent-redir-ws) carries control messages; the WebRTC soft desktop's
    // data channel does not, and audio stays on the relay tunnel.
    if (typeof redir.addControlListener !== 'function') return;
    redir.audioControlAttached = true;
    redir.addControlListener(function (m) {
      if (m.type === 'audio' && m.state === 'available' && (m.protocol == null || m.protocol === AUDIO_PROTOCOL)) {
        // The agent names the session its desktop tunnel streams; with desktop multiplexing that is the
        // first viewer's session, which may differ from this page's own selection.
        if (Object.prototype.hasOwnProperty.call(m, 'tsid')) { redir.audioTsid = { value: m.tsid }; }
        onDesktopAudioAvailable(redir);
      }
    });
  }

  function onDesktopModuleState(module, state) {
    if (state === 0) { onDesktopClosed(module.parent); return; }
    attachDesktopRedirector(module.parent);
  }

  function observeDesktopModule(module) {
    if (!module || module.protocol !== DESKTOP_PROTOCOL || typeof module.addStateListener !== 'function' || !isSingleDesktopViewer(module)) return;
    module.addStateListener(onDesktopModuleState);
  }

  (window.MeshDesktopModuleObservers = window.MeshDesktopModuleObservers || []).push(observeDesktopModule);

  // The page-facing surface: the explicit mount (the control also mounts itself when the agent
  // first advertises audio).
  window.MeshDesktopAudioControl = { mount: mount };
})();
