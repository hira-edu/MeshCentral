'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createController, decodeRuntimeCookie, validShareWindow, nativeruntime } = require('../plugins/nativeruntime/nativeruntime');
const { createModel, install } = require('../plugins/nativeruntime/client');

const EPOCH = 'a'.repeat(32);
const NODE = 'node//A234';
const USER = 'user//operator';
const command = (operation = 'getStatus', fields = {}) => ({ action: 'nativeRuntime', version: 1, operation, requestId: crypto.randomUUID(), ...fields });
const status = (fields = {}) => ({
    state: 'ready', canControl: true, loadEnabled: true, operationPending: false,
    anyResident: true, anyActive: false, anyInactive: true, restartRequired: false,
    matchedTargetCount: 1, residentTargetCount: 1, activeTargetCount: 0,
    inactiveTargetCount: 1, failedTargetCount: 0, ...fields
});
function endpoint(fields = {}) {
    const snapshot = status(fields);
    let flags = 0;
    if (snapshot.loadEnabled) flags |= 0x1;
    if (snapshot.operationPending) flags |= 0x2;
    if (snapshot.anyResident) flags |= 0x4;
    if (snapshot.anyActive) flags |= 0x8;
    if (snapshot.anyInactive) flags |= 0x10;
    if (snapshot.state === 'degraded') flags |= 0x20;
    if (snapshot.restartRequired) flags |= 0x40;
    return {
        transportSuccess: true, transportError: 0, result: 0, flags,
        matchedTargetCount: snapshot.matchedTargetCount, residentTargetCount: snapshot.residentTargetCount,
        activeTargetCount: snapshot.activeTargetCount, inactiveTargetCount: snapshot.inactiveTargetCount,
        failedTargetCount: snapshot.failedTargetCount, lastError: 0
    };
}
function result(request, fields = {}) {
    const emptyArchitecture = endpoint({ anyResident: false, anyActive: false, anyInactive: false,
        matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 });
    return {
        action: 'nativeRuntimeResult', version: 1, operation: fields.operation || request.operation, requestId: request.requestId,
        ok: fields.ok == null ? true : fields.ok,
        controllers: fields.controllers || { x86: endpoint(fields), x64: emptyArchitecture },
        error: fields.error || null,
        arbitrary: fields.arbitrary,
        package: fields.package
    };
}
const uiResult = (request, fields = {}) => ({
    action: 'nativeRuntimeResult', version: 1, operation: request.operation, requestId: request.requestId,
    ok: true, error: null, ...status(), ...fields
});

function controllerFixture(options = {}) {
    const sent = [];
    const agent = { dbNodeKey: NODE, send(value) { sent.push(JSON.parse(value)); } };
    const controller = createController({
        getAgent: () => agent,
        authorize: async () => ({ principal: USER, nodeid: NODE, canControl: true }),
        controllerEpoch: EPOCH,
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

test('server relays only confirmed controller state and adds relay epoch/generation', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const request = command();
    const response = await f.complete(request, { arbitrary: 'private-agent-data', package: { path: 'C:\\private' } });
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.state, 'ready');
    assert.equal(response.anyInactive, true);
    assert.equal(response.anyActive, false);
    assert.equal(response.canControl, true);
    assert.equal(response.controllerEpoch, EPOCH);
    assert.equal(response.generation, '0');
    assert.equal(f.sent[0].nodeid, undefined);
    assert.equal(f.sent[0].controllerEpoch, undefined);
    assert.equal(f.sent[0].expectedGeneration, undefined);
    assert.notEqual(f.sent[0].requestId, request.requestId);
    assert.doesNotMatch(JSON.stringify(response), /private-agent-data|private|capabilities|policy/);
});

test('malformed or internally inconsistent agent state cannot confirm a request', async t => {
    const f = controllerFixture({ timeoutMs: 10 }); t.after(f.controller.close);
    const promise = f.controller.request(command(), {});
    await new Promise(setImmediate);
    const malformed = endpoint();
    malformed.flags |= 0x8;
    f.controller.receive(result(f.sent[0], { controllers: { x86: malformed, x64: endpoint({ anyResident: false, anyActive: false, anyInactive: false,
        matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 }) } }), f.agent);
    const response = await promise;
    assert.equal(response.error.code, 'outcome-unknown');
    assert.equal(response.state, 'unknown');
});

test('controller result is restricted to the five-value protocol enum', async t => {
    const f = controllerFixture({ timeoutMs: 10 }); t.after(f.controller.close);
    const promise = f.controller.request(command(), {});
    await new Promise(setImmediate);
    const invalid = endpoint();
    invalid.result = 5;
    f.controller.receive(result(f.sent[0], { ok: false, controllers: {
        x86: invalid,
        x64: endpoint({ anyResident: false, anyActive: false, anyInactive: false,
            matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 })
    } }), f.agent);
    assert.equal((await promise).error.code, 'outcome-unknown');
});

test('controller persistence failure remains a degraded command failure', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const failed = endpoint();
    failed.result = 4;
    failed.lastError = 5;
    const response = await f.complete(command(), { ok: false, controllers: {
        x86: failed,
        x64: endpoint({ anyResident: false, anyActive: false, anyInactive: false,
            matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 })
    }, error: { code: 'controller-command-failed' } });
    assert.equal(response.state, 'degraded');
    assert.equal(response.controllers.x86.result, 4);
    assert.equal(response.controllers.x86.lastError, 5);
    assert.equal(response.error.code, 'controller-command-failed');
});

test('agent ok must agree with both confirmed controller results', async t => {
    const f = controllerFixture({ timeoutMs: 10 }); t.after(f.controller.close);
    const promise = f.controller.request(command(), {});
    await new Promise(setImmediate);
    const failed = endpoint();
    failed.result = 1;
    f.controller.receive(result(f.sent[0], { ok: true, controllers: {
        x86: failed,
        x64: endpoint({ anyResident: false, anyActive: false, anyInactive: false,
            matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 })
    } }), f.agent);
    const response = await promise;
    assert.equal(response.error.code, 'outcome-unknown');
    assert.equal(response.state, 'unknown');
});

test('a controller reconciliation error produces degraded state', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const warning = endpoint();
    warning.lastError = 193;
    const response = await f.complete(command(), { controllers: {
        x86: warning,
        x64: endpoint({ anyResident: false, anyActive: false, anyInactive: false,
            matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 })
    } });
    assert.equal(response.ok, true);
    assert.equal(response.state, 'degraded');
    assert.equal(response.controllers.x86.lastError, 193);
});

test('architecture disagreement on load-enabled desired state is degraded', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const response = await f.complete(command(), { controllers: {
        x86: endpoint({ loadEnabled: true }),
        x64: endpoint({ loadEnabled: false, anyResident: false, anyActive: false, anyInactive: false,
            matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 })
    } });
    assert.equal(response.ok, true);
    assert.equal(response.state, 'degraded');
    assert.equal(response.loadEnabled, true);
});

test('controller-wide enumeration failure may exceed the matched target count', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const failedSnapshot = endpoint({ anyResident: false, anyActive: false, anyInactive: false,
        matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0,
        failedTargetCount: 1 });
    const response = await f.complete(command(), { controllers: {
        x86: failedSnapshot,
        x64: endpoint({ anyResident: false, anyActive: false, anyInactive: false,
            matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 })
    } });
    assert.equal(response.ok, true);
    assert.equal(response.state, 'degraded');
    assert.equal(response.matchedTargetCount, 0);
    assert.equal(response.failedTargetCount, 1);
});

test('duplicate request IDs share one result and changed contents conflict', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const request = command();
    const first = f.controller.request(request, {});
    const duplicate = f.controller.request(request, {});
    await new Promise(setImmediate);
    assert.equal(f.sent.length, 1);
    assert.equal((await f.controller.request({ ...request, operation: 'load', controllerEpoch: EPOCH, expectedGeneration: '0' }, {})).error.code, 'request-id-conflict');
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

test('load and unload require fresh state and serialize changes per node', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const initial = await f.complete(command());
    assert.equal(initial.generation, '0');

    const loadRequest = command('load', { controllerEpoch: initial.controllerEpoch, expectedGeneration: initial.generation });
    const loading = f.controller.request(loadRequest, {});
    await new Promise(setImmediate);
    assert.deepEqual(f.sent.at(-1), { action: 'nativeRuntime', version: 1, operation: 'load', requestId: loadRequest.requestId });
    const busy = await f.controller.request(command('unload', { controllerEpoch: EPOCH, expectedGeneration: '0' }), {});
    assert.equal(busy.error.code, 'busy');
    f.controller.receive(result(f.sent.at(-1), status({ anyActive: true, anyInactive: false, activeTargetCount: 1, inactiveTargetCount: 0 })), f.agent);
    const loaded = await loading;
    assert.equal(loaded.generation, '1');
    assert.equal(loaded.anyActive, true);

    assert.equal((await f.controller.request(command('unload', { controllerEpoch: EPOCH, expectedGeneration: '0' }), {})).error.code, 'stale-generation');
    const unloadRequest = command('unload', { controllerEpoch: EPOCH, expectedGeneration: '1' });
    const unloaded = await f.complete(unloadRequest, status({ loadEnabled: false, restartRequired: true }));
    assert.equal(unloaded.generation, '2');
    assert.equal(unloaded.restartRequired, true);
    assert.equal(unloaded.anyInactive, true);
});

test('an older in-flight status cannot overwrite a confirmed mutation', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    await f.complete(command());
    const slowStatus = f.controller.request(command(), {});
    await new Promise(setImmediate);
    const slowWire = f.sent.at(-1);
    const loadRequest = command('load', { controllerEpoch: EPOCH, expectedGeneration: '0' });
    const loading = f.controller.request(loadRequest, {});
    await new Promise(setImmediate);
    const loadWire = f.sent.at(-1);
    f.controller.receive(result(loadWire, status({ anyActive: true, anyInactive: false, activeTargetCount: 1, inactiveTargetCount: 0 })), f.agent);
    assert.equal((await loading).generation, '1');
    f.controller.receive(result(slowWire), f.agent);
    assert.equal((await slowStatus).error.code, 'stale-generation');
});

test('a later-sequenced status started during a mutation cannot replace its baseline', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    await f.complete(command());

    const loadRequest = command('load', { controllerEpoch: EPOCH, expectedGeneration: '0' });
    const loading = f.controller.request(loadRequest, {});
    await new Promise(setImmediate);
    const loadWire = f.sent.at(-1);

    const overlappingStatus = f.controller.request(command(), {});
    await new Promise(setImmediate);
    const statusWire = f.sent.at(-1);
    f.controller.receive(result(statusWire), f.agent);
    assert.equal((await overlappingStatus).generation, '0');

    f.controller.receive(result(loadWire, status({ anyActive: true, anyInactive: false,
        activeTargetCount: 1, inactiveTargetCount: 0 })), f.agent);
    const loaded = await loading;
    assert.equal(loaded.generation, '1');

    const unloadRequest = command('unload', { controllerEpoch: EPOCH, expectedGeneration: '1' });
    const unloading = f.controller.request(unloadRequest, {});
    await new Promise(setImmediate);
    assert.equal(f.sent.at(-1).operation, 'unload');
    f.controller.receive(result(f.sent.at(-1), status({ restartRequired: true })), f.agent);
    assert.equal((await unloading).generation, '2');
});

test('unknown agent errors are replaced and Win32 lastError remains bounded', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    const failed = endpoint();
    failed.result = 1;
    failed.lastError = 193;
    const response = await f.complete(command(), {
        ok: false, controllers: { x86: failed, x64: endpoint({ anyResident: false, anyActive: false, anyInactive: false,
            matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 }) },
        error: { code: 'secret-code', message: 'C:\\private\\detail', lastError: 193 }
    });
    assert.deepEqual(response.error, { code: 'invalid-agent-result', message: 'The agent returned an invalid runtime result.' });
    assert.equal(response.controllers.x86.lastError, 193);
    assert.doesNotMatch(JSON.stringify(response), /secret-code|private/);
});

test('legacy policy, capability and physical unload operations are rejected', async t => {
    const f = controllerFixture(); t.after(f.controller.close);
    for (const operation of ['getCapabilities', 'setPolicy', 'deactivate', 'freeLibrary']) {
        assert.equal((await f.controller.request(command(operation), {})).error.code, 'invalid-request');
    }
    assert.equal((await f.controller.request(command('getStatus', { controllerEpoch: EPOCH }), {})).error.code, 'invalid-request');
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
        const fields = request.operation === 'load' ?
            status({ anyActive: true, anyInactive: false, activeTargetCount: 1, inactiveTargetCount: 0 }) :
            request.operation === 'unload' ? status({ loadEnabled: false, restartRequired: true }) : status();
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
    const loaded = await f.request(command('load', { nodeid: NODE, controllerEpoch: initial.value.controllerEpoch, expectedGeneration: initial.value.generation }));
    assert.equal(loaded.value.ok, true);
    assert.equal(loaded.value.anyActive, true);
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
    const denied = await f.request(command('load', { nodeid: NODE, controllerEpoch: initial.value.controllerEpoch,
        expectedGeneration: initial.value.generation }));
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
    const denied = await f.request(command('load', { nodeid: NODE, controllerEpoch: initial.value.controllerEpoch,
        expectedGeneration: initial.value.generation }));
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
    const loaded = await f.request(command('load', { controllerEpoch: initial.value.controllerEpoch, expectedGeneration: initial.value.generation }));
    assert.equal(loaded.value.anyActive, true);
    const unloaded = await f.request(command('unload', { controllerEpoch: loaded.value.controllerEpoch, expectedGeneration: loaded.value.generation }));
    assert.equal(unloaded.value.restartRequired, true);
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
    const denied = await f.request(command('unload', { controllerEpoch: tokenViewOnly.value.controllerEpoch,
        expectedGeneration: tokenViewOnly.value.generation }));
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
    const denied = await f.request(command('unload', { controllerEpoch: initial.value.controllerEpoch,
        expectedGeneration: initial.value.generation }));
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

test('model drives one stateful toggle and permits reloading with a restoration warning', async () => {
    const replies = [
        status({ controllerEpoch: EPOCH, generation: '0' }),
        status({ controllerEpoch: EPOCH, generation: '1', anyActive: true, anyInactive: false, activeTargetCount: 1, inactiveTargetCount: 0 }),
        status({ controllerEpoch: EPOCH, generation: '2', loadEnabled: false, restartRequired: true })
    ];
    const requests = [];
    const model = createModel(async request => {
        requests.push(request);
        return uiResult(request, replies.shift());
    }, crypto.randomUUID, () => {});
    await model.request('getStatus');
    assert.equal(model.nextOperation(), 'load');
    await model.request('load');
    assert.equal(requests[1].controllerEpoch, EPOCH);
    assert.equal(requests[1].expectedGeneration, '0');
    assert.equal(model.nextOperation(), 'unload');
    await model.request('unload');
    assert.equal(requests[2].expectedGeneration, '1');
    assert.equal(model.state.status.restartRequired, true);
    assert.equal(model.nextOperation(), 'load');
});

test('settled controllable state without active or resident targets still offers Load', async () => {
    const request = command();
    const model = createModel(async value => uiResult(value, status({ controllerEpoch: EPOCH, generation: '0',
        loadEnabled: false, anyResident: false, anyActive: false, anyInactive: false,
        matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 })),
    crypto.randomUUID, () => {});
    await model.request(request.operation);
    assert.equal(model.nextOperation(), 'load');
});

test('a confirmed controller failure remains actionable from its reported state', async () => {
    const requests = [];
    const model = createModel(async request => {
        requests.push(request);
        if (request.operation === 'getStatus') return uiResult(request, status({ controllerEpoch: EPOCH, generation: '0' }));
        return uiResult(request, status({ ok: false, state: 'degraded', controllerEpoch: EPOCH, generation: '1',
            failedTargetCount: 1, error: { code: 'controller-command-failed', message: 'The controller could not complete the command.' } }));
    }, crypto.randomUUID, () => {});
    await model.request('getStatus');
    await model.request('load');
    assert.equal(model.state.error, 'The controller could not complete the command.');
    assert.equal(model.nextOperation(), 'load');
    assert.deepEqual(requests.map(request => request.operation), ['getStatus', 'load']);
});

test('an unknown mutation outcome is reconciled with getStatus and never retried', async () => {
    const requests = [];
    const model = createModel(async request => {
        requests.push(request);
        if (requests.length === 1) return uiResult(request, status({ controllerEpoch: EPOCH, generation: '0' }));
        if (request.operation === 'load') return {
            action: 'nativeRuntimeResult', version: 1, operation: 'load', requestId: request.requestId,
            ok: false, state: 'unknown', error: { code: 'outcome-unknown', message: 'Status unknown.' }
        };
        return uiResult(request, status({ controllerEpoch: EPOCH, generation: '1', anyActive: true,
            anyInactive: false, activeTargetCount: 1, inactiveTargetCount: 0 }));
    }, crypto.randomUUID, () => {});
    await model.request('getStatus');
    await model.request('load');
    assert.deepEqual(requests.map(request => request.operation), ['getStatus', 'load', 'getStatus']);
    assert.equal(model.state.error, null);
    assert.equal(model.nextOperation(), 'unload');
});

test('a successful pending mutation polls status until the controller settles', async () => {
    const requests = [];
    let statusReads = 0;
    const model = createModel(async request => {
        requests.push(request);
        if (request.operation === 'load') return uiResult(request, status({ controllerEpoch: EPOCH, generation: '1',
            operationPending: true, anyActive: true, anyInactive: false, activeTargetCount: 1, inactiveTargetCount: 0 }));
        statusReads++;
        return uiResult(request, status({ controllerEpoch: EPOCH, generation: statusReads === 1 ? '0' : '1',
            operationPending: statusReads === 2, anyActive: statusReads > 1, anyInactive: statusReads <= 1,
            activeTargetCount: statusReads > 1 ? 1 : 0, inactiveTargetCount: statusReads <= 1 ? 1 : 0 }));
    }, crypto.randomUUID, () => {}, async () => {});
    await model.request('getStatus');
    await model.request('load');
    assert.deepEqual(requests.map(request => request.operation), ['getStatus', 'load', 'getStatus', 'getStatus']);
    assert.equal(model.state.status.operationPending, false);
    assert.equal(model.nextOperation(), 'unload');
});

test('pending polling is bounded and leaves a manual status retry path', async () => {
    const requests = [];
    let statusReads = 0;
    const model = createModel(async request => {
        requests.push(request);
        if (request.operation === 'load') return uiResult(request, status({ controllerEpoch: EPOCH, generation: '1',
            operationPending: true }));
        statusReads++;
        return uiResult(request, status({ controllerEpoch: EPOCH, generation: statusReads === 1 ? '0' : '1',
            operationPending: statusReads > 1 && statusReads < 6 }));
    }, crypto.randomUUID, () => {}, async () => {});
    await model.request('getStatus');
    await model.request('load');
    assert.equal(requests.filter(request => request.operation === 'load').length, 1);
    assert.equal(requests.filter(request => request.operation === 'getStatus').length, 5);
    assert.equal(model.state.status.operationPending, true);
    assert.match(model.state.error, /still pending/);
    assert.equal(model.nextOperation(), 'getStatus');
    await model.request('getStatus');
    assert.equal(model.state.status.operationPending, false);
    assert.equal(model.nextOperation(), 'load');
});

test('same-scope reset cancels a sleeping pending-status loop', async () => {
    const requests = [];
    let releasePause;
    const model = createModel(async request => {
        requests.push(request);
        return uiResult(request, status({ controllerEpoch: EPOCH, generation: request.operation === 'load' ? '1' : '0',
            operationPending: request.operation === 'load' }));
    }, crypto.randomUUID, () => {}, () => new Promise(resolve => { releasePause = resolve; }));
    model.reset('A');
    await model.request('getStatus');
    const loading = model.request('load');
    await new Promise(setImmediate);
    assert.equal(model.state.polling, true);
    model.reset('A');
    releasePause();
    await loading;
    assert.deepEqual(requests.map(request => request.operation), ['getStatus', 'load']);
    assert.equal(model.state.status, null);
    assert.equal(model.state.polling, false);
});

test('A-B-A reset sequence cannot revive an earlier pending-status loop', async () => {
    const requests = [];
    let releasePause;
    const model = createModel(async request => {
        requests.push(request);
        return uiResult(request, status({ controllerEpoch: EPOCH, generation: request.operation === 'load' ? '1' : '0',
            operationPending: request.operation === 'load' }));
    }, crypto.randomUUID, () => {}, () => new Promise(resolve => { releasePause = resolve; }));
    model.reset('A');
    await model.request('getStatus');
    const loading = model.request('load');
    await new Promise(setImmediate);
    model.reset('B');
    model.reset('A');
    releasePause();
    await loading;
    assert.deepEqual(requests.map(request => request.operation), ['getStatus', 'load']);
    assert.equal(model.state.scope, 'A');
    assert.equal(model.state.status, null);
    assert.equal(model.state.polling, false);
});

// Minimal DOM with the insertion semantics of all five MeshCentral 1.2.1 viewers.
function viewerFixture(kind, replyFields) {
    const elements = [];
    function element(tag) {
        const node = { tagName: tag.toUpperCase(), children: [], style: {}, attributes: {}, listeners: {}, disabled: false,
            setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(name, fn) { this.listeners[name] = fn; },
            appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
            insertBefore(child, before) { const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this; },
            get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1]; },
            get isConnected() { return !!this.parentNode; } };
        elements.push(node); return node;
    }
    const body = element('body'), toolbar = body.appendChild(element('div'));
    const mobile = kind.includes('mobile');
    const anchor = toolbar.appendChild(element(mobile ? 'input' : kind === 'modern' ? 'div' : 'span'));
    anchor.id = mobile ? 'connectbutton1' : 'connectbutton1span';
    const prefix = '/tenant/';
    const document = { body, readyState: 'complete', currentScript: { src: 'https://host' + prefix + 'plugin/nativeruntime/client.js' },
        createElement: element, getElementById: id => elements.find(e => e.id === id), addEventListener() {} };
    const requests = [], requestUrls = [];
    const win = { document, crypto, currentNode: kind.startsWith('guest') ? null : { _id: NODE }, authCookie: 'cookie',
        location: { pathname: kind.startsWith('guest') ? prefix + 'sharing/' : prefix,
            href: kind.startsWith('guest') ? 'https://host' + prefix + 'sharing/' : 'https://host' + prefix },
        URL, AbortController, setTimeout, clearTimeout, addEventListener() {}, MutationObserver: class { observe() {} },
        fetch: async (url, options) => { const request = JSON.parse(options.body); requestUrls.push(url); requests.push(request); return {
            status: 200, json: async () => uiResult(request, { controllerEpoch: EPOCH, generation: '0', ...replyFields }) }; } };
    return { win, anchor, requests, requestUrls };
}

for (const surface of ['classic', 'modern', 'mobile', 'guest', 'guest-mobile']) {
    test('single Load control beside Connect: ' + surface, async () => {
        const f = viewerFixture(surface);
        const model = install(f.win);
        await new Promise(setImmediate);
        const panel = f.win.document.getElementById('mc-native-runtime');
        assert.equal(f.anchor.nextSibling, panel);
        assert.equal(panel.attributes['aria-label'], 'Native runtime');
        assert.equal(panel.children.length, 2);
        assert.equal(panel.children[0].textContent, 'Load');
        assert.equal(panel.children[0].disabled, false);
        assert.equal(panel.children[1].attributes['aria-live'], 'polite');
        assert.match(panel.children[1].textContent, /Runtime: unloaded \(resident, pass-through\)/);
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].nodeid, surface.startsWith('guest') ? undefined : NODE);
        assert.equal(f.requestUrls[0], 'https://host/tenant/plugin/nativeruntime/request');
        assert.equal(model.nextOperation(), 'load');
    });
}

test('loaded viewer exposes Unload and explains that unload is pass-through', async () => {
    const f = viewerFixture('classic', status({ anyActive: true, anyInactive: false, activeTargetCount: 1, inactiveTargetCount: 0 }));
    install(f.win);
    await new Promise(setImmediate);
    const control = f.win.document.getElementById('mc-native-runtime').children[0];
    assert.equal(control.textContent, 'Unload');
    assert.match(control.title, /keeping the component resident/);
    assert.match(control.title, /never physically unloads/);
});

test('restart-required viewer keeps Load available and reports incomplete restoration', async () => {
    const f = viewerFixture('guest', status({ loadEnabled: false, restartRequired: true }));
    install(f.win);
    await new Promise(setImmediate);
    const panel = f.win.document.getElementById('mc-native-runtime');
    assert.equal(panel.children[0].textContent, 'Load');
    assert.equal(panel.children[0].disabled, false);
    assert.match(panel.children[1].textContent, /restart required for complete restoration/);
    assert.match(panel.children[0].title, /Load the runtime again/);
});

test('zero-target settled viewer keeps Load available', async () => {
    const f = viewerFixture('classic', status({ loadEnabled: false, anyResident: false, anyActive: false, anyInactive: false,
        matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0, inactiveTargetCount: 0 }));
    const model = install(f.win);
    await new Promise(setImmediate);
    const control = f.win.document.getElementById('mc-native-runtime').children[0];
    assert.equal(control.textContent, 'Load');
    assert.equal(control.disabled, false);
    assert.equal(model.nextOperation(), 'load');
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

test('failed targets render degraded rather than unloaded', async () => {
    const f = viewerFixture('classic', status({ state: 'degraded', failedTargetCount: 1 }));
    install(f.win);
    await new Promise(setImmediate);
    const text = f.win.document.getElementById('mc-native-runtime').children[1].textContent;
    assert.match(text, /^Runtime: degraded/);
    assert.match(text, /1 failed/);
    assert.doesNotMatch(text, /unloaded/);
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
    assert.doesNotMatch(panel.children[1].textContent, /unloaded/);
    assert.equal(model.nextOperation(), 'getStatus');
});

test('pending status renders pending rather than unloaded and remains refreshable', async () => {
    const f = viewerFixture('classic', status({ operationPending: true }));
    const model = install(f.win);
    await new Promise(setImmediate);
    const panel = f.win.document.getElementById('mc-native-runtime');
    assert.equal(panel.children[0].textContent, 'Retry Status');
    assert.equal(panel.children[0].disabled, false);
    assert.match(panel.children[1].textContent, /^Runtime: operation pending/);
    assert.doesNotMatch(panel.children[1].textContent, /unloaded/);
    assert.equal(model.nextOperation(), 'getStatus');
});

test('deployment wiring loads both local plugins from the pinned MeshCentral data path', () => {
    const root = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'meshcentral-data', 'config.json.template'), 'utf8'));
    assert.equal(pkg.dependencies.meshcentral, '1.2.1');
    assert.equal(lock.packages[''].dependencies.meshcentral, '1.2.1');
    assert.equal(lock.packages['node_modules/meshcentral'].version, '1.2.1');
    assert.equal(pkg.engines.node, '>=20.0.0');
    assert.equal(config.settings.plugins.enabled, true);
    assert.deepEqual(config.settings.plugins.list, ['stfdeploy', 'nativeruntime']);
    assert.equal(Object.hasOwn(config.settings.plugins, 'nativeruntime'), false);
    assert.equal(config.settings.plugins.stfdeploy.enabled, true);
    assert.equal(config.domains[''].WebPublicPath, './meshcentral-data/public');

    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    assert.match(compose, /image:\s*ghcr\.io\/ylianst\/meshcentral:1\.2\.1/);
    assert.doesNotMatch(compose, /:latest(?:\s|$)/);
    assert.match(compose, /\.\/plugins:\/opt\/meshcentral\/meshcentral-data\/plugins:ro/);
    assert.match(compose, /\.\/public:\/opt\/meshcentral\/meshcentral-data\/public:ro/);

    const shell = fs.readFileSync(path.join(root, 'scripts', 'setup-local.sh'), 'utf8');
    assert.match(shell, /for plugin in stfdeploy nativeruntime/);
    assert.match(shell, /cp -R "public\/\." "meshcentral-data\/public\/"/);
    const powershell = fs.readFileSync(path.join(root, 'scripts', 'setup-local.ps1'), 'utf8');
    assert.match(powershell, /@\('stfdeploy', 'nativeruntime'\)/);
    assert.match(powershell, /'meshcentral-data\/public'/);
});

test('optional pinned-template contract: all five source anchors and shared scripts', { skip: !process.env.MESHCENTRAL_SOURCE }, () => {
    const source = process.env.MESHCENTRAL_SOURCE;
    assert.equal(JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).version, '1.2.1');
    for (const [file, tag, id] of [
        ['default', 'span', 'connectbutton1span'], ['default3', 'div', 'connectbutton1span'],
        ['default-mobile', 'input', 'connectbutton1'], ['sharing', 'span', 'connectbutton1span'],
        ['sharing-mobile', 'input', 'connectbutton1']
    ]) {
        const html = fs.readFileSync(path.join(source, 'views', file + '.handlebars'), 'utf8');
        assert.match(html, new RegExp('<' + tag + '\\b[^>]*\\bid=["\\\']?' + id + '(?:["\\\']|[ >])'));
        assert.match(html, /\{\{\{customJSTags\}\}\}/);
    }
});
