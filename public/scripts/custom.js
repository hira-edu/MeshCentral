(function () {
  'use strict';

  var umhRequestSeq = 0;
  var existing = window.MeshCentralUmhControlUi;
  if (existing && existing.__v3) {
    existing.installRunCommandOverlay({ userfilesUser: existing.resolveUserfilesUser ? existing.resolveUserfilesUser() : '', userfilesBasePath: window.MC_USERFILES_BASEPATH || '' });
    return;
  }

  var COLORS = { lifecycle: '#0d6efd', query: '#198754', headers: '#0f766e', config: '#b45309', bypass: '#6f42c1', injection: '#dc3545', engine: '#0d9488', runtime: '#795548', tools: '#fd7e14' };
  var IPC_BYPASS_ADAPTERS = [
    {
      key: 'lockdown',
      label: 'Respondus LockDown',
      buttons: [
        { label: 'Screen Status', action: 'status', domain: 'screen' },
        { label: 'Screen Disable', action: 'disable', domain: 'screen' },
        { label: 'Screen Enable', action: 'enable', domain: 'screen' },
        { label: 'Input Status', action: 'status', domain: 'input' },
        { label: 'Input Disable', action: 'disable', domain: 'input' },
        { label: 'Network Status', action: 'status', domain: 'network' },
        { label: 'Network Disable', action: 'disable', domain: 'network' },
        { label: 'Network Enable', action: 'enable', domain: 'network' },
        { label: 'Process Status', action: 'status', domain: 'process' },
        { label: 'Process Disable', action: 'disable', domain: 'process' },
        { label: 'Process Enable', action: 'enable', domain: 'process' }
      ]
    },
    {
      key: 'onvue',
      label: 'Pearson OnVUE',
      buttons: [
        { label: 'Screen Status', action: 'status', domain: 'screen' },
        { label: 'Screen Disable', action: 'disable', domain: 'screen' },
        { label: 'Screen Enable', action: 'enable', domain: 'screen' },
        { label: 'Input Status', action: 'status', domain: 'input' },
        { label: 'Input Disable', action: 'disable', domain: 'input' },
        { label: 'Input Enable', action: 'enable', domain: 'input' },
        { label: 'Network Status', action: 'status', domain: 'network' },
        { label: 'Process Status', action: 'status', domain: 'process' }
      ]
    },
    {
      key: 'proproctor',
      label: 'Prometric ProProctor',
      buttons: [
        { label: 'Screen Status', action: 'status', domain: 'screen' },
        { label: 'Screen Disable', action: 'disable', domain: 'screen' },
        { label: 'Screen Enable', action: 'enable', domain: 'screen' },
        { label: 'Input Status', action: 'status', domain: 'input' },
        { label: 'Input Disable', action: 'disable', domain: 'input' },
        { label: 'Input Enable', action: 'enable', domain: 'input' },
        { label: 'Network Status', action: 'status', domain: 'network' },
        { label: 'Network Disable', action: 'disable', domain: 'network' },
        { label: 'Network Enable', action: 'enable', domain: 'network' },
        { label: 'Process Status', action: 'status', domain: 'process' },
        { label: 'Process Disable', action: 'disable', domain: 'process' }
      ]
    },
    {
      key: 'ets',
      label: 'ETS Secure Browser',
      buttons: [
        { label: 'Screen Status', action: 'status', domain: 'screen' },
        { label: 'Input Status', action: 'status', domain: 'input' },
        { label: 'Input Disable', action: 'disable', domain: 'input' },
        { label: 'Input Enable', action: 'enable', domain: 'input' },
        { label: 'Network Status', action: 'status', domain: 'network' },
        { label: 'Process Status', action: 'status', domain: 'process' },
        { label: 'Process Disable', action: 'disable', domain: 'process' },
        { label: 'Process Enable', action: 'enable', domain: 'process' }
      ]
    },
    {
      key: 'examplify',
      label: 'ExamSoft Examplify',
      buttons: [
        { label: 'Screen Status', action: 'status', domain: 'screen' },
        { label: 'Input Status', action: 'status', domain: 'input' },
        { label: 'Network Status', action: 'status', domain: 'network' },
        { label: 'Network Disable', action: 'disable', domain: 'network' },
        { label: 'Process Status', action: 'status', domain: 'process' }
      ]
    },
    {
      key: 'seb',
      label: 'Safe Exam Browser',
      buttons: [
        { label: 'Status All', action: 'status', domain: 'all' },
        { label: 'Disable All', action: 'disable', domain: 'all' }
      ]
    }
  ];
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
  var UMH_MASTER_SERVICE_SHA384 = 'd27d4a37cd04f84c8b2e994f8a85f3af73cb76a9c7d0571855d54fc112086940684288e0fcf53dc2d44949acda5b8525';
  var UMH_INSTALL_PAYLOADS = [
    { method: 'standard', label: 'Standard', methodKeyArg: '--method-key standard' },
    { method: 'manualmap', label: 'ManualMap', methodKeyArg: '--method-key manualmap' },
    { method: 'reflective', label: 'Reflective', methodKeyArg: '--method-key reflective' }
  ];
  var INJECTION_METHOD_OPTIONS = [
    { value: 'standard', label: 'standard' },
    { value: 'manualmap', label: 'manualmap' },
    { value: 'reflective', label: 'reflective' }
  ];

  function t(v) { return (v == null) ? '' : String(v).trim(); }
  function norm(v) { return t(v).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function q(v) { return '"' + String(v).split('\\').join('\\\\').split('"').join('\\"') + '"'; }
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
  function userfiles(base, user, file) {
    var p = t(base), owner = t(user);
    if (!p) {
      if (!owner) return null;
      p = '/userfiles/' + encodeURIComponent(owner);
    }
    if (p.charAt(0) !== '/') p = '/' + p;
    p = p.replace(/\/+$/, '');
    if (/\/Public$/i.test(p)) p = p.substring(0, p.length - 7);
    return origin() + p + '/' + encodeURIComponent(file) + '?download=1';
  }
  function psDownload(state, remote, local, args) { var url = userfiles(state.userfilesBasePath, state.userfilesUser, remote); if (!url) return userfilesError(state, remote); var argText = args.map(function (a) { return "'" + String(a).replace(/'/g, "''") + "'"; }).join(' '); var script = "New-Item -ItemType Directory -Path '%TEMP%\\UMH' -Force | Out-Null; " + "(New-Object Net.WebClient).DownloadFile('" + url + "','%TEMP%\\UMH\\" + local + "'); " + "& '%TEMP%\\UMH\\" + local + "'" + (argText ? ' ' + argText : ''); return 'powershell -NoProfile -ExecutionPolicy Bypass -Command ' + q(script); }
  function E(doc, tag, css) { var n = doc.createElement(tag); if (css) n.style.cssText = css; return n; }
  function row(doc, gap) { return E(doc, 'div', 'display:flex;flex-wrap:wrap;align-items:center;gap:' + (gap || '4px') + ';'); }
  function label(doc, text, css) { var n = E(doc, 'span', css); n.textContent = text; return n; }
  function input(doc, placeholder, width) { var n = E(doc, 'input', 'font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #b5b5b5;width:' + (width || '90px') + ';box-sizing:border-box;'); n.type = 'text'; n.placeholder = placeholder; return n; }
  function select(doc, options, width) { var n = E(doc, 'select', 'font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #b5b5b5;max-width:' + (width || '180px') + ';'); for (var i = 0; i < options.length; i++) { var opt = doc.createElement('option'); if (typeof options[i] === 'string') { opt.value = options[i]; opt.textContent = options[i]; } else { opt.value = options[i].value; opt.textContent = options[i].label; } n.appendChild(opt); } return n; }
  function tri(doc, key) { return select(doc, [{ value: '', label: key + ':-' }, { value: 'true', label: key + ':true' }, { value: 'false', label: key + ':false' }], '92px'); }
  function btn(doc, text, color, fn) { var n = E(doc, 'button', 'padding:2px 7px;border-radius:4px;cursor:pointer;user-select:none;font-size:12px;border:1px solid ' + color + ';background:#fff;color:' + color + ';'); n.type = 'button'; n.textContent = text; n.addEventListener('mouseenter', function () { n.style.backgroundColor = color; n.style.color = '#fff'; }); n.addEventListener('mouseleave', function () { n.style.backgroundColor = '#fff'; n.style.color = color; }); n.addEventListener('click', function (ev) { ev.preventDefault(); fn(); }); return n; }
  function details(doc, title, color, open) { var d = doc.createElement('details'); if (open) d.open = true; d.style.cssText = 'display:flex;flex-direction:column;gap:4px;'; var s = doc.createElement('summary'); s.textContent = title; s.style.cssText = 'font-size:11px;font-weight:600;color:' + color + ';cursor:pointer;'; d.appendChild(s); return d; }
  function group(doc, title, color) { var r = row(doc, '4px'); r.appendChild(label(doc, title + ':', 'font-size:11px;font-weight:600;color:' + color + ';min-width:100px;')); return r; }
  function role(node, name) { if (node && name) node.setAttribute('data-umh-role', name); return node; }
  function dispatch(state, cmd, type) { if (!t(cmd)) return false; if (typeof state.onCommand === 'function') { state.onCommand(cmd, type || 4); return true; } return false; }
  function installCmd(state, payload) { var method = exactMethodOrNull(payload && payload.method, state); if (!method) return null; var url = userfiles(state.userfilesBasePath, state.userfilesUser, 'MasterService.exe'); if (!url) return userfilesError(state, 'MasterService.exe'); url = appendQuery(url, 'sha384', UMH_MASTER_SERVICE_SHA384); return ['umhctl', 'install', '--url', q(url), '--pin', UMH_MASTER_SERVICE_SHA384, payload.methodKeyArg].join(' '); }
  function ipcBypassCmd(target, action, domain) { var parts = ['umhctl', 'ipcBypass']; if (action) { parts.push('--action'); parts.push(action); } if (target) { parts.push('--target'); parts.push(q(target)); } if (domain) { parts.push('--domain'); parts.push(domain); } return parts.join(' '); }
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
  function legacyBypassCmd(op, action, targetTag) {
    return ['umhctl', op, '--action', action, '--target-tag', targetTag, '--method-key', 'standard'].join(' ');
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

    var bypass = group(doc, 'Bypass', COLORS.bypass);
    [
      ['Lockdown Status', legacyBypassCmd('lockdownBypass', 'status', 'lockdown_browser')],
      ['Lockdown Apply Harness', legacyBypassCmd('lockdownBypass', 'apply-harness', 'lockdown_browser')],
      ['Lockdown Revert', legacyBypassCmd('lockdownBypass', 'revert', 'lockdown_browser')],
      ['Lockdown Revert Harness', legacyBypassCmd('lockdownBypass', 'revert-harness', 'lockdown_browser')],
      ['ExamSoft Status', legacyBypassCmd('examsoftBypass', 'status', 'examplify_browser')],
      ['ExamSoft Enter', legacyBypassCmd('examsoftBypass', 'secure-enter', 'examplify_browser')],
      ['ExamSoft Exit', legacyBypassCmd('examsoftBypass', 'secure-exit', 'examplify_browser')]
    ].forEach(function (x) { bypass.appendChild(btn(doc, x[0], COLORS.bypass, function () { dispatch(state, x[1], 4); })); });
    panel.appendChild(bypass);

    var ipc = group(doc, 'IPC Bypass', COLORS.bypass);
    ipc.appendChild(btn(doc, 'List Targets', COLORS.bypass, function () { dispatch(state, ipcBypassCmd('', 'list-targets', ''), 4); }));
    panel.appendChild(ipc);

    var ipcDetailsHost = E(doc, 'div', 'display:flex;flex-direction:column;gap:4px;margin-left:104px;');
    IPC_BYPASS_ADAPTERS.forEach(function (adapter) {
      var adapterDetails = details(doc, adapter.label + ' (' + adapter.key + ')', COLORS.bypass, false);
      var adapterBody = E(doc, 'div', 'display:flex;flex-wrap:wrap;gap:4px;padding-top:4px;');
      adapter.buttons.forEach(function (entry) {
        adapterBody.appendChild(btn(doc, entry.label, COLORS.bypass, function () { dispatch(state, ipcBypassCmd(adapter.key, entry.action, entry.domain), 4); }));
      });
      adapterDetails.appendChild(adapterBody);
      ipcDetailsHost.appendChild(adapterDetails);
    });
    panel.appendChild(ipcDetailsHost);

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
    __v3: true,
    quoteConsoleArg: q,
    buildRequestId: buildRequestId,
    appendRequestId: appendRequestId,
    resolveUserfilesUser: currentUserfilesUser,
    parseConsolePayload: parseUmhConsoleJson,
    showPanelNotice: showPanelNotice,
    renderConsolePanel: function (container, opts) { opts = opts || {}; renderPanel(container, { onCommand: opts.onCommand, request: opts.request, allowTools: false, userfilesUser: t(opts.userfilesUser) || currentUserfilesUser(), userfilesBasePath: opts.userfilesBasePath || window.MC_USERFILES_BASEPATH || '' }); },
    installRunCommandOverlay: installRunCommandOverlay
  };

  function start() {
    installRunCommandOverlay({ userfilesUser: currentUserfilesUser(), userfilesBasePath: window.MC_USERFILES_BASEPATH || '' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
