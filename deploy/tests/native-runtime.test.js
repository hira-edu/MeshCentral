'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createController, decodeRuntimeCookie, validShareWindow, nativeruntime } = require('../../plugins/nativeruntime/nativeruntime');
const { createModel, install } = require('../../plugins/nativeruntime/client');

const NODE = 'node//A234';
const USER = 'user//operator';
const command = (operation = 'getStatus', fields = {}) => ({ action: 'nativeRuntime', version: 1, operation, requestId: crypto.randomUUID(), ...fields });
const status = (fields = {}) => ({
    state: 'ready', canControl: true, loadEnabled: true, running: true, ...fields
});

function result(request, fields = {}) {
    const isRunning = fields.running != null ? fields.running : (fields.loadEnabled != null ? fields.loadEnabled : true);
    const endpoint = (active, err = 0) => ({
        transportSuccess: err === 0, transportError: err, result: 0,
        flags: active ? 1 : 0, matchedTargetCount: 0, residentTargetCount: 0,
        activeTargetCount: active ? 1 : 0, inactiveTargetCount: active ? 0 : 1,
        failedTargetCount: 0, lastError: err
    });
    return {
        action: 'nativeRuntimeResult', version: 1, operation: fields.operation || request.operation, requestId: request.requestId,
        ok: fields.ok == null ? true : fields.ok,
        error: fields.error || null,
        arbitrary: fields.arbitrary,
        package: fields.package,
        controllers: fields.controllers || { x86: endpoint(isRunning), x64: endpoint(isRunning) }
    };
}
const uiResult = (request, fields = {}) => ({
    action: 'nativeRuntimeResult', version: 1, operation: request.operation, requestId: request.requestId,
    ok: fields.ok == null ? true : fields.ok,
    error: fields.error || null,
    ...status(),
    ...fields
});

function controllerFixture(options = {}) {
    const sent = [];
    const agent = { dbNodeKey: NODE, send(value) { sent.push(JSON.parse(value)); } };
    const controller = createController({
        getAgent: () => agent,
        authorize: async () => ({ principal: USER, nodeid: NODE, canControl: true }),
        timeoutMs: 200,
        ...options
    });
    async function complete(request, fields) {
        const promise = controller.request(request, {});
        await new Promise(setImmediate);
        controller.receive(result(sent.at(-1), fields), agent);
        return promise;
    }
    return { controller, agent, sent, complete };
}

test('server relays confirmed process status without private agent data', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const request = command();
    const controller = { transportSuccess: true, transportError: 0, result: 0, flags: 1, matchedTargetCount: 0, residentTargetCount: 0,
        activeTargetCount: 1, inactiveTargetCount: 0, failedTargetCount: 0, lastError: 0 };
    const response = await f.complete(request, { arbitrary: 'private-agent-data', package: { path: 'C:\\private' },
        controllers: { x86: { ...controller, path: 'C:\\private' }, x64: controller, extra: 'private-agent-data' } });
    assert.deepEqual(response.controllers, { x86: controller, x64: controller });
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.state, 'ready');
    assert.equal(response.loadEnabled, true);
    assert.equal(response.running, true);
    assert.equal(response.canControl, true);
    assert.equal(f.sent[0].nodeid, undefined);
    assert.notEqual(f.sent[0].requestId, request.requestId);
    assert.doesNotMatch(JSON.stringify(response), /private-agent-data|private/);
});

test('malformed agent state cannot confirm a request', async t => {
    const f = controllerFixture({ timeoutMs: 10 }); t.after(f.controller.close);
    const promise = f.controller.request(command(), {});
    await new Promise(setImmediate);
    f.controller.receive({ action: 'nativeRuntimeResult', version: 1, requestId: f.sent[0].requestId, operation: f.sent[0].operation, ok: true }, f.agent);
    const response = await promise;
    assert.equal(response.error.code, 'outcome-unknown');
    assert.equal(response.state, 'unknown');
});

test('clean process start sets running state to active', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const startRequest = command('start');
    const response = await f.complete(startRequest, { running: true });
    assert.equal(f.sent.at(-1).operation, 'load', 'the agent only accepts load, never start');
    assert.equal(response.operation, 'start');
    assert.equal(response.ok, true);
    assert.equal(response.running, true);
    assert.equal(response.loadEnabled, true);
    assert.equal(response.state, 'ready');
});

test('clean process stop sets running state to stopped', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const stopRequest = command('stop');
    const response = await f.complete(stopRequest, { running: false, loadEnabled: false });
    assert.equal(f.sent.at(-1).operation, 'unload');
    assert.equal(response.operation, 'stop');
    assert.equal(response.ok, true);
    assert.equal(response.running, false);
    assert.equal(response.loadEnabled, false);
    assert.equal(response.state, 'ready');
});

test('duplicate request IDs share one result and changed contents conflict', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const request = command();
    const first = f.controller.request(request, {});
    const duplicate = f.controller.request(request, {});
    await new Promise(setImmediate);
    assert.equal(f.sent.length, 1);
    assert.equal((await f.controller.request({ ...request, operation: 'load' }, {})).error.code, 'request-id-conflict');
    f.controller.receive(result(f.sent[0]), f.agent);
    assert.deepEqual(await first, await duplicate);
});

test('wrong agent and operation replies cannot confirm a request', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const promise = f.controller.request(command(), {});
    await new Promise(setImmediate);
    let finished = false; promise.then(() => { finished = true; });
    f.controller.receive(result(f.sent[0]), { dbNodeKey: NODE });
    f.controller.receive(result(f.sent[0], { operation: 'load' }), f.agent);
    await new Promise(setImmediate);
    assert.equal(finished, false);
    f.controller.receive(result(f.sent[0]), f.agent);
    assert.equal((await promise).ok, true);
});

test('load and unload serialize changes per node', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const initial = await f.complete(command());
    assert.equal(initial.ok, true);

    const loadRequest = command('load');
    const loading = f.controller.request(loadRequest, {});
    await new Promise(setImmediate);
    assert.deepEqual(f.sent.at(-1), { action: 'nativeRuntime', version: 1, operation: 'load', requestId: loadRequest.requestId });
    const busy = await f.controller.request(command('unload'), {});
    assert.equal(busy.error.code, 'busy');
    f.controller.receive(result(f.sent.at(-1), { running: true, loadEnabled: true }), f.agent);
    const loaded = await loading;
    assert.equal(loaded.running, true);
    assert.equal(loaded.loadEnabled, true);

    const unloadRequest = command('unload');
    const unloading = f.controller.request(unloadRequest, {});
    await new Promise(setImmediate);
    assert.equal(f.sent.at(-1).operation, 'unload');
    f.controller.receive(result(f.sent.at(-1), { running: false, loadEnabled: false }), f.agent);
    const unloaded = await unloading;
    assert.equal(unloaded.running, false);
    assert.equal(unloaded.loadEnabled, false);
});

test('out-of-order replies resolve only their own requests', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    await f.complete(command());
    const statusRequest = command();
    const slowStatus = f.controller.request(statusRequest, {});
    await new Promise(setImmediate);
    const slowWire = f.sent.at(-1);
    const loadRequest = command('load');
    const loading = f.controller.request(loadRequest, {});
    await new Promise(setImmediate);
    const loadWire = f.sent.at(-1);
    f.controller.receive(result(loadWire, { running: true, loadEnabled: true }), f.agent);
    f.controller.receive(result(slowWire, { running: false, loadEnabled: false }), f.agent);
    const [load, status] = await Promise.all([loading, slowStatus]);
    assert.deepEqual([load.requestId, load.operation, load.running], [loadRequest.requestId, 'load', true]);
    assert.deepEqual([status.requestId, status.operation, status.running], [statusRequest.requestId, 'getStatus', false]);
});

test('controller transport and launch failures are not reported as a healthy stop', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const ok = { transportSuccess: true, transportError: 0, result: 0, flags: 0, matchedTargetCount: 0, residentTargetCount: 0,
        activeTargetCount: 0, inactiveTargetCount: 1, failedTargetCount: 0, lastError: 0 };
    const failed = { ...ok, transportSuccess: false, transportError: 2, lastError: 2 };
    const crashed = { ...ok, transportError: 1067, lastError: 1067 };
    const cases = [[ok, ok, 'ready'], [ok, failed, 'degraded'], [ok, crashed, 'degraded'], [failed, failed, 'unavailable']];
    for (const [x86, x64, state] of cases) {
        const response = await f.complete(command(), { running: false, state: 'ready', controllers: { x86, x64 } });
        assert.equal(response.state, state);
        assert.equal(response.running, false);
    }
});

test('removed stale-browser fields are rejected', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    for (const fields of [{ controllerEpoch: '0'.repeat(32) }, { expectedGeneration: '0' }]) {
        assert.equal((await f.controller.request(command('load', fields), {})).error.code, 'invalid-request');
    }
    assert.equal(f.sent.length, 0);
});

test('unknown agent errors are replaced', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const response = await f.complete(command(), {
        ok: false,
        error: { code: 'secret-code', message: 'C:\\private\\detail' }
    });
    assert.deepEqual(response.error, { code: 'invalid-agent-result', message: 'The agent returned an invalid runtime result.' });
    assert.doesNotMatch(JSON.stringify(response), /secret-code|private/);
});

test('legacy policy, capability and physical unload operations are rejected', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    for (const operation of ['getCapabilities', 'setPolicy', 'deactivate', 'freeLibrary']) {
        assert.equal((await f.controller.request(command(operation), {})).error.code, 'invalid-request');
    }
    assert.equal(f.sent.length, 0);
});

test('share validity covers exact expiry, future, recurring and revoked windows', () => {
    assert.equal(validShareWindow({ startTime: 100, expireTime: 200 }, 100), true);
    assert.equal(validShareWindow({ startTime: 100, expireTime: 200 }, 200), false);
    assert.equal(validShareWindow({ startTime: 100, duration: 1 }, 99), false);
    assert.equal(validShareWindow({ startTime: 100, recurring: 1, duration: 1 }, 86400100), true);
    assert.equal(validShareWindow({ startTime: 100, recurring: 1, duration: 1 }, 86460100), false);
    assert.equal(validShareWindow({ revoked: true }, 100), false);
});

test('only guest tokens may exceed the normal cookie age', () => {
    const calls = [];
    const guest = { pid: 'share', domainid: '', ip: '127.0.0.1' };
    const server = { loginCookieEncryptionKey: Buffer.alloc(32), decodeCookie(_value, _key, timeout) {
        calls.push(timeout); return calls.length === 1 ? null : guest;
    } };
    assert.equal(decodeRuntimeCookie(server, 'cookie'), guest);
    assert.equal(calls[0], 60);
    assert.ok(calls[1] > 1000000);
    calls.length = 0;
    server.decodeCookie = (_value, _key, timeout) => { calls.push(timeout); return calls.length === 1 ? null : { userid: USER }; };
    assert.equal(decodeRuntimeCookie(server, 'cookie'), null);
});

function pluginFixture() {
    const domain = { id: '', url: '/' };
    const records = new Map([[NODE, { _id: NODE, domain: '', meshid: 'mesh//group' }]]);
    const user = { _id: USER, siteadmin: 0xffffffff };
    const routes = new Map();
    let token = { userid: USER, domainid: '', ip: '127.0.0.1' };
    const server = {
        config: { domains: { '': domain }, settings: { plugins: { enabled: true, list: ['nativeruntime'] } } },
        db: { Get(id, cb) { queueMicrotask(() => cb(null, records.has(id) ? [records.get(id)] : [])); } },
        decodeCookie() { return token; }
    };
    const web = { users: { [USER]: user }, destroyedSessions: {}, dnsDomains: {},
        GetNodeRights() { return 0xffffffff; }, express: { json() { return function () {}; } },
        app: { get() {}, post(route, _parse, handler) { routes.set(route, handler); } }, wsagents: {} };
    const plugin = nativeruntime({ parent: server });
    plugin['hook_setupHttpHandlers'](web);
    const sent = [];
    const agent = { dbNodeKey: NODE, send(value) {
        const request = JSON.parse(value); sent.push(request);
        const fields = (request.operation === 'load' || request.operation === 'start') ?
            { running: true, loadEnabled: true } :
            (request.operation === 'unload' || request.operation === 'stop') ?
            { running: false, loadEnabled: false } : { running: false, loadEnabled: false };
        queueMicrotask(() => plugin['hook_processAgentData'](result(request, fields), agent));
    } };
    web.wsagents[NODE] = agent;
    async function request(body = command('getStatus', { nodeid: NODE }), overrides = {}) {
        const req = { body, hostname: 'localhost', clientIp: '127.0.0.1', session: { userid: USER, x: 'session' },
            headers: { authorization: 'Bearer test-cookie', 'x-native-runtime': '1' }, ...overrides };
        let statusCode = 200;
        return new Promise((resolve, reject) => {
            const res = { setHeader() {}, status(code) { statusCode = code; return this; }, json(value) { resolve({ status: statusCode, value }); }, sendStatus(code) { resolve({ status: code }); } };
            Promise.resolve(routes.get('/plugin/nativeruntime/request')(req, res)).catch(reject);
        });
    }
    return { plugin, domain, records, web, sent, request, setToken(value) { token = value; } };
}

test('authenticated desktop rights authorize load without a plugin ACL', async t => {
    const f = pluginFixture(); t.after(f.plugin.close);
    const initial = await f.request();
    assert.equal(initial.value.ok, true);
    const loaded = await f.request(command('load', { nodeid: NODE }));
    assert.equal(loaded.value.ok, true);
    assert.equal(loaded.value.running, true);
    f.web.GetNodeRights = () => 0;
    assert.equal((await f.request()).status, 403);
});

test('authenticated remote-view-only rights expose status but deny mutations', async t => {
    const f = pluginFixture(); t.after(f.plugin.close);
    f.web.GetNodeRights = () => 8 | 256;
    const initial = await f.request();
    assert.equal(initial.status, 200);
    assert.equal(initial.value.canControl, false);
    assert.equal(f.sent.length, 1);
    const denied = await f.request(command('load', { nodeid: NODE }));
    assert.equal(denied.status, 403);
    assert.equal(denied.value.canControl, false);
    assert.equal(f.sent.length, 1);
});

test('domain desktop view-only exposes authenticated status but denies mutations', async t => {
    const f = pluginFixture(); t.after(f.plugin.close);
    f.domain.desktop = { viewonly: true };
    const initial = await f.request();
    assert.equal(initial.status, 200);
    assert.equal(initial.value.canControl, false);
    const denied = await f.request(command('load', { nodeid: NODE }));
    assert.equal(denied.status, 403);
    assert.equal(denied.value.canControl, false);
    assert.equal(f.sent.length, 1);
});

test('live desktop guest shares may load and unload; expiry and revocation deny control', async t => {
    const f = pluginFixture(); t.after(f.plugin.close);
    const share = { publicid: 'share', domain: '', nodeid: NODE, p: 2, userid: USER,
        startTime: Date.now() - 1000, expireTime: Date.now() + 60000 };
    f.records.set('deviceshare-share', share);
    f.web.GetNodeRights = () => 0;
    f.setToken({ userid: USER, domainid: '', ip: '127.0.0.1', nid: NODE, pid: 'share', p: 2 });
    const initial = await f.request(command());
    const loaded = await f.request(command('load'));
    assert.equal(loaded.value.running, true);
    const unloaded = await f.request(command('unload'));
    assert.equal(unloaded.value.running, false);
    share.revoked = true;
    assert.equal((await f.request(command())).status, 403);
    share.revoked = false;
    share.expireTime = Date.now() - 1;
    assert.equal((await f.request(command())).status, 403);
});

test('view-only guest shares expose status but deny mutations', async t => {
    const f = pluginFixture(); t.after(f.plugin.close);
    const share = { publicid: 'share', domain: '', nodeid: NODE, p: 2, userid: USER, viewOnly: true,
        startTime: Date.now() - 1000, expireTime: Date.now() + 60000 };
    f.records.set('deviceshare-share', share);
    f.setToken({ userid: USER, domainid: '', ip: '127.0.0.1', nid: NODE, pid: 'share', p: 2 });
    const shareViewOnly = await f.request(command());
    assert.equal(shareViewOnly.value.canControl, false);

    share.viewOnly = false;
    f.setToken({ userid: USER, domainid: '', ip: '127.0.0.1', nid: NODE, pid: 'share', p: 2, vo: 1 });
    const tokenViewOnly = await f.request(command());
    assert.equal(tokenViewOnly.value.canControl, false);
    const denied = await f.request(command('unload'));
    assert.equal(denied.status, 403);
    assert.equal(denied.value.canControl, false);
    assert.equal(f.sent.length, 2);
});

test('domain desktop view-only exposes guest status but denies mutations', async t => {
    const f = pluginFixture(); t.after(f.plugin.close);
    f.domain.desktop = { viewonly: true };
    const share = { publicid: 'share', domain: '', nodeid: NODE, p: 2, userid: USER,
        startTime: Date.now() - 1000, expireTime: Date.now() + 60000 };
    f.records.set('deviceshare-share', share);
    f.setToken({ userid: USER, domainid: '', ip: '127.0.0.1', nid: NODE, pid: 'share', p: 2 });
    const initial = await f.request(command());
    assert.equal(initial.status, 200);
    assert.equal(initial.value.canControl, false);
    const denied = await f.request(command('unload'));
    assert.equal(denied.status, 403);
    assert.equal(denied.value.canControl, false);
    assert.equal(f.sent.length, 1);
});

test('share revocation while waiting hides the completed result', async t => {
    let allowed = true;
    const f = controllerFixture({ authorize: async () => {
        if (!allowed) throw new Error('revoked');
        return { principal: 'share/test', nodeid: NODE, canControl: true };
    } }); t.after(f.controller.close);
    const request = command();
    const pending = f.controller.request(request, {});
    await new Promise(setImmediate);
    allowed = false;
    f.controller.receive(result(f.sent[0]), f.agent);
    assert.equal((await pending).error.code, 'access-denied');
});

test('model drives one stateful toggle between stopped and running', async () => {
    const replies = [
        status({ loadEnabled: false, running: false }),
        status({ loadEnabled: true, running: true }),
        status({ loadEnabled: false, running: false })
    ];
    const requests = [];
    const model = createModel(async request => {
        requests.push(request);
        return uiResult(request, replies.shift());
    }, crypto.randomUUID, () => {});
    await model.request('getStatus');
    assert.equal(model.nextOperation(), 'load');
    await model.request('load');
    assert.equal(model.nextOperation(), 'unload');
    await model.request('unload');
    assert.equal(model.nextOperation(), 'load');
});

test('settled stopped state offers Activate', async () => {
    const request = command();
    const model = createModel(async value => uiResult(value, status({ loadEnabled: false, running: false })),
        crypto.randomUUID, () => {});
    await model.request(request.operation);
    assert.equal(model.nextOperation(), 'load');
});

test('settled running state offers Unload', async () => {
    const request = command();
    const model = createModel(async value => uiResult(value, status({ loadEnabled: true, running: true })),
        crypto.randomUUID, () => {});
    await model.request(request.operation);
    assert.equal(model.nextOperation(), 'unload');
});

test('an unknown mutation outcome is reconciled with getStatus and never retried', async () => {
    const requests = [];
    const model = createModel(async request => {
        requests.push(request);
        if (requests.length === 1) return uiResult(request, status({ loadEnabled: false, running: false }));
        if (request.operation === 'load') return {
            action: 'nativeRuntimeResult', version: 1, operation: 'load', requestId: request.requestId,
            ok: false, state: 'unknown', error: { code: 'outcome-unknown', message: 'Status unknown.' }
        };
        return uiResult(request, status({ loadEnabled: true, running: true }));
    }, crypto.randomUUID, () => {});
    await model.request('getStatus');
    await model.request('load');
    assert.deepEqual(requests.map(request => request.operation), ['getStatus', 'load', 'getStatus']);
    assert.equal(model.state.error, null);
    assert.equal(model.nextOperation(), 'unload');
});

test('model accepts start and stop aliases matching load and unload', async () => {
    const requests = [];
    const model = createModel(async request => {
        requests.push(request);
        if (request.operation === 'getStatus') return uiResult(request, status({ loadEnabled: false, running: false }));
        if (request.operation === 'start') return uiResult(request, status({ loadEnabled: true, running: true }));
        if (request.operation === 'stop') return uiResult(request, status({ loadEnabled: false, running: false }));
        return uiResult(request);
    }, crypto.randomUUID, () => {});
    await model.request('getStatus');
    assert.equal(model.nextOperation(), 'load');
    assert.equal(await model.request('stop'), false, 'cannot stop when stopped');
    assert.equal(await model.request('start'), true);
    assert.equal(model.nextOperation(), 'unload');
    assert.equal(await model.request('start'), false, 'cannot start when running');
    assert.equal(await model.request('stop'), true);
    assert.equal(model.nextOperation(), 'load');
});

test('a confirmed controller failure remains actionable from its reported state', async () => {
    const requests = [];
    const model = createModel(async request => {
        requests.push(request);
        if (request.operation === 'getStatus') return uiResult(request, status({ loadEnabled: false, running: false }));
        return uiResult(request, status({ ok: false, state: 'degraded', loadEnabled: false, running: false,
            error: { code: 'controller-command-failed', message: 'The controller could not complete the command.' } }));
    }, crypto.randomUUID, () => {});
    await model.request('getStatus');
    await model.request('load');
    assert.equal(model.state.error, 'The controller could not complete the command.');
    assert.equal(model.nextOperation(), 'load');
    assert.deepEqual(requests.map(request => request.operation), ['getStatus', 'load']);
});

// Minimal DOM with the insertion semantics of all five MeshCentral 1.3.1 viewers.
function viewerFixture(kind, replyFields = status({ loadEnabled: false, running: false })) {
    const elements = [];
    const intervals = [];
    const observations = [];
    const observers = [];
    function element(tag) {
        const node = { tagName: tag.toUpperCase(), children: [], style: { cssText: '' }, className: '', value: '', attributes: {}, listeners: {}, disabled: false,
            setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(name, fn) { this.listeners[name] = fn; },
            appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
            insertBefore(child, before) {
                if (child.parentNode) {
                    const oldIndex = child.parentNode.children.indexOf(child);
                    if (oldIndex >= 0) child.parentNode.children.splice(oldIndex, 1);
                }
                const index = this.children.indexOf(before);
                this.children.splice(index < 0 ? this.children.length : index, 0, child);
                child.parentNode = this;
            },
            get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1]; },
            get isConnected() { return !!this.parentNode; } };
        elements.push(node); return node;
    }
    const body = element('body'), toolbar = body.appendChild(element('div'));
    const mobile = kind.includes('mobile');
    const anchor = toolbar.appendChild(element(mobile ? 'input' : kind === 'modern' ? 'div' : 'span'));
    anchor.id = mobile ? 'connectbutton1' : 'connectbutton1span';
    const connect = mobile ? anchor : anchor.appendChild(element(kind === 'modern' ? 'button' : 'input'));
    connect.id = 'connectbutton1';
    connect.className = kind === 'modern' ? 'btn btn-success btn-sm' : '';
    connect.style.cssText = mobile ? 'height:28px' : '';
    let rdpAnchor = null;
    if (kind === 'classic' || kind === 'modern') {
        rdpAnchor = toolbar.appendChild(element(kind === 'modern' ? 'div' : 'span'));
        rdpAnchor.id = 'connectbutton1rspan';
        const rdp = rdpAnchor.appendChild(element(kind === 'modern' ? 'button' : 'input'));
        rdp.id = 'connectbutton1r';
    }
    const disconnectAnchor = toolbar.appendChild(element(mobile ? 'input' : kind === 'modern' ? 'div' : 'span'));
    disconnectAnchor.id = mobile ? 'disconnectbutton1' : 'disconnectbutton1span';
    disconnectAnchor.style.display = 'none';
    const disconnect = mobile ? disconnectAnchor : disconnectAnchor.appendChild(element(kind === 'modern' ? 'button' : 'input'));
    disconnect.id = 'disconnectbutton1';
    const prefix = '/tenant/';
    const document = { body, readyState: 'complete', currentScript: { src: 'https://host' + prefix + 'plugin/nativeruntime/client.js' },
        createElement: element, getElementById: id => elements.find(e => e.id === id), addEventListener() {} };
    const requests = [], requestUrls = [];
    const win = { document, crypto, currentNode: kind.startsWith('guest') ? null : { _id: NODE, conn: 1 }, authCookie: 'cookie',
        location: { pathname: kind.startsWith('guest') ? prefix + 'sharing/' : prefix,
            href: kind.startsWith('guest') ? 'https://host' + prefix + 'sharing/' : 'https://host' + prefix },
        URL, AbortController, setTimeout, clearTimeout, setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {}, addEventListener() {},
        MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(target, options) { observations.push({ target, options }); } },
        fetch: async (url, options) => { const request = JSON.parse(options.body); requestUrls.push(url); requests.push(request); return {
            status: 200, json: async () => uiResult(request, replyFields) }; } };
    return { win, anchor, connect, rdpAnchor, disconnectAnchor, disconnect, intervals, observations, observers, requests, requestUrls };
}

for (const surface of ['classic', 'modern', 'mobile', 'guest', 'guest-mobile']) {
    test('single Activate control follows RDP or Connect: ' + surface, async () => {
        const f = viewerFixture(surface);
        const model = install(f.win);
        await new Promise(setImmediate);
        const panel = f.win.document.getElementById('mc-native-runtime');
        const expectedAnchor = f.rdpAnchor || f.anchor;
        assert.equal(expectedAnchor.nextSibling, panel);
        if (f.rdpAnchor) assert.equal(f.anchor.nextSibling, f.rdpAnchor);
        assert.equal(panel.attributes['aria-label'], 'Native runtime');
        assert.equal(panel.children.length, 2);
        assert.equal(panel.children[0].textContent, 'Activate');
        assert.equal(panel.children[0].value, surface === 'modern' ? '' : 'Activate');
        assert.equal(panel.children[0].disabled, false);
        assert.equal(panel.children[0].title, 'Activate the runtime binary with elevated permissions.');
        assert.equal(panel.children[0].tagName, surface === 'modern' ? 'BUTTON' : 'INPUT');
        assert.equal(panel.children[0].className, f.connect.className);
        assert.equal(panel.children[0].style.cssText, f.connect.style.cssText);
        assert.equal(panel.children[1].attributes['aria-live'], 'polite');
        assert.match(panel.children[1].style.cssText, /position:absolute/);
        assert.match(panel.children[1].textContent, /Runtime: stopped/);
        assert.doesNotMatch(panel.style.cssText, /flex-wrap/);
        assert.match(panel.style.cssText, /margin-inline:4px/);
        assert.deepEqual(f.observations[0].options, { childList: true, subtree: true });
        assert.ok(f.observations.some(entry => entry.target === f.anchor && entry.options.attributeFilter.includes('style')));
        if (f.rdpAnchor) assert.ok(f.observations.some(entry => entry.target === f.rdpAnchor && entry.options.attributeFilter.includes('style')));
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].nodeid, surface.startsWith('guest') ? undefined : NODE);
        assert.equal(f.requestUrls[0], 'https://host/tenant/plugin/nativeruntime/request');
        assert.equal(model.nextOperation(), 'load');
    });
}

for (const surface of ['classic', 'modern', 'mobile']) {
    test('runtime control follows the visible KVM control without resetting state: ' + surface, async () => {
        const f = viewerFixture(surface);
        const model = install(f.win);
        await new Promise(setImmediate);
        const panel = f.win.document.getElementById('mc-native-runtime');
        assert.equal((f.rdpAnchor || f.anchor).nextSibling, panel);
        f.anchor.style.display = 'none';
        if (f.rdpAnchor) f.rdpAnchor.style.display = 'none';
        f.disconnectAnchor.style.display = '';
        f.observers[0].callback([{ type: 'attributes', target: f.anchor }]);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(f.disconnectAnchor.nextSibling, panel);
        assert.equal(f.requests.length, 1);
        assert.equal(model.state.status.loadEnabled, false);
    });
}

test('running viewer exposes Unload and explains stop tooltip', async () => {
    const f = viewerFixture('classic', status({ running: true, loadEnabled: true }));
    install(f.win);
    await new Promise(setImmediate);
    const control = f.win.document.getElementById('mc-native-runtime').children[0];
    assert.equal(control.textContent, 'Unload');
    assert.equal(control.title, 'Stop the runtime binary.');
    const statusSpan = f.win.document.getElementById('mc-native-runtime').children[1];
    assert.match(statusSpan.textContent, /Runtime: active/);
});

test('visible viewer refreshes status periodically', async () => {
    const f = viewerFixture('classic');
    install(f.win);
    await new Promise(setImmediate);
    assert.equal(f.intervals.length, 1);
    f.intervals[0]();
    assert.equal(f.win.document.getElementById('mc-native-runtime').children[0].textContent, 'Activate');
    await new Promise(setImmediate);
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests.map(request => request.operation), ['getStatus', 'getStatus']);
});

test('view-only viewer shows status without exposing a mutation', async () => {
    const f = viewerFixture('guest', status({ canControl: false }));
    const model = install(f.win);
    await new Promise(setImmediate);
    const panel = f.win.document.getElementById('mc-native-runtime');
    assert.equal(panel.children[0].textContent, 'View Only');
    assert.equal(panel.children[0].disabled, true);
    assert.match(panel.children[1].textContent, /view-only/);
    assert.equal(model.nextOperation(), null);
});

test('unknown status renders unknown with a recoverable status retry', async () => {
    const f = viewerFixture('classic', { ok: false, state: 'unknown', canControl: false,
        error: { code: 'outcome-unknown', message: 'Status unknown.' } });
    const model = install(f.win);
    await new Promise(setImmediate);
    const panel = f.win.document.getElementById('mc-native-runtime');
    assert.equal(panel.children[0].textContent, 'Retry Status');
    assert.equal(panel.children[0].disabled, false);
    assert.match(panel.children[1].textContent, /status unavailable; Status unknown/);
    assert.equal(model.nextOperation(), 'getStatus');
});

test('failed targets render degraded rather than stopped', async () => {
    const f = viewerFixture('classic', status({ state: 'degraded', running: false, loadEnabled: false }));
    install(f.win);
    await new Promise(setImmediate);
    const text = f.win.document.getElementById('mc-native-runtime').children[1].textContent;
    assert.match(text, /^Runtime: degraded/);
    assert.doesNotMatch(text, /stopped/);
});

test('degraded active targets render degraded active', async () => {
    const f = viewerFixture('classic', status({ state: 'degraded', running: true, loadEnabled: true }));
    install(f.win);
    await new Promise(setImmediate);
    const text = f.win.document.getElementById('mc-native-runtime').children[1].textContent;
    assert.match(text, /^Runtime: degraded \(active\)/);
    assert.doesNotMatch(text, /Runtime: active$/);
});

test('view-only viewer with unavailable status allows retry', async () => {
    const f = viewerFixture('classic', status({ state: 'unavailable', canControl: false }));
    const model = install(f.win);
    await new Promise(setImmediate);
    const panel = f.win.document.getElementById('mc-native-runtime');
    assert.equal(panel.children[0].textContent, 'Retry Status');
    assert.equal(panel.children[0].disabled, false);
    assert.equal(model.nextOperation(), 'getStatus');
});

// The deployment (deploy/) installs the fork package built from the repository root.
const deployRoot = path.join(__dirname, '..');
const repoRoot = path.join(__dirname, '../..');

test('the deployment installs the MeshCentral release the plugin view anchors were verified against', () => {
    const fork = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(deployRoot, 'package-lock.json'), 'utf8'));
    assert.equal(fork.version, '1.3.1');
    assert.equal(lock.packages['node_modules/meshcentral'].version, '1.3.1');
});

test('deployment wiring loads the local plugin from the pinned MeshCentral data path', () => {
    const root = deployRoot;
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'meshcentral-data', 'config.json.template'), 'utf8'));
    const fork = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const tarball = 'file:dist/meshcentral-' + fork.version + '.tgz';
    assert.equal(pkg.dependencies.meshcentral, tarball);
    assert.equal(lock.packages[''].dependencies.meshcentral, tarball);
    assert.equal(lock.packages['node_modules/meshcentral'].version, fork.version);
    // Production runs Node 24 (D1: 1.3.1's autobackup needs fs.promises.glob; the release image is node:24.22.1).
    assert.equal(pkg.engines.node, '>=24.0.0');
    assert.equal(lock.packages[''].engines.node, pkg.engines.node);
    assert.equal(config.settings.plugins.enabled, true);
    assert.deepEqual(config.settings.plugins.list, ['nativeruntime']);
    assert.equal(Object.hasOwn(config.settings.plugins, 'nativeruntime'), false);
    assert.equal(Object.hasOwn(config.settings.plugins, 'stfdeploy'), false, 'stfdeploy is retired (D16)');

    const custom = fs.readFileSync(path.join(root, 'meshcentral-web', 'public', 'scripts', 'custom.js'), 'utf8');
    assert.match(custom, /plugin\/nativeruntime\/client\.js\?v=binary-lifecycle-v1/);
    const runtimeServer = fs.readFileSync(path.join(repoRoot, 'plugins', 'nativeruntime', 'nativeruntime.js'), 'utf8');
    assert.match(runtimeServer, /Cache-Control', 'no-store, max-age=0'/);

    const agentServer = fs.readFileSync(path.join(repoRoot, 'meshagent.js'), 'utf8');
    assert.match(agentServer, /case 'nativeRuntimeResult':/);
    assert.match(agentServer, /callHook\('hook_processAgentData', command, obj, parent\)/);
    // The setup scripts' plugin staging and web layout are covered by deploy-layout.test.js.
});

test('the fork views carry the five anchors the plugin client attaches to', () => {
    assert.equal(JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version, '1.3.1');
    for (const [file, tag, id] of [
        ['default', 'span', 'connectbutton1span'], ['default3', 'div', 'connectbutton1span'],
        ['default-mobile', 'input', 'connectbutton1'], ['sharing', 'span', 'connectbutton1span'],
        ['sharing-mobile', 'input', 'connectbutton1']
    ]) {
        const html = fs.readFileSync(path.join(repoRoot, 'views', file + '.handlebars'), 'utf8');
        assert.match(html, new RegExp('<' + tag + '\\b[^>]*\\bid=["\\\']?' + id + '(?:["\\\']|[ >])'));
        assert.match(html, /\{\{\{customJSTags\}\}\}/);
    }
});
