(function (root, factory) {
    'use strict';

    if (typeof module === 'object' && module.exports) module.exports = factory();
    else if (!root.MeshCentralNativeRuntime) {
        root.MeshCentralNativeRuntime = factory();
        root.MeshCentralNativeRuntime.install(root);
    }
}(typeof window === 'object' ? window : this, function () {
    'use strict';

    var STATUS_POLL_DELAYS = [250, 500, 1000, 2000];

    function older(a, b) { return a.length < b.length || (a.length === b.length && a < b); }
    function uuid(crypto) {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var text = Array.prototype.map.call(bytes, function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
        return text.slice(0, 8) + '-' + text.slice(8, 12) + '-' + text.slice(12, 16) + '-' + text.slice(16, 20) + '-' + text.slice(20);
    }

    function confirmed(result) {
        if (!result || (result.state !== 'ready' && result.state !== 'degraded' && result.state !== 'unavailable')) return false;
        var booleans = ['loadEnabled', 'operationPending', 'anyResident', 'anyActive', 'anyInactive', 'restartRequired'];
        var counts = ['matchedTargetCount', 'residentTargetCount', 'activeTargetCount', 'inactiveTargetCount', 'failedTargetCount'];
        var i, value;
        for (i = 0; i < booleans.length; ++i) if (typeof result[booleans[i]] !== 'boolean') return false;
        for (i = 0; i < counts.length; ++i) {
            value = result[counts[i]];
            if (typeof value !== 'number' || value < 0 || !Number.isSafeInteger(value)) return false;
        }
        return typeof result.canControl === 'boolean' &&
            typeof result.controllerEpoch === 'string' && /^[0-9a-f]{32}$/.test(result.controllerEpoch) &&
            typeof result.generation === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(result.generation);
    }

    function createModel(transport, makeId, render, pause) {
        pause = pause || function (milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds); }); };
        var state = { pending: false, polling: false, pendingOperation: null, status: null, error: null, scope: '', serial: 0, resetGeneration: 0 };
        function nextOperation() {
            var s = state.status;
            if (state.pending || state.polling) return null;
            if (state.error && (!s || s.operationPending || s.state === 'unavailable')) return 'getStatus';
            if (!s) return null;
            if (s.operationPending || s.state === 'unavailable') return 'getStatus';
            if (!s.canControl) return null;
            if (s.anyActive) return 'unload';
            return 'load';
        }
        function reset(scope) {
            state.serial++;
            state.resetGeneration++;
            state.scope = scope;
            state.pending = false;
            state.polling = false;
            state.pendingOperation = null;
            state.status = null;
            state.error = null;
            render(state, null);
        }
        async function settlePending(scope, resetGeneration) {
            state.polling = true;
            render(state, null);
            for (var i = 0; i < STATUS_POLL_DELAYS.length; ++i) {
                await pause(STATUS_POLL_DELAYS[i]);
                if (state.scope !== scope || state.resetGeneration !== resetGeneration) return false;
                await request('getStatus');
                if (state.scope !== scope || state.resetGeneration !== resetGeneration) return false;
                if (!state.status || !state.status.operationPending) {
                    state.polling = false;
                    render(state, nextOperation());
                    return state.status != null;
                }
            }
            if (state.scope !== scope || state.resetGeneration !== resetGeneration) return false;
            state.polling = false;
            state.error = 'Runtime operation is still pending. Retry status.';
            render(state, nextOperation());
            return false;
        }
        async function request(operation) {
            if (state.pending || (operation !== 'getStatus' && operation !== nextOperation())) return false;
            var serial = ++state.serial;
            var settle = false;
            var command = { action: 'nativeRuntime', version: 1, operation: operation, requestId: makeId() };
            if (operation === 'load' || operation === 'unload') {
                command.controllerEpoch = state.status.controllerEpoch;
                command.expectedGeneration = state.status.generation;
            }
            state.pending = true;
            state.pendingOperation = operation;
            state.error = null;
            render(state, null);
            try {
                var result = await transport(command);
                if (state.serial !== serial) return false;
                if (!result || result.action !== 'nativeRuntimeResult' || result.version !== 1 ||
                    result.requestId !== command.requestId || result.operation !== operation) throw new Error('Unconfirmed response. Refresh status.');
                var hasConfirmedState = confirmed(result);
                if (result.ok === true && !hasConfirmedState) throw new Error('Invalid runtime status.');
                if (hasConfirmedState && state.status && result.controllerEpoch === state.status.controllerEpoch && older(result.generation, state.status.generation)) {
                    throw new Error('Stale runtime status. Refresh before changing it.');
                }
                state.status = hasConfirmedState ? result : null;
                state.error = result.ok === false ? ((result.error && result.error.message) || 'Status unknown. Refresh to reconcile.') : null;
                settle = operation !== 'getStatus' && result.ok === true && hasConfirmedState && result.operationPending;
            } catch (error) {
                if (state.serial !== serial) return false;
                state.status = null;
                state.error = error.message || 'Status unknown. Refresh to reconcile.';
            }
            if (state.serial !== serial) return false;
            state.pending = false;
            state.pendingOperation = null;
            render(state, nextOperation());
            // Never repeat a mutation automatically. When its outcome was not
            // confirmed, immediately reconcile with the read-only status path.
            if (operation !== 'getStatus' && state.status == null && state.error) return request('getStatus');
            if (settle) return settlePending(state.scope, state.resetGeneration);
            return true;
        }
        return { reset: reset, request: request, nextOperation: nextOperation, state: state };
    }

    function install(win) {
        var doc = win.document;
        var panel, status, control, currentKey = null, scheduled = false;
        var runtimeEndpoint = doc.currentScript && doc.currentScript.src ?
            new win.URL('request', doc.currentScript.src).href :
            new win.URL('plugin/nativeruntime/request', win.location.href).href;
        var model = createModel(send, function () { return uuid(win.crypto); }, paint,
            function (milliseconds) { return new Promise(function (resolve) { win.setTimeout(resolve, milliseconds); }); });

        function context() {
            var guest = /\/sharing\/?$/.test(win.location.pathname);
            var node = win.currentNode || win.desktopNode;
            return { guest: guest, nodeid: guest ? null : (node && node._id), auth: win.authCookie,
                connection: win.meshserver ? win.meshserver.State : null, desktop: win.desktop ? win.desktop.State : null };
        }
        async function send(command) {
            var c = context();
            if (!c.auth || (!c.guest && !c.nodeid)) throw new Error('Select a device to see runtime status.');
            if (!c.guest) command.nodeid = c.nodeid;
            var cancellation = new win.AbortController();
            var timer = win.setTimeout(function () { cancellation.abort(); }, 20000);
            try {
                var response = await win.fetch(runtimeEndpoint, {
                    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: cancellation.signal,
                    headers: { 'Content-Type': 'application/json', 'X-Native-Runtime': '1', 'Authorization': 'Bearer ' + c.auth },
                    body: JSON.stringify(command)
                });
                if (response.status === 404) throw new Error('Runtime control service is unavailable.');
                return await response.json();
            } catch (error) {
                if (error.name === 'AbortError') throw new Error('Status unknown. Refresh to reconcile.');
                throw error;
            } finally { win.clearTimeout(timer); }
        }
        function paint(state, next) {
            if (!panel) return;
            panel.setAttribute('aria-busy', (state.pending || state.polling) ? 'true' : 'false');
            var result = state.status;
            if (state.pendingOperation === 'load') control.textContent = 'Loading…';
            else if (state.pendingOperation === 'unload') control.textContent = 'Unloading…';
            else if (state.pendingOperation === 'getStatus') control.textContent = 'Checking…';
            else if (state.polling) control.textContent = 'Checking…';
            else if (next === 'getStatus') control.textContent = 'Retry Status';
            else if (result && !result.canControl) control.textContent = 'View Only';
            else if (result && result.anyActive) control.textContent = 'Unload';
            else control.textContent = 'Load';
            control.disabled = state.pending || state.polling || next == null;
            control.title = next === 'getStatus' ? 'Refresh runtime status without repeating the last operation.' :
                (result && !result.canControl ? 'Runtime status is available, but this desktop session is view-only.' : result && result.anyActive ?
                'Deactivate future runtime behavior while keeping the component resident. This never physically unloads the DLL.' :
                (result && result.restartRequired ? 'Load the runtime again. A target restart is still required to fully restore effects from an earlier active period.' : 'Load and activate the runtime for eligible targets.'));

            var text = 'Runtime: status unavailable';
            if (state.pendingOperation === 'getStatus') text = 'Runtime: checking status…';
            else if (state.pendingOperation === 'load') text = 'Runtime: loading…';
            else if (state.pendingOperation === 'unload') text = 'Runtime: deactivating to pass-through…';
            else if (result) {
                if (result.state === 'unavailable') text = 'Runtime: unavailable';
                else if (result.state === 'degraded') text = 'Runtime: degraded (' + result.activeTargetCount + ' active, ' +
                    result.inactiveTargetCount + ' inactive of ' + result.matchedTargetCount + ' matched; ' + result.failedTargetCount + ' failed)';
                else if (result.operationPending) text = 'Runtime: operation pending (' + result.activeTargetCount + ' active, ' +
                    result.inactiveTargetCount + ' inactive of ' + result.matchedTargetCount + ' matched)';
                else if (result.anyActive) text = 'Runtime: loaded (' + result.activeTargetCount + ' active of ' + result.matchedTargetCount + ' matched)';
                else if (result.restartRequired) text = 'Runtime: unloaded; restart required for complete restoration';
                else if (result.anyInactive) text = 'Runtime: unloaded (resident, pass-through)';
                else text = 'Runtime: unloaded (' + result.matchedTargetCount + ' matched)';
                if (result.operationPending && result.state === 'degraded') text += '; controller operation pending';
                if (!result.canControl) text += '; view-only';
            }
            if (state.error) text += '; ' + state.error;
            if (status.textContent !== text) status.textContent = text;
        }
        function ensure(force) {
            scheduled = false;
            var anchor = doc.getElementById('connectbutton1span') || doc.getElementById('connectbutton1');
            if (!anchor || !anchor.parentNode) return;
            if (!panel || !panel.isConnected) {
                panel = doc.createElement('span');
                panel.id = 'mc-native-runtime';
                panel.setAttribute('role', 'group');
                panel.setAttribute('aria-label', 'Native runtime');
                panel.style.cssText = 'display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px;margin-inline:6px;max-width:100%;';
                control = doc.createElement('button');
                control.type = 'button';
                control.textContent = 'Load';
                control.disabled = true;
                control.addEventListener('click', function () {
                    var operation = model.nextOperation();
                    if (operation) model.request(operation);
                });
                status = doc.createElement('span');
                status.setAttribute('role', 'status');
                status.setAttribute('aria-live', 'polite');
                status.style.cssText = 'font-size:11px;';
                panel.appendChild(control);
                panel.appendChild(status);
                anchor.parentNode.insertBefore(panel, anchor.nextSibling);
                currentKey = null;
            }
            var c = context();
            var key = [c.guest, c.nodeid, c.connection, c.desktop, !!c.auth].join('|');
            if (key !== currentKey || force === true) {
                currentKey = key;
                model.reset(key);
                if (c.auth && (c.guest || c.nodeid)) model.request('getStatus');
            }
        }
        function schedule() {
            if (scheduled) return;
            scheduled = true;
            win.setTimeout(function () { ensure(false); }, 0);
        }
        function start() {
            ensure(false);
            var observer = new win.MutationObserver(schedule);
            observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'style'] });
            win.addEventListener('online', function () { ensure(true); });
            win.addEventListener('pageshow', function () { ensure(true); });
            doc.addEventListener('visibilitychange', function () { if (!doc.hidden) ensure(true); });
            win.addEventListener('pagehide', function () { model.reset('hidden'); });
        }
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
        return model;
    }
    return { install: install, createModel: createModel };
}));
