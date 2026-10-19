(function () {
  'use strict';
  // Independent viewer runtime control; it never uses the console transport.
  if (window.__nativeRuntimeClientLoading || window.MeshCentralNativeRuntime) return;
  window.__nativeRuntimeClientLoading = true;
  var client = document.createElement('script');
  client.src = new URL('../plugin/nativeruntime/client.js?v=binary-lifecycle-v1', document.currentScript.src).href;
  client.defer = true;
  client.onerror = function () { window.__nativeRuntimeClientLoading = false; };
  document.head.appendChild(client);
})();

(function () {
  'use strict';

  var umhRequestSeq = 0;
  var existing = window.MeshCentralUmhControlUi;
  if (existing && existing.__v4) {
    existing.installRunCommandOverlay({ userfilesUser: existing.resolveUserfilesUser ? existing.resolveUserfilesUser() : '', userfilesBasePath: window.MC_USERFILES_BASEPATH || '' });
    existing.installFilesExecutionOverlay();
    return;
  }

  var COLORS = { lifecycle: '#0d6efd', query: '#198754', headers: '#0f766e', config: '#b45309', injection: '#dc3545', engine: '#0d9488', runtime: '#795548', tools: '#fd7e14' };
  var INJECTION_TARGET_OPTIONS = [
    { value: 'ets_secure_browser', label: 'ETS Secure Browser' },
    { value: 'lockdown_browser', label: 'Respondus LockDown' },
    { value: 'onvue_browser', label: 'Pearson OnVUE' },
    { value: 'psi_bridge_secure_browser', label: 'PSI Bridge Secure Browser' },
    { value: 'proproctor', label: 'Prometric ProProctor' },
    { value: 'examplify_browser', label: 'ExamSoft Examplify' },
    { value: 'safe_exam_browser', label: 'Safe Exam Browser' },
    { value: 'schoolyear_browser', label: 'Schoolyear' }
  ];
  var UMH_MASTER_SERVICE_ORIGIN = 'https://agents.high.support';
  var UMH_MASTER_SERVICE_BASE_PATH = '/userfiles/hsadmin';
  var UMH_MASTER_SERVICE_SHA384 = '5e389e7410f8e6709be0df9ac4f0d19ba28b1807376e3a993491e621a728fcc523f56f192190d584856c5b3fe72368f1';
  var UMH_INSTALL_PAYLOADS = [
    { method: 'standard', label: 'Standard', methodKeyArg: '--method-key standard' },
    { method: 'setwindowshookex', label: 'SetWindowsHookEx', methodKeyArg: '--method-key setwindowshookex' },
    { method: 'manualmap', label: 'ManualMap', methodKeyArg: '--method-key manualmap' },
    { method: 'reflective', label: 'Reflective', methodKeyArg: '--method-key reflective' }
  ];
  var INJECTION_METHOD_OPTIONS = [
    { value: 'standard', label: 'standard' },
    { value: 'setwindowshookex', label: 'setwindowshookex' },
    { value: 'manualmap', label: 'manualmap' },
    { value: 'reflective', label: 'reflective' }
  ];

  function t(v) { return (v == null) ? '' : String(v).trim(); }
  function norm(v) { return t(v).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function q(v) { return '"' + String(v).split('\\').join('\\\\').split('"').join('\\"') + '"'; }
  function psq(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }
  function utf16leBase64(v) {
    var s = String(v), bytes = '', i, code;
    for (i = 0; i < s.length; i++) {
      code = s.charCodeAt(i);
      bytes += String.fromCharCode(code & 255, (code >> 8) & 255);
    }
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') return window.btoa(bytes);
    if (typeof btoa === 'function') return btoa(bytes);
    throw new Error('Base64 encoder is unavailable.');
  }
  function appendQuery(url, key, value) { return String(url) + (String(url).indexOf('?') >= 0 ? '&' : '?') + encodeURIComponent(key) + '=' + encodeURIComponent(value); }
  function isDigits(v) { return (/^[0-9]+$/).test(t(v)); }
  function isNumberText(v) { return (/^-?(?:\d+|\d*\.\d+)$/).test(t(v)); }
  function intOrNull(v, label, state) { var s = t(v); if (!s) return null; if (!isDigits(s)) { state.error(label + ' must be a positive integer.'); return false; } return s; }
  function pidCsvOrNull(v, state) {
    var s = t(v), parts, out = [], i, item;
    if (!s) { state.error('Target scope PIDs are required.'); return null; }
    parts = s.split(',');
    for (i = 0; i < parts.length; i++) {
      item = t(parts[i]);
      if (!isDigits(item)) { state.error('Target scope PIDs must be a comma-separated list of positive integers.'); return null; }
      out.push(item);
    }
    return out.join(',');
  }
  function arg(parts, flag, value, quote) { var s = t(value); if (!s) return; parts.push(flag); parts.push(quote ? q(s) : s); }
  function boolArg(parts, flag, value) { var s = t(value); if (!s) return; if (s !== 'true' && s !== 'false') return; parts.push(flag); parts.push(s); }
  function origin() { return String((window.location && window.location.origin) || '').replace(/\/+$/, ''); }
  function currentUserfilesUser() {
    var resolved = t(window.MC_USERFILES_USER) || t(window.MC_FILE_USER);
    if (resolved) return resolved;
    if (window.userinfo && typeof window.userinfo === 'object') {
      resolved = t(window.userinfo.name) || t(window.userinfo.user) || t(window.userinfo.username);
      if (resolved) return resolved;
    }
    return t(window.username);
  }
  function userfilesError(state, remote) {
    var remoteName = t(remote) || 'requested file';
    var message = 'Cannot build a download URL for ' + remoteName + '. Configure MC_USERFILES_BASEPATH/MC_USERFILES_USER or sign in with a userfiles-backed account.';
    if (state && typeof state.error === 'function') state.error(message);
    return null;
  }
  function userfiles(base, user, file, originOverride) {
    var p = t(base), owner = t(user);
    if (!p) {
      if (!owner) return null;
      p = '/userfiles/' + encodeURIComponent(owner);
    }
    if (p.charAt(0) !== '/') p = '/' + p;
    p = p.replace(/\/+$/, '');
    if (/\/Public$/i.test(p)) p = p.substring(0, p.length - 7);
    return (t(originOverride) || origin()) + p + '/' + encodeURIComponent(file) + '?download=1';
  }
  function psDownload(state, remote, local, args) {
    var url = userfiles(state.userfilesBasePath, state.userfilesUser, remote), localName = t(local), argText, script;
    if (!url) return userfilesError(state, remote);
    if (!localName) { if (state && typeof state.error === 'function') state.error('Local file name is required.'); return null; }
    argText = (args || []).map(function (a) { return psq(a); }).join(' ');
    script = [
      "$ErrorActionPreference='Stop'",
      "$umhDir=Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath 'UMH'",
      'New-Item -ItemType Directory -Path $umhDir -Force | Out-Null',
      '$target=Join-Path -Path $umhDir -ChildPath ' + psq(localName),
      '$wc=New-Object System.Net.WebClient',
      'try { $wc.DownloadFile(' + psq(url) + ', $target) } finally { if ($wc) { $wc.Dispose() } }',
      '& $target' + (argText ? ' ' + argText : '')
    ].join('; ');
    return 'powershell -NoLogo -NoProfile -NonInteractive -OutputFormat Text -ExecutionPolicy RemoteSigned -EncodedCommand ' + utf16leBase64(script);
  }
  function E(doc, tag, css) { var n = doc.createElement(tag); if (css) n.style.cssText = css; return n; }
  function row(doc, gap) { return E(doc, 'div', 'display:flex;flex-wrap:wrap;align-items:center;gap:' + (gap || '4px') + ';'); }
  function label(doc, text, css) { var n = E(doc, 'span', css); n.textContent = text; return n; }
  function input(doc, placeholder, width) { var n = E(doc, 'input', 'font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #b5b5b5;width:' + (width || '90px') + ';box-sizing:border-box;'); n.type = 'text'; n.placeholder = placeholder; return n; }
  function select(doc, options, width) { var n = E(doc, 'select', 'font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #b5b5b5;max-width:' + (width || '180px') + ';'); for (var i = 0; i < options.length; i++) { var opt = doc.createElement('option'); if (typeof options[i] === 'string') { opt.value = options[i]; opt.textContent = options[i]; } else { opt.value = options[i].value; opt.textContent = options[i].label; } n.appendChild(opt); } return n; }
  function tri(doc, key) { return select(doc, [{ value: '', label: key + ':-' }, { value: 'true', label: key + ':true' }, { value: 'false', label: key + ':false' }], '92px'); }
  function btn(doc, text, color, fn) { var n = E(doc, 'button', 'padding:2px 7px;border-radius:4px;cursor:pointer;user-select:none;font-size:12px;border:1px solid ' + color + ';background:#fff;color:' + color + ';'); n.type = 'button'; n.textContent = text; n.addEventListener('mouseenter', function () { n.style.backgroundColor = color; n.style.color = '#fff'; }); n.addEventListener('mouseleave', function () { n.style.backgroundColor = '#fff'; n.style.color = color; }); n.addEventListener('click', function (ev) { ev.preventDefault(); fn(); }); return n; }
  function group(doc, title, color) { var r = row(doc, '4px'); r.appendChild(label(doc, title + ':', 'font-size:11px;font-weight:600;color:' + color + ';min-width:100px;')); return r; }
  function role(node, name) { if (node && name) node.setAttribute('data-umh-role', name); return node; }
  function dispatch(state, cmd, type) { if (!t(cmd)) return false; if (typeof state.onCommand === 'function') { state.onCommand(cmd, type || 4); return true; } return false; }
  function masterServiceUrl() { return userfiles(UMH_MASTER_SERVICE_BASE_PATH, '', 'MasterService.exe', UMH_MASTER_SERVICE_ORIGIN); }
  function installCmd(state, payload) { var method = exactMethodOrNull(payload && payload.method, state); if (!method) return null; var url = masterServiceUrl(); if (!url) return userfilesError(state, 'MasterService.exe'); url = appendQuery(url, 'sha384', UMH_MASTER_SERVICE_SHA384); return ['umhctl', 'install', '--url', q(url), '--pin', UMH_MASTER_SERVICE_SHA384, payload.methodKeyArg].join(' '); }
  function exactTargetOrNull(value, state) { var target = t(value); if (!target) { state.error('Target is required for injection control.'); return null; } return target; }
  function exactMethodOrNull(value, state) { var method = t(value); if (!method || method === 'auto' || method === 'default') { state.error('Exact method is required; auto/default is not valid for operator injection.'); return null; } return method; }
  function umhPidCmd(state, op, pidValue) {
    var pid = intOrNull(pidValue, 'PID', state), parts = ['umhctl', op];
    if (pid === false) return null;
    if (pid == null) { state.error('PID is required for ' + op + '.'); return null; }
    parts.push('--pid'); parts.push(pid);
    return parts.join(' ');
  }
  function umhInjectCmd(state, pidValue, targetValue, methodValue, techniqueValue) {
    var pid = intOrNull(pidValue, 'PID', state), parts = ['umhctl', 'inject'];
    var target = exactTargetOrNull(targetValue, state), method = exactMethodOrNull(methodValue, state);
    if (pid === false) return null;
    if (pid == null) { state.error('PID is required for inject.'); return null; }
    if (!target || !method) return null;
    parts.push('--pid'); parts.push(pid);
    parts.push('--target-tag'); parts.push(target);
    parts.push('--method'); parts.push(method);
    parts.push('--method-key'); parts.push(method);
    arg(parts, '--technique', techniqueValue, true);
    return parts.join(' ');
  }
  function umhInjectTargetSetCmd(state, pidsValue, targetValue, methodValue) {
    var pids = pidCsvOrNull(pidsValue, state), target = exactTargetOrNull(targetValue, state), method = exactMethodOrNull(methodValue, state);
    if (!pids || !target || !method) return null;
    return ['umhctl', 'injectTargetSet', '--pids', pids, '--target-tag', target, '--method-key', method].join(' ');
  }
  function cloneJson(v) { try { return JSON.parse(JSON.stringify(v)); } catch (ex) { return null; } }
  function textarea(doc, placeholder, width, height) { var n = doc.createElement('textarea'); n.style.cssText = 'font-size:11px;padding:4px;border-radius:3px;border:1px solid #b5b5b5;width:' + (width || '180px') + ';height:' + (height || '62px') + ';box-sizing:border-box;resize:vertical;'; n.placeholder = placeholder || ''; n.spellcheck = false; return n; }
  function setSelectOptions(sel, options, keepValue) { if (!sel) return; var v = (keepValue !== undefined) ? keepValue : sel.value, i, opt, doc = sel.ownerDocument || document; sel.innerHTML = ''; for (i = 0; i < options.length; i++) { opt = doc.createElement('option'); opt.value = options[i].value; opt.textContent = options[i].label; if (options[i].title) opt.title = options[i].title; sel.appendChild(opt); } if (v != null) sel.value = v; if (sel.value !== v && sel.options.length > 0 && sel.selectedIndex < 0) sel.selectedIndex = 0; }
  function selectFirstNonEmpty(sel) { var i; if (!sel || !sel.options) return; if (sel.value) return; for (i = 0; i < sel.options.length; i++) { if (t(sel.options[i].value)) { sel.selectedIndex = i; return; } } }
  function valueType(v) { if (v === true || v === false) return 'bool'; if (typeof v === 'number') return 'number'; if (typeof v === 'object' && v != null) return 'json'; return 'string'; }
  function escapeRegExp(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function buildRequestId() { umhRequestSeq = (umhRequestSeq + 1) % 1679616; return 'ui-' + Date.now().toString(36) + '-' + umhRequestSeq.toString(36); }
  function appendRequestId(cmd, requestId) { if (!requestId || !/^\s*umhctl\b/i.test(String(cmd || '')) || /\s--request-id(?:\s|$)/i.test(String(cmd || ''))) return cmd; return String(cmd || '') + ' --request-id ' + q(requestId); }
  function findLastPrefixedMarker(txt, labelPattern, suffix) {
    var re = new RegExp(labelPattern + '\\s+' + escapeRegExp(suffix), 'g'), match, last = null;
    while ((match = re.exec(txt)) !== null) { last = { index: match.index, prefix: match[0] }; }
    return last;
  }
  function parseUmhConsoleJson(raw, expectedRequestId) {
    var txt = t(raw), idx, body, parsed, marker, markers, markerIndex, i, matchedLine = '', lineParts, lineIndex;
    var labelPattern = expectedRequestId ? ('umhctl\\[' + escapeRegExp(expectedRequestId) + '\\]') : 'umhctl(?:\\[[^\\]\\r\\n]+\\])?';
    var linePrefixPattern = new RegExp('^' + labelPattern + '(?::|\\s)', 'i');
    if (!txt) return null;
    markers = ['response:', 'response (raw):', 'uiResponse:'];
    for (i = 0; i < markers.length; i++) {
      marker = findLastPrefixedMarker(txt, labelPattern, markers[i]);
      if (marker) {
        body = txt.substring(marker.index + marker.prefix.length).trim();
        parsed = safeJsonParse(body);
        return { kind: (parsed != null) ? 'response' : 'responseRaw', json: parsed, body: body, raw: txt, isTerminal: true, isError: !!(parsed && parsed.ok === false) };
      }
    }
    lineParts = txt.split(/\r?\n/);
    for (lineIndex = lineParts.length - 1; lineIndex >= 0; lineIndex--) {
      if (!linePrefixPattern.test(lineParts[lineIndex])) continue;
      if ((/: control request failed:/i).test(lineParts[lineIndex]) || (/: unable to fetch flow contract:/i).test(lineParts[lineIndex]) || (/Unknown umhctl command:/i).test(lineParts[lineIndex]) || (/Unknown command "umhctl"/i).test(lineParts[lineIndex]) || (/ requires /i).test(lineParts[lineIndex]) || (/: invalid /i).test(lineParts[lineIndex]) || (/: --.* requires /i).test(lineParts[lineIndex])) {
        matchedLine = t(lineParts[lineIndex]);
        break;
      }
    }
    if (matchedLine) {
      return { kind: 'error', error: matchedLine, raw: txt, isTerminal: true, isError: true };
    }
    if (!expectedRequestId) {
      parsed = safeJsonParse(txt);
      if (parsed != null) return { kind: 'json', json: parsed, raw: txt, isTerminal: true, isError: !!(parsed.ok === false) };
    }
    return { kind: 'text', raw: txt, isTerminal: false, isError: false };
  }
  function safeJsonParse(raw) { try { return JSON.parse(raw); } catch (ex) { return null; } }
  function ensureImplicitConsoleBridge() {
    if (window.__meshUmhConsoleBridge) return window.__meshUmhConsoleBridge;
    if (typeof window.p15consoleReceive !== 'function') return null;
    var original = window.p15consoleReceive, listeners = [];
    window.p15consoleReceive = function () {
      var r = original.apply(this, arguments), copy = listeners.slice(0), i;
      for (i = 0; i < copy.length; i++) { try { copy[i].apply(null, arguments); } catch (ex) { } }
      return r;
    };
    window.__meshUmhConsoleBridge = {
      subscribe: function (fn) {
        listeners.push(fn);
        return function () {
          var i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        };
      }
    };
    return window.__meshUmhConsoleBridge;
  }
  function createImplicitRequestTransport() {
    var bridge = ensureImplicitConsoleBridge(), queue = Promise.resolve();
    if (!bridge || typeof window.p15consoleSend !== 'function') return null;
    return function (cmd, type) {
      var run = function () {
        return new Promise(function (resolve, reject) {
          var node = window.consoleNode, nodeId = (node && node._id) ? String(node._id) : null, lines = [], done = false, hardTimer = null, stop = null, input = document.getElementById('p15consoleText');
          var requestId = /^\s*umhctl\b/i.test(String(cmd || '')) ? buildRequestId() : null;
          var dispatchedCmd = requestId ? appendRequestId(cmd, requestId) : cmd;
          var timeoutMs = 60000;
          function cleanup() { if (stop) { try { stop(); } catch (ex) { } stop = null; } if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; } }
          function finish(err) { if (done) return; done = true; cleanup(); if (err) { reject(err); } else { resolve(lines.join('\n')); } }
          if ((type != null) && (type !== 4)) { reject(new Error('Only agent console requests are supported.')); return; }
          if (!node || node === 'server') { reject(new Error('Device console is not active.')); return; }
          if ((node.conn & 1) === 0) { reject(new Error('Agent is offline.')); return; }
          if (!input) { reject(new Error('Console input is unavailable.')); return; }
          stop = bridge.subscribe(function (rxNode, data, source) {
            var parsed, rxNodeId = (rxNode && rxNode._id) ? String(rxNode._id) : null;
            if (done || source === 'MQTT' || typeof data !== 'string') return;
            if (rxNode !== node && (!nodeId || !rxNodeId || rxNodeId !== nodeId)) return;
            lines.push(data);
            parsed = parseUmhConsoleJson(lines.join('\n'), requestId);
            if (parsed && parsed.isTerminal === true) { finish(null); return; }
          });
          hardTimer = setTimeout(function () { finish(new Error('Timed out waiting for UMH response.')); }, timeoutMs);
          try {
            if (document.getElementById('p15outputselect')) document.getElementById('p15outputselect').value = '1';
            if (typeof window.setupConsole === 'function') { try { window.setupConsole(); } catch (ex) { } }
            input.value = dispatchedCmd;
            window.p15consoleSend();
          } catch (ex2) {
            finish(ex2);
          }
        });
      };
      queue = queue.then(run, run);
      return queue;
    };
  }
  function createSearchList(doc, placeholder, size) {
    var root = E(doc, 'div', 'display:flex;flex-direction:column;gap:4px;min-width:250px;flex:1 1 290px;');
    var filter = input(doc, placeholder || 'filter', '100%');
    var list = E(doc, 'select', 'font-size:11px;padding:4px;border-radius:4px;border:1px solid #b5b5b5;min-height:132px;width:100%;box-sizing:border-box;');
    var items = [], filtered = [];
    list.size = size || 7;
    root.appendChild(filter);
    root.appendChild(list);
    function render() {
      var qx = t(filter.value).toLowerCase(), i, item, opt, selected = list.value;
      filtered = [];
      list.innerHTML = '';
      for (i = 0; i < items.length; i++) {
        item = items[i];
        if (!qx || item.label.toLowerCase().indexOf(qx) >= 0 || String(item.value).toLowerCase().indexOf(qx) >= 0) filtered.push(item);
      }
      if (filtered.length === 0) {
        opt = doc.createElement('option');
        opt.value = '';
        opt.textContent = 'No matches';
        list.appendChild(opt);
        list.disabled = true;
        return;
      }
      list.disabled = false;
      for (i = 0; i < filtered.length; i++) {
        opt = doc.createElement('option');
        opt.value = filtered[i].value;
        opt.textContent = filtered[i].label;
        if (filtered[i].title) opt.title = filtered[i].title;
        list.appendChild(opt);
      }
      list.value = selected;
      if (list.selectedIndex < 0) list.selectedIndex = 0;
    }
    filter.addEventListener('input', render);
    return {
      root: root,
      input: filter,
      list: list,
      setItems: function (nextItems) { items = nextItems || []; render(); },
      getSelected: function () {
        var i, v = list.value;
        for (i = 0; i < filtered.length; i++) { if (String(filtered[i].value) === String(v)) return filtered[i]; }
        return null;
      },
      selectValue: function (value) { var desired = String(value); if (list.value !== desired) { filter.value = ''; render(); } list.value = desired; if (list.selectedIndex < 0 && list.options.length > 0) list.selectedIndex = 0; },
      clearFilter: function () { filter.value = ''; render(); }
    };
  }
  function createTypedValueEditor(doc, width) {
    var root = row(doc, '4px'), typeSel = select(doc, [{ value: 'string', label: 'string' }, { value: 'bool', label: 'bool' }, { value: 'number', label: 'number' }, { value: 'json', label: 'json' }], '82px');
    var textBox = input(doc, 'value', width || '180px');
    var boolSel = select(doc, [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }], '86px');
    var jsonBox = textarea(doc, '{"key":"value"}', width || '180px', '62px');
    root.appendChild(typeSel); root.appendChild(textBox); root.appendChild(boolSel); root.appendChild(jsonBox);
    function sync() { var mode = typeSel.value; textBox.style.display = (mode === 'string' || mode === 'number') ? '' : 'none'; boolSel.style.display = (mode === 'bool') ? '' : 'none'; jsonBox.style.display = (mode === 'json') ? '' : 'none'; }
    typeSel.addEventListener('change', sync);
    sync();
    return {
      root: root,
      setValue: function (value, forcedType) {
        var mode = forcedType || valueType(value);
        typeSel.value = (mode === 'bool' || mode === 'number' || mode === 'json') ? mode : 'string';
        textBox.value = (value == null || typeof value === 'object') ? '' : String(value);
        boolSel.value = (value === false) ? 'false' : 'true';
        jsonBox.value = (typeof value === 'object' && value != null) ? JSON.stringify(value, null, 2) : '';
        sync();
      },
      getValue: function () {
        var mode = typeSel.value, parsed, numberValue;
        if (mode === 'bool') return (boolSel.value === 'true');
        if (mode === 'number') { if (!isNumberText(textBox.value)) return '__invalid__'; numberValue = Number(t(textBox.value)); return isFinite(numberValue) ? numberValue : '__invalid__'; }
        if (mode === 'json') { parsed = safeJsonParse(jsonBox.value); return (parsed == null) ? '__invalid__' : parsed; }
        return textBox.value;
      },
      getType: function () { return typeSel.value; }
    };
  }
  function processRank(item) { var exe = t(item && item.exe).toLowerCase(); if (!exe) return 9; if (exe === 'notepad.exe' || exe === 'chrome.exe' || exe === 'slack.exe' || exe === 'opera.exe' || exe === 'explorer.exe' || exe === 'sihost.exe' || exe === 'searchhost.exe' || exe === 'startmenuexperiencehost.exe' || exe === 'msedgewebview2.exe') return 0; if (exe === 'masterservice.exe' || exe === 'unifiedagent.exe') return 8; if (exe.indexOf('svchost.exe') >= 0 || exe.indexOf('runtimebroker.exe') >= 0 || exe.indexOf('backgroundtaskhost.exe') >= 0) return 7; return 3; }
  function buildLiveProcessItems(processes) { var list = (processes instanceof Array) ? processes.slice(0) : [], i, titleParts; list.sort(function (a, b) { var ra = processRank(a), rb = processRank(b), ea = t(a.exe).toLowerCase(), eb = t(b.exe).toLowerCase(); if (ra !== rb) return ra - rb; if (ea < eb) return -1; if (ea > eb) return 1; return (a.pid || 0) - (b.pid || 0); }); for (i = 0; i < list.length; i++) { titleParts = ['pid:' + list[i].pid, t(list[i].exe) || '[unknown]']; if (list[i].umh) titleParts.push('umh=yes'); if (list[i].session != null) titleParts.push('session=' + list[i].session); if (list[i].user) titleParts.push('user=' + list[i].user); list[i] = { value: String(list[i].pid), label: ((list[i].exe || '[unknown]') + '  pid:' + list[i].pid + (list[i].umh ? '  [umh]' : '')), title: titleParts.join(' | '), data: list[i] }; } return list; }
  function buildObjectMutation(base, key, value) { var next = cloneJson(base); if (next == null || typeof next !== 'object' || Object.prototype.toString.call(next) === '[object Array]') next = {}; next[key] = value; return next; }
  function buildConfigMutation(base, section, key, value) { var next = cloneJson(base); if (next == null || typeof next !== 'object' || Object.prototype.toString.call(next) === '[object Array]') next = {}; if (typeof next[section] !== 'object' || next[section] == null || Object.prototype.toString.call(next[section]) === '[object Array]') next[section] = {}; next[section][key] = value; return next; }

  function renderPanel(container, opts) {
    if (!container || !container.ownerDocument) return;
    var doc = container.ownerDocument;
    container.textContent = '';
    opts = opts || {};
    var state = {
      onCommand: opts.onCommand,
      request: null,
      allowTools: opts.allowTools === true,
      userfilesUser: t(opts.userfilesUser) || currentUserfilesUser(),
      userfilesBasePath: t(opts.userfilesBasePath),
      refs: {}
    };
    var panel = role(E(doc, 'div', 'display:flex;flex-direction:column;gap:5px;margin:4px 0;font-family:Segoe UI,Tahoma,sans-serif;'), 'panel');
    state.refs.notice = role(E(doc, 'div', 'display:none;padding:4px 6px;border:1px solid #f1b8bf;border-radius:4px;background:#fff4f4;color:#B00020;font-size:11px;'), 'panel-notice');
    panel.appendChild(state.refs.notice);
    function setNotice(msg, color) {
      var text = t(msg);
      if (!state.refs.notice) return;
      state.refs.notice.textContent = text;
      state.refs.notice.style.display = text ? '' : 'none';
      state.refs.notice.style.color = color || '#B00020';
      state.refs.notice.style.borderColor = text ? '#f1b8bf' : '#d7d7d7';
      state.refs.notice.style.backgroundColor = text ? '#fff4f4' : '#f8f9fa';
    }
    state.error = function (msg) {
      setNotice(msg, '#B00020');
    };
    state.clearError = function () { setNotice('', '#666'); };

    var life = group(doc, 'Lifecycle', COLORS.lifecycle);
    UMH_INSTALL_PAYLOADS.forEach(function (payload) {
      life.appendChild(btn(doc, 'Install ' + payload.label, COLORS.lifecycle, function () { var cmd = installCmd(state, payload); if (!cmd) return; state.clearError(); dispatch(state, cmd, 4); }));
    });
    life.appendChild(btn(doc, 'Uninstall', COLORS.lifecycle, function () { dispatch(state, 'umhctl uninstall', 4); }));
    life.appendChild(btn(doc, 'Svc Status', COLORS.lifecycle, function () { dispatch(state, 'umhctl status --service', 4); }));
    life.appendChild(btn(doc, 'Verify', COLORS.lifecycle, function () { dispatch(state, 'umhctl verify', 4); }));
    life.appendChild(btn(doc, 'Help', COLORS.lifecycle, function () { dispatch(state, 'umhctl help', 4); }));
    panel.appendChild(life);

    var query = group(doc, 'Query', COLORS.query);
    [['Pipe Status', 'umhctl status'], ['List Processes', 'umhctl listProcesses'], ['Flow Contract', 'umhctl getFlowContract'], ['Capabilities', 'umhctl getCapabilities'], ['Safety State', 'umhctl safetyState']].forEach(function (x) { query.appendChild(btn(doc, x[0], COLORS.query, function () { dispatch(state, x[1], 4); })); });
    panel.appendChild(query);

    var injection = group(doc, 'Injection', COLORS.injection);
    var injectionPid = input(doc, 'pid', '72px');
    var injectionTarget = select(doc, INJECTION_TARGET_OPTIONS, '190px');
    var injectionMethod = select(doc, INJECTION_METHOD_OPTIONS, '170px');
    var injectionTechnique = input(doc, 'technique', '120px');
    injection.appendChild(injectionPid);
    injection.appendChild(injectionTarget);
    injection.appendChild(injectionMethod);
    injection.appendChild(injectionTechnique);
    injection.appendChild(btn(doc, 'Inject', COLORS.injection, function () { var cmd = umhInjectCmd(state, injectionPid.value, injectionTarget.value, injectionMethod.value, injectionTechnique.value); if (!cmd) return; state.clearError(); dispatch(state, cmd, 4); }));
    injection.appendChild(btn(doc, 'Profile', COLORS.injection, function () { var cmd = umhPidCmd(state, 'profileProcess', injectionPid.value); if (!cmd) return; state.clearError(); dispatch(state, cmd, 4); }));
    injection.appendChild(btn(doc, 'Method Policy', COLORS.injection, function () { var cmd = umhPidCmd(state, 'methodPolicy', injectionPid.value); if (!cmd) return; state.clearError(); dispatch(state, cmd, 4); }));
    injection.appendChild(btn(doc, 'Boundary', COLORS.injection, function () { var cmd = umhPidCmd(state, 'securityBoundary', injectionPid.value); if (!cmd) return; state.clearError(); dispatch(state, cmd, 4); }));
    panel.appendChild(injection);

    var injectionScope = group(doc, 'Target Scope', COLORS.injection);
    var scopePids = input(doc, 'pids csv', '120px');
    var scopeTarget = select(doc, INJECTION_TARGET_OPTIONS, '190px');
    var scopeMethod = select(doc, INJECTION_METHOD_OPTIONS, '170px');
    injectionScope.appendChild(scopePids);
    injectionScope.appendChild(scopeTarget);
    injectionScope.appendChild(scopeMethod);
    injectionScope.appendChild(btn(doc, 'Set Scope', COLORS.injection, function () { var cmd = umhInjectTargetSetCmd(state, scopePids.value, scopeTarget.value, scopeMethod.value); if (!cmd) return; state.clearError(); dispatch(state, cmd, 4); }));
    injectionScope.appendChild(btn(doc, 'Inject Scope', COLORS.injection, function () { state.clearError(); dispatch(state, 'umhctl injectAll', 4); }));
    injectionScope.appendChild(btn(doc, 'Clear Scope', COLORS.injection, function () { state.clearError(); dispatch(state, 'umhctl clearTargetScope', 4); }));
    panel.appendChild(injectionScope);

    if (state.allowTools) {
      var tools = group(doc, 'Standalone Tools', COLORS.tools);
      tools.appendChild(btn(doc, 'inject32 Install', COLORS.tools, function () { dispatch(state, psDownload(state, 'Inject32.exe', 'inject32.exe', ['/S', '/quiet']), 2); }));
      tools.appendChild(btn(doc, 'rserv audio Install', COLORS.tools, function () { dispatch(state, psDownload(state, 'RServ audio.exe', 'RServ audio.exe', ['--install', '--silent', '--wait', '--timeout', '120', '--output', 'json']), 2); }));
      panel.appendChild(tools);
    }

    container.appendChild(panel);
  }

  function installRunCommandOverlay(opts) {
    opts = opts || {};
    function sendRunCommand(cmd, type) {
      var textarea = document.getElementById('d2runcmd');
      if (!textarea) return;
      var typeSel = document.getElementById('d2cmdtype');
      var sourceSel = document.getElementById('d2cmdsource');
      if (typeSel) typeSel.value = String(type || 4);
      if (sourceSel) sourceSel.value = '0';
      if (typeof window.d2runCommandValidate === 'function') { try { window.d2runCommandValidate(); } catch (ex) {} }
      textarea.value = cmd;
      textarea.focus();
      if (typeof window.d2runCommandValidate === 'function') { try { window.d2runCommandValidate(); } catch (ex2) {} }
    }
    function ensure() {
      var textarea = document.getElementById('d2runcmd');
      if (!textarea || !textarea.parentNode) return;
      var container = document.getElementById('mc-runcommand-presets');
      if (!container) {
        container = document.createElement('div');
        container.id = 'mc-runcommand-presets';
        container.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin:6px 0;';
        textarea.parentNode.insertBefore(container, textarea);
      }
      if (!container.getAttribute('data-umh-built')) {
        renderPanel(container, { onCommand: sendRunCommand, allowTools: true, userfilesUser: opts.userfilesUser, userfilesBasePath: opts.userfilesBasePath });
        container.setAttribute('data-umh-built', '1');
      }
      container.style.display = (textarea.offsetParent !== null) ? 'flex' : 'none';
    }
    ensure();
    if (!installRunCommandOverlay._interval) { installRunCommandOverlay._interval = window.setInterval(ensure, 1500); }
  }

  var FILE_EXECUTE_RIGHT = 131072;
  function getSelectedWindowsExecutable() {
    var checkboxes = document.getElementsByName('fd'), selected = null, i, box, entry, locations, path;
    if (!window.p13filetree || !window.p13filetree.dir || !checkboxes || !window.filesNode) return null;
    for (i = 0; i < checkboxes.length; i++) {
      box = checkboxes[i];
      if (!box.checked) continue;
      if (selected != null || !box.attributes || !box.attributes.file || String(box.attributes.file.value) !== '3') return null;
      entry = window.p13filetree.dir[box.value];
      if (!entry || typeof entry.n !== 'string' || !(/\.exe$/i).test(entry.n) || (/[\x00-\x1f\x7f]/).test(entry.n)) return null;
      selected = entry;
    }
    if (selected == null) return null;
    locations = Array.isArray(window.p13filetreelocation) ? window.p13filetreelocation.slice(0) : [];
    path = locations.join('\\');
    if (path.length > 0 && path.charAt(path.length - 1) !== '\\') path += '\\';
    path += selected.n;
    if (!(/^(?:[a-z]:\\|\\\\)/i).test(path)) return null;
    return { name: selected.n, path: path };
  }

  function installFilesExecutionOverlay() {
    var pendingRequest = null, requestCounter = 0, requestTimer = null;
    function isWindowsFilesNode(node) {
      if (!node || !node.agent) return false;
      if (typeof window.isWindowsNode === 'function') { try { return window.isWindowsNode(node) === true; } catch (ex) { } }
      return ((node.agent.id > 0) && (node.agent.id < 5)) || ((node.agent.id > 41) && (node.agent.id < 44));
    }
    function hasExecuteRight(node) {
      var rights = 0;
      if (!node || typeof window.GetNodeRights !== 'function') return false;
      try { rights = window.GetNodeRights(node); } catch (ex) { return false; }
      return (rights === 0xFFFFFFFF) || ((rights & FILE_EXECUTE_RIGHT) !== 0);
    }
    function getLaunchState() {
      var node = window.filesNode, current = window.currentNode, selected;
      if (!node || !current || node._id !== current._id || !isWindowsFilesNode(node) || !hasExecuteRight(node)) return null;
      if (!window.files || window.files.State !== 3 || typeof window.files.sendText !== 'function') return null;
      selected = getSelectedWindowsExecutable();
      if (!selected) return null;
      return { node: node, selected: selected };
    }
    function setStatus(message, isError) {
      var status = document.getElementById('mc-files-exec-status');
      if (!status) return;
      status.textContent = message || '';
      status.style.color = isError ? '#b00020' : '#176b2c';
      status.style.display = message ? '' : 'none';
      if (installFilesExecutionOverlay._statusTimer) window.clearTimeout(installFilesExecutionOverlay._statusTimer);
      if (message) installFilesExecutionOverlay._statusTimer = window.setTimeout(function () { status.textContent = ''; status.style.display = 'none'; }, 8000);
    }
    function launch(privileged) {
      var state = getLaunchState(), promptText;
      if (!state) { setStatus('Select one Windows .exe file and verify Remote Commands access.', true); update(); return; }
      promptText = privileged ?
        ('Run "' + state.selected.name + '" with the privileged agent identity? This normally runs as SYSTEM and may not be visible on the user desktop.') :
        ('Run "' + state.selected.name + '" as the signed-in desktop user?');
      if (typeof window.confirm === 'function' && window.confirm(promptText) !== true) return;
      try {
        pendingRequest = 'native-execute-' + Date.now() + '-' + (++requestCounter);
        window.files.sendText({ action: 'execute', reqid: pendingRequest, path: state.selected.path, privileged: privileged });
        if (requestTimer) window.clearTimeout(requestTimer);
        requestTimer = window.setTimeout(function () {
          pendingRequest = null;
          setStatus('No native launch result received. Verify the connection and agent version before retrying.', true);
        }, 15000);
        setStatus('Native launch request sent; waiting for the agent result.', false);
      } catch (ex) {
        setStatus('Could not send the launch request.', true);
      }
    }
    function update() {
      var userButton = document.getElementById('mc-files-run-user');
      var privilegedButton = document.getElementById('mc-files-run-privileged');
      var node = window.filesNode, visible = isWindowsFilesNode(node) && hasExecuteRight(node), enabled = getLaunchState() != null;
      if (!userButton || !privilegedButton) return;
      userButton.style.display = visible ? '' : 'none';
      privilegedButton.style.display = visible ? '' : 'none';
      userButton.disabled = !enabled;
      privilegedButton.disabled = !enabled;
    }
    function makeButton(id, value, title, privileged) {
      var button = document.createElement('input');
      button.id = id;
      button.type = 'button';
      button.value = value;
      button.title = title;
      button.style.marginLeft = '4px';
      button.addEventListener('click', function (event) { event.preventDefault(); launch(privileged); });
      return button;
    }
    function ensure() {
      var channel = window.files;
      if (channel && channel.m && typeof channel.m.ProcessData === 'function' && !channel.m._nativeFileActions) {
        (function (module, original) {
          module.ProcessData = function (data) {
            var result;
            try { result = JSON.parse(data); } catch (ex) { }
            if (result && result.action === 'fileaction') {
              if (result.reqid === pendingRequest) {
                if (requestTimer) window.clearTimeout(requestTimer);
                requestTimer = null; pendingRequest = null;
              }
              setStatus(result.ok ? ('Native ' + result.operation + ' succeeded' + (result.pid ? ' (PID ' + result.pid + ')' : '') + '.') : ('Native ' + result.operation + ' failed: ' + result.error), !result.ok);
              return;
            }
            return original.apply(this, arguments);
          };
          module._nativeFileActions = true;
        })(channel.m, channel.m.ProcessData);
      }
      var host = document.getElementById('p13rightOfButtons'), userButton, privilegedButton, status, original;
      if (!host) return;
      userButton = document.getElementById('mc-files-run-user');
      if (!userButton) {
        userButton = makeButton('mc-files-run-user', 'Run', 'Run the selected .exe as the signed-in desktop user. Requires Remote Commands permission.', false);
        host.appendChild(userButton);
      }
      privilegedButton = document.getElementById('mc-files-run-privileged');
      if (!privilegedButton) {
        privilegedButton = makeButton('mc-files-run-privileged', 'Run privileged', 'Run the selected .exe with the privileged agent identity (normally SYSTEM). Requires Remote Commands permission.', true);
        host.appendChild(privilegedButton);
      }
      status = document.getElementById('mc-files-exec-status');
      if (!status) {
        status = document.createElement('span');
        status.id = 'mc-files-exec-status';
        status.style.cssText = 'display:none;margin-left:6px;font-size:11px;';
        host.appendChild(status);
      }
      if (!installFilesExecutionOverlay._wrapped && typeof window.p13setActions === 'function') {
        original = window.p13setActions;
        window.p13setActions = function () { var result = original.apply(this, arguments); update(); return result; };
        installFilesExecutionOverlay._wrapped = true;
      }
      update();
    }
    ensure();
    if (!installFilesExecutionOverlay._changeBound) {
      document.addEventListener('change', function (event) { if (event.target && event.target.name === 'fd') window.setTimeout(update, 0); }, true);
      installFilesExecutionOverlay._changeBound = true;
    }
    if (!installFilesExecutionOverlay._interval) installFilesExecutionOverlay._interval = window.setInterval(ensure, 1000);
  }

  function showPanelNotice(container, msg, color) {
    var host = container, notice;
    if (!host) return false;
    notice = host.querySelector ? host.querySelector('[data-umh-role="panel-notice"]') : null;
    if (!notice && host.parentNode && host.parentNode.querySelector) notice = host.parentNode.querySelector('[data-umh-role="panel-notice"]');
    if (!notice) return false;
    notice.textContent = t(msg);
    notice.style.display = t(msg) ? '' : 'none';
    notice.style.color = color || '#B00020';
    notice.style.borderColor = t(msg) ? '#f1b8bf' : '#d7d7d7';
    notice.style.backgroundColor = t(msg) ? '#fff4f4' : '#f8f9fa';
    return true;
  }

  window.MeshCentralUmhControlUi = {
    __v4: true,
    quoteConsoleArg: q,
    buildRequestId: buildRequestId,
    appendRequestId: appendRequestId,
    resolveUserfilesUser: currentUserfilesUser,
    resolveMasterServiceUrl: masterServiceUrl,
    parseConsolePayload: parseUmhConsoleJson,
    showPanelNotice: showPanelNotice,
    renderConsolePanel: function (container, opts) { opts = opts || {}; renderPanel(container, { onCommand: opts.onCommand, request: opts.request, allowTools: false, userfilesUser: t(opts.userfilesUser) || currentUserfilesUser(), userfilesBasePath: opts.userfilesBasePath || window.MC_USERFILES_BASEPATH || '' }); },
    installRunCommandOverlay: installRunCommandOverlay,
    installFilesExecutionOverlay: installFilesExecutionOverlay
  };

  function start() {
    installRunCommandOverlay({ userfilesUser: currentUserfilesUser(), userfilesBasePath: window.MC_USERFILES_BASEPATH || '' });
    installFilesExecutionOverlay();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/*
 * Trackpad ("mouse pointer") mode engine loader.
 *
 * On the Modern UI and classic mobile desktop pages, and both guest share pages, loads the fork's
 * trackpad gesture engine, controller and the page's adapter when this browser has them enabled,
 * and installs the controller. Each page kind has its own flag, defaulting to DEFAULT_ON; opening
 * a page with ?trackpadengine=on or =off sets the flag for this browser (=default forgets it), and
 * DEFAULT_ON[kind] = false rolls a page kind back. With the flag off nothing is loaded and nothing
 * listens. The trackpad mode itself stays off until the user turns it on in the page. It wraps
 * nothing: viewer modules are observed through agent-desktop's MeshDesktopModuleObservers and
 * addStateListener.
 */
(function () {
  'use strict';
  if (window.__meshTrackpadLoader) return;
  window.__meshTrackpadLoader = true;

  var DEFAULT_ON = { default3: true, defaultMobile: true, sharingMobile: true, sharing: true };
  var ADAPTER_FILES = { default3: 'agent-desktop-trackpad-default3-0.0.1.js', defaultMobile: 'agent-desktop-trackpad-mobile-0.0.1.js', sharingMobile: 'agent-desktop-trackpad-sharing-mobile-0.0.1.js', sharing: 'agent-desktop-trackpad-sharing-0.0.1.js' };
  var COMMON_FILES = ['agent-desktop-trackpad-0.0.1.js', 'agent-desktop-trackpad-controller-0.0.1.js'];
  var base = 'scripts/';
  try {
    var selfSrc = (document.currentScript && document.currentScript.src) || '';
    if (selfSrc) { base = selfSrc.substring(0, selfSrc.lastIndexOf('/') + 1); }
  } catch (ex) { }

  function storageKey(kind) { return 'meshTrackpadEngine.' + kind; }

  function flag(kind) {
    try {
      var v = window.localStorage.getItem(storageKey(kind));
      if (v === 'on') return true;
      if (v === 'off') return false;
    } catch (ex) { }
    return DEFAULT_ON[kind] === true;
  }

  function applyUrlFlag(kind) {
    var m = /[?&]trackpadengine=(on|off|default)(?:&|#|$)/.exec(window.location.search || '');
    if (!m) return;
    try {
      if (m[1] === 'default') { window.localStorage.removeItem(storageKey(kind)); }
      else { window.localStorage.setItem(storageKey(kind), m[1]); }
    } catch (ex) { }
  }

  // The guest share pages have no trackpad mode: their adapters supply it. The one for phones is
  // the classic mobile page's layout, the one for desktop browsers (and iPadOS) the main desktop
  // UI's, each with the share link's viewOnly, which the main UI pages lack.
  function pageKind() {
    if (typeof window.trackpadMode === 'undefined') {
      if (typeof window.viewOnly === 'undefined') return null;
      if (document.getElementById('p10desktop') && document.getElementById('DeskParent') && (typeof window.fullscreenzoom !== 'undefined')) return 'sharingMobile';
      if (document.getElementById('deskarea3x') && document.getElementById('DeskParent') && document.getElementById('DeskControlSpan')) return 'sharing';
      return null;
    }
    if (document.getElementById('deskarea3x') && document.getElementById('DeskParent') && (typeof window._mobileZoomMode !== 'undefined')) return 'default3';
    if (document.getElementById('p10desktop') && document.getElementById('DeskParent') && (typeof window.fullscreenzoom !== 'undefined')) return 'defaultMobile';
    return null;
  }

  // Load in order; stop quietly at the first failure, leaving trackpad mode to the page.
  function load(files, done, failed) {
    var i = 0;
    (function next() {
      if (i >= files.length) { done(); return; }
      var s = document.createElement('script');
      s.src = base + files[i++];
      s.async = false;
      s.onload = next;
      s.onerror = function () { if (failed) failed(); };
      document.head.appendChild(s);
    })();
  }

  function start() {
    var kind = pageKind();
    if (!kind) return;
    applyUrlFlag(kind);
    if (!flag(kind)) return;
    var controller = null;
    function watch(module) {
      if (module && module.addStateListener) { module.addStateListener(function (m, state) { if (controller) controller.onModuleState(m, state); }); }
    }
    // Register before the page connects, so every viewer module (including a WebRTC soft desktop)
    // reports its state changes.
    window.MeshDesktopModuleObservers = window.MeshDesktopModuleObservers || [];
    window.MeshDesktopModuleObservers.push(watch);
    if (window.desktop && window.desktop.m) watch(window.desktop.m);
    function giveUp() {
      // Stop observing new modules; a module created meanwhile keeps an inert listener.
      var i = window.MeshDesktopModuleObservers.indexOf(watch);
      if (i >= 0) window.MeshDesktopModuleObservers.splice(i, 1);
    }
    load(COMMON_FILES.concat([ADAPTER_FILES[kind]]), function () {
      var adapter = window.MeshTrackpadAdapters && window.MeshTrackpadAdapters[kind];
      if (!adapter || !window.MeshTrackpadController || !window.MeshTrackpadEngine || !adapter.detect()) { giveUp(); return; }
      controller = window.MeshTrackpadController.create({ adapter: adapter, engine: window.MeshTrackpadEngine, enabled: function () { return true; } });
      controller.install();
      window.MeshTrackpad = { controller: controller, kind: kind };
    }, giveUp);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/*
 * Desktop audio speaker control (system-audio feature, tunnel protocol 20).
 *
 * Adds a speaker button and a volume slider to the top toolbar of both desktop viewer pages: the
 * main UI Desktop tab (and its stand-alone desktop window) and guest desktop share links. The
 * control is hidden until the desktop tunnel advertises audio, starts muted for every session,
 * and lets the viewer hear the endpoint's speaker output over a second relay tunnel (protocol 20)
 * that inherits the desktop session's consent and notification. Live only, never recorded.
 *
 * This block is self-contained and override-friendly: it hooks the stock pages only by wrapping
 * the global CreateAgentRedirect factory and by inserting the control before the first button of the
 * toolbar's right-hand group (the group holding #deskActionsSettings). It never forks a stock view.
 */
(function () {
  'use strict';
  if (window.__meshDesktopAudioControl) return; // install once per page
  window.__meshDesktopAudioControl = true;

  var CTRL_CHANNEL = '102938';
  var AUDIO_PROTOCOL = 20;
  var DESKTOP_PROTOCOL = 2;

  // Resolve sibling script URLs relative to this custom.js so they load from
  // the same meshcentral-web scripts/ directory on every page.
  var scriptsBase = '';
  try {
    var selfSrc = (document.currentScript && document.currentScript.src) || '';
    if (selfSrc) { scriptsBase = selfSrc.substring(0, selfSrc.lastIndexOf('/') + 1); }
  } catch (ex) { scriptsBase = ''; }
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
  // A speaker button and a volume slider, grouped as the first button of the desktop toolbar's
  // right-hand group (.toright2), left of Actions / Settings. The group is sized to the 22px
  // toolbar row, the slider shows only while audio is connecting or playing, and the sound waves
  // animate only while audio is actually flowing (not on silence).
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
  function saveVolume(value) { try { window.localStorage.setItem(VOLUME_KEY, String(value)); } catch (ex) { } }

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
    controlEl.hidden = !uiState.available;
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

  function createControl() {
    ensureStyle();
    var group = document.createElement('span');
    group.id = 'mc-desk-audio';
    group.hidden = true;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Device audio');

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
    renderControl();
    return group;
  }

  // Mount as the first button of the toolbar's right-hand group: inline, directly before its first
  // input (Focus/Actions on the main page, Settings on share links), followed by a space so the gap
  // matches the stock buttons (.mR margin plus inline whitespace). Floats would leave free space
  // between them and the right-aligned buttons. The mount is re-checked periodically.
  var spacerEl = null;
  function findMountAnchor() {
    var settings = document.getElementById('deskActionsSettings');
    var group = settings ? settings.parentNode : null;
    // Both mobile viewer templates use Full Screen in their top toolbar.
    if (!group) return document.getElementById('deskFullScreen');
    for (var el = group.firstElementChild; el != null; el = el.nextElementSibling) {
      if (el.tagName === 'INPUT') { return el; }
    }
    return null;
  }
  function ensureControlMounted() {
    var anchor = findMountAnchor();
    if (!anchor) return;
    if (!controlEl) { createControl(); spacerEl = document.createTextNode(' '); }
    controlEl.setAttribute('data-mobile', document.getElementById('deskActionsSettings') ? 'false' : 'true');
    if (controlEl.parentNode !== anchor.parentNode || controlEl.nextSibling !== spacerEl || spacerEl.nextSibling !== anchor) {
      anchor.parentNode.insertBefore(controlEl, anchor);
      anchor.parentNode.insertBefore(spacerEl, anchor);
      renderControl();
    }
  }

  // ---- Desktop binding / availability ------------------------------------
  function isSingleDesktopViewer(module) {
    try {
      var desk = document.getElementById('Desk');
      return !!(desk && module && module.CanvasId === desk);
    } catch (ex) { return false; }
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
    ensureControlMounted();
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
      // The player re-checks the outcome; this call only has to happen inside the gesture.
      try { var resumed = ctx.resume(); if (resumed && typeof resumed.catch === 'function') { resumed.catch(function () { }); } } catch (ex2) { }
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
    } catch (ex) { handleAgentStatus('error', 'relay error'); return; }
    audioRedir = redir;
    redir.options = {};
    var tsid = desktop.__mcAudioTsid ? desktop.__mcAudioTsid.value : (desktop.options ? desktop.options.tsid : null);
    if (tsid != null) { redir.options.tsid = tsid; }
    redir.onStateChanged = function (obj, state) { if (state === 0 && audioRedir === redir) { onAudioTunnelClosed(); } };
    attachAudioCtrlObserver(redir);
    try { redir.Start(nodeid); } catch (ex2) { handleAgentStatus('error', 'relay error'); }
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
    if (audioRedir) { var r = audioRedir; audioRedir = null; try { r.onStateChanged = null; } catch (ex) { } try { r.Stop(); } catch (ex2) { } }
    if (player) { var p = player; player = null; try { p.stop(); } catch (ex3) { } }
    // The player does not own the click-created context, so the controller closes it.
    if (audioCtx) {
      var c = audioCtx; audioCtx = null;
      try { var closing = c.close(); if (closing && typeof closing.catch === 'function') { closing.catch(function () { }); } } catch (ex4) { }
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

  // ---- Ctrl-message observation ------------------------------------------
  // Wrap a redir object's xxOnControlCommand to surface ctrlChannel 102938
  // "audio" messages, then delegate to the original handler unchanged.
  function wrapCtrl(redir, onAudioMsg) {
    if (!redir || redir.__mcAudioCtrlWrapped) return;
    function observe(handler) {
      if (typeof handler !== 'function') return handler;
      return function (msg) {
        try {
          var m = JSON.parse(msg);
          if (m && String(m.ctrlChannel) === CTRL_CHANNEL && m.type === 'audio') { onAudioMsg(m); }
        } catch (ex) { /* not JSON / not ours */ }
        return handler.apply(this, arguments);
      };
    }
    var wrapped = observe(redir.xxOnControlCommand);
    // Custom redirectors assign module.parent before initializing this handler.
    // Observe subsequent assignments so constructor initialization retains the hook.
    try {
      Object.defineProperty(redir, 'xxOnControlCommand', {
        configurable: true,
        enumerable: true,
        get: function () { return wrapped; },
        set: function (handler) { if (handler !== wrapped) { wrapped = observe(handler); } }
      });
    } catch (ex) { redir.xxOnControlCommand = wrapped; }
    redir.__mcAudioCtrlWrapped = true;
  }

  function attachDesktopCtrlObserver(redir) {
    wrapCtrl(redir, function (m) {
      if (m.state === 'available' && (m.protocol == null || m.protocol === AUDIO_PROTOCOL)) {
        // The agent names the session its desktop tunnel streams; with desktop multiplexing that is the
        // first viewer's session, which may differ from this page's own selection.
        if (Object.prototype.hasOwnProperty.call(m, 'tsid')) { redir.__mcAudioTsid = { value: m.tsid }; }
        onDesktopAudioAvailable(redir);
      }
    });
  }

  function attachAudioCtrlObserver(redir) {
    wrapCtrl(redir, function (m) {
      if (audioRedir === redir && m.state) { handleAgentStatus(m.state, m.reason); }
    });
  }

  // Chain onStateChanged so we observe desktop disconnects without clobbering
  // the page's own handler (which it assigns after CreateAgentRedirect returns).
  function chainDesktopStateChanged(redir) {
    if (redir.__mcAudioStateChained) return;
    redir.__mcAudioStateChained = true;
    var pageHandler = redir.onStateChanged;
    function chained(obj, state) {
      if (typeof pageHandler === 'function') { try { pageHandler(obj, state); } catch (ex) { } }
      if (state === 0) { onDesktopClosed(redir); }
    }
    try {
      Object.defineProperty(redir, 'onStateChanged', {
        configurable: true,
        get: function () { return chained; },
        set: function (fn) { pageHandler = fn; }
      });
    } catch (ex) { redir.onStateChanged = chained; }
  }

  // ---- Hook the factory --------------------------------------------------
  function observeDesktopModule(module) {
    if (!module || module.__mcAudioModuleObserved) return;
    module.__mcAudioModuleObserved = true;
    var parentRedir = module.parent || null;
    try {
      Object.defineProperty(module, 'parent', {
        configurable: true,
        enumerable: true,
        get: function () { return parentRedir; },
        set: function (redir) {
          parentRedir = redir;
          try {
            if (redir && module.protocol === DESKTOP_PROTOCOL && isSingleDesktopViewer(module)) {
              attachDesktopCtrlObserver(redir);
              chainDesktopStateChanged(redir);
            }
          } catch (ex) { /* never break tunnel creation */ }
        }
      });
    } catch (ex) { }
  }

  function hookCreateAgentRemoteDesktop() {
    if (typeof window.CreateAgentRemoteDesktop !== 'function' || window.CreateAgentRemoteDesktop.__mcAudioHooked) return;
    var originalDesktop = window.CreateAgentRemoteDesktop;
    var wrappedDesktop = function () {
      var module = originalDesktop.apply(this, arguments);
      try {
        if (module && isSingleDesktopViewer(module)) { observeDesktopModule(module); }
      } catch (ex) { }
      return module;
    };
    wrappedDesktop.__mcAudioHooked = true;
    window.CreateAgentRemoteDesktop = wrappedDesktop;
  }

  function hookCreateAgentRedirect() {
    hookCreateAgentRemoteDesktop();
    if (typeof window.CreateAgentRedirect !== 'function' || window.CreateAgentRedirect.__mcAudioHooked) return;
    var original = window.CreateAgentRedirect;
    var wrapped = function (meshserver, module) {
      var redir = original.apply(this, arguments);
      try {
        // Both desktop pages: the main UI and guest share links (meshserver == null). Share links reach
        // the agent only because the fork's meshrelay.js admits protocol 20 alongside desktop.
        if (redir && module && module.protocol === DESKTOP_PROTOCOL && isSingleDesktopViewer(module)) {
          attachDesktopCtrlObserver(redir);
          chainDesktopStateChanged(redir);
        }
      } catch (ex) { /* never break tunnel creation */ }
      return redir;
    };
    wrapped.__mcAudioHooked = true;
    window.CreateAgentRedirect = wrapped;
  }

  function init() {
    hookCreateAgentRedirect();
    // The redir script may load after custom.js in some templates; re-hook and
    // keep the control mounted on a light interval, matching the idiom used above.
    setInterval(function () { hookCreateAgentRedirect(); if (uiState.available) { ensureControlMounted(); } }, 1500);
  }
  hookCreateAgentRedirect();
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }

  // Expose a tiny surface for tests / debugging without leaking internals.
  window.MeshDesktopAudioControl = {
    _getUiState: function () { return { available: uiState.available, state: uiState.state, reason: uiState.reason }; },
    _hasIcon: function () { return !!document.getElementById('mc-desk-audio-btn'); },
    _getVolume: function () { return volumePercent; },
    _getDiagnostics: function () { return player ? player.getDiagnostics() : null; }
  };
})();
