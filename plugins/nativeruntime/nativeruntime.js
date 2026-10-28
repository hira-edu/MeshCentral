'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATIONS = new Set(['getStatus', 'start', 'stop', 'load', 'unload']);
const MUTATIONS = new Set(['start', 'stop', 'load', 'unload']);
const UNBOUNDED_GUEST_COOKIE_MINUTES = Math.floor(Number.MAX_SAFE_INTEGER / 60000);
const AGENT_ERRORS = Object.freeze({
    'invalid-request': 'The agent rejected the runtime request.',
    'controller-transport-failed': 'One or more runtime controllers could not be reached.',
    'controller-command-failed': 'One or more runtime controllers rejected or could not complete the command.'
});

// The agent's relay parser accepts getStatus/load/unload; start and stop are
// browser aliases and must be translated before they reach the agent.
function mapOperation(operation) {
    if (operation === 'start') return 'load';
    if (operation === 'stop') return 'unload';
    return operation;
}

const CONTROLLER_UINT_FIELDS = ['transportError', 'result', 'flags', 'matchedTargetCount', 'residentTargetCount',
    'activeTargetCount', 'inactiveTargetCount', 'failedTargetCount', 'lastError'];

// Forward only the fixed fields the agent emits, never arbitrary agent data.
function sanitizeController(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.transportSuccess !== 'boolean') return null;
    const result = { transportSuccess: value.transportSuccess };
    for (const field of CONTROLLER_UINT_FIELDS) {
        if (!Number.isInteger(value[field]) || value[field] < 0 || value[field] > 0xffffffff) return null;
        result[field] = value[field];
    }
    return result;
}

function emptyStatus() {
    return {
        state: 'unknown',
        running: false,
        loadEnabled: false
    };
}

function failure(request, code, message, canControl) {
    const response = {
        action: 'nativeRuntimeResult',
        version: 1,
        operation: request ? request.operation : undefined,
        requestId: request ? request.requestId : undefined,
        ok: false,
        ...emptyStatus(),
        error: { code, message }
    };
    if (typeof canControl === 'boolean') response.canControl = canControl;
    return response;
}

function validateRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !OPERATIONS.has(value.operation)) return false;
    const allowed = new Set(['action', 'version', 'operation', 'requestId', 'nodeid']);
    return Object.keys(value).every(key => allowed.has(key)) &&
        value.action === 'nativeRuntime' && value.version === 1 && typeof value.requestId === 'string' && UUID.test(value.requestId);
}

function validShareWindow(share, now) {
    if (share.revoked === true) return false;
    if (share.startTime == null) return share.expireTime == null || (Number.isFinite(share.expireTime) && now < share.expireTime);
    if (!Number.isFinite(share.startTime) || now < share.startTime) return false;
    if (share.recurring != null) {
        if (share.recurring !== 1 && share.recurring !== 2) return false;
        if (!Number.isFinite(share.duration) || share.duration <= 0) return false;
        const interval = share.recurring === 1 ? 86400000 : 604800000;
        return (now - share.startTime) % interval < Math.min(interval, share.duration * 60000);
    }
    const end = share.expireTime == null ? share.startTime + share.duration * 60000 : share.expireTime;
    return Number.isFinite(end) && end > share.startTime && now < end;
}

function readRecord(db, id) {
    return new Promise((resolve, reject) => db.Get(id, (error, docs) => {
        if (error || !Array.isArray(docs) || docs.length !== 1) reject(new Error('record-unavailable'));
        else resolve(docs[0]);
    }));
}

function decodeRuntimeCookie(server, value) {
    let token = server.decodeCookie(value, server.loginCookieEncryptionKey, 60);
    if (token) return token;
    // MeshCentral 1.2.1 does not renew authCookie on non-expiring guest-share
    // pages. Only a guest token gets the long verification window; authorize()
    // still checks its IP, domain, node, share record, window and revocation.
    token = server.decodeCookie(value, server.loginCookieEncryptionKey, UNBOUNDED_GUEST_COOKIE_MINUTES);
    return token && typeof token.pid === 'string' ? token : null;
}

// The agent's only status shape (runtime_control_binding.c): controllers.x86 and controllers.x64,
// each a fixed endpoint record whose flags bit 0 is set while that runtime is active.
function sanitizeStatus(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
    const controllers = message.controllers;
    if (!controllers || typeof controllers !== 'object' || Array.isArray(controllers)) return null;
    const x86 = sanitizeController(controllers.x86);
    const x64 = sanitizeController(controllers.x64);
    if (!x86 || !x64) return null;
    const active = (x86.flags & 1) !== 0 || (x64.flags & 1) !== 0;
    // An unreachable controller, a failed launch or a crash must not
    // render as a healthy stop.
    const reachable = [x86, x64].filter(c => c.transportSuccess);
    const state = reachable.length === 0 ? 'unavailable' :
        (reachable.length === 2 && reachable.every(c => c.transportError === 0) ? 'ready' : 'degraded');
    return { state, running: active, loadEnabled: active, controllers: { x86, x64 } };
}

function sanitizeAgentError(value, ok) {
    if (ok) return null;
    const code = value && typeof value.code === 'string' && Object.hasOwn(AGENT_ERRORS, value.code) ? value.code : 'invalid-agent-result';
    return { code, message: code === 'invalid-agent-result' ? 'The agent returned an invalid runtime result.' : AGENT_ERRORS[code] };
}

function createController(options) {
    const pending = new Map();
    const requests = new Map();
    const mutating = new Set();
    const now = options.now || Date.now;
    const timeoutMs = options.timeoutMs || 15000;

    function finishPending(wireId, item) {
        pending.delete(wireId);
        clearTimeout(item.timer);
        if (item.mutation) mutating.delete(item.nodeid);
    }

    function receive(message, agent) {
        if (!message || message.action !== 'nativeRuntimeResult' || message.version !== 1) return;
        const item = pending.get(message.requestId);
        if (!item || item.agent !== agent || message.operation !== mapOperation(item.operation) || agent.dbNodeKey !== item.nodeid || typeof message.ok !== 'boolean') return;
        const status = sanitizeStatus(message);
        if (!status) return;
        finishPending(message.requestId, item);
        const response = {
            action: 'nativeRuntimeResult',
            version: 1,
            operation: item.operation,
            requestId: item.requestId,
            ok: message.ok,
            canControl: item.canControl,
            ...status,
            error: sanitizeAgentError(message.error, message.ok)
        };
        item.resolve(response);
    }

    async function request(command, identity) {
        if (!validateRequest(command)) return failure(command || {}, 'invalid-request', 'Invalid runtime request.');
        let access;
        try { access = await options.authorize(identity, command); }
        catch (_) { return failure(command, 'access-denied', 'Runtime access is unavailable.'); }
        const mutation = MUTATIONS.has(command.operation);
        if (mutation && access.canControl !== true) {
            return failure(command, 'access-denied', 'This desktop session is view-only.', false);
        }
        const agent = options.getAgent(access.nodeid);
        if (!agent) return failure(command, 'agent-offline', 'Agent is offline.', access.canControl === true);

        const key = access.principal + '/' + command.requestId;
        const fingerprint = JSON.stringify([access.nodeid, command.operation]);
        for (const [id, entry] of requests) if (entry.expires <= now()) requests.delete(id);
        const existing = requests.get(key);
        if (existing) {
            if (existing.fingerprint !== fingerprint) return failure(command, 'request-id-conflict', 'Request ID was already used for different contents.', access.canControl === true);
            const duplicateResult = await existing.promise;
            let duplicateAccess;
            try { duplicateAccess = await options.authorize(identity, command); }
            catch (_) { return failure(command, 'access-denied', 'Runtime access is unavailable.'); }
            return { ...duplicateResult, canControl: duplicateAccess.canControl === true };
        }
        if (requests.size >= 512 || pending.size >= 64) return failure(command, 'busy', 'Runtime controller is busy.', access.canControl === true);

        if (mutation && mutating.has(access.nodeid)) {
            return failure(command, 'busy', 'A runtime change is already pending.', true);
        }

        const wireId = mutation ? command.requestId : crypto.randomUUID();
        if (pending.has(wireId)) return failure(command, 'busy', 'A request with this ID is still pending.', access.canControl === true);
        const promise = new Promise((resolve) => {
            const item = {
                resolve,
                agent,
                nodeid: access.nodeid,
                operation: command.operation,
                requestId: command.requestId,
                mutation,
                canControl: access.canControl === true
            };
            item.timer = setTimeout(() => {
                finishPending(wireId, item);
                resolve(failure(command, 'outcome-unknown', 'No confirmed response. Refresh status before another change.', item.canControl));
            }, timeoutMs);
            pending.set(wireId, item);
            if (mutation) mutating.add(access.nodeid);
            const outgoing = { action: 'nativeRuntime', version: 1, operation: mapOperation(command.operation), requestId: wireId };
            try { agent.send(JSON.stringify(outgoing)); }
            catch (_) {
                finishPending(wireId, item);
                resolve(failure(command, 'outcome-unknown', 'Agent connection changed. Refresh runtime status.', item.canControl));
            }
        });
        requests.set(key, { fingerprint, promise, expires: now() + 300000 });
        const result = await promise;
        let finalAccess;
        try { finalAccess = await options.authorize(identity, command); }
        catch (_) { return failure(command, 'access-denied', 'Runtime access expired while the request was pending.'); }
        return { ...result, canControl: finalAccess.canControl === true };
    }

    function close() {
        for (const [id, item] of pending) {
            finishPending(id, item);
            item.resolve(failure(item, 'outcome-unknown', 'Runtime controller stopped.', item.canControl));
        }
        requests.clear();
        mutating.clear();
    }
    return { request, receive, close };
}

module.exports.nativeruntime = function (parent) {
    const server = parent.parent;
    let web;
    const controller = createController({
        getAgent: (nodeid) => web?.wsagents?.[nodeid],
        authorize: async (identity, command) => {
            const { req, domain, token } = identity;
            const now = Date.now();
            if (!token || token.domainid !== domain.id) throw new Error('invalid-token');
            const normalizeIp = (value) => typeof value === 'string' ? value.replace(/^::ffff:/, '') : '';
            if (!token.ip || normalizeIp(token.ip) !== normalizeIp(req.clientIp)) throw new Error('ip-mismatch');
            const guest = typeof token.pid === 'string';
            if (guest && token.expire != null && (!Number.isFinite(token.expire) || token.expire <= now)) throw new Error('expired-token');
            let nodeid = command.nodeid;
            let share;
            if (guest) {
                if (domain.guestdevicesharing === false || token.pid.length > 256 || !(token.p & 2)) throw new Error('guest-disabled');
                share = await readRecord(server.db, 'deviceshare-' + token.pid);
                if (share.publicid !== token.pid || share.domain !== domain.id || share.nodeid !== token.nid || !(share.p & 2) ||
                    (share.userid && share.userid !== token.userid) || (share.extrakey != null && share.extrakey !== token.k) || !validShareWindow(share, now)) throw new Error('invalid-share');
                nodeid = share.nodeid;
                if (command.nodeid != null && command.nodeid !== nodeid) throw new Error('node-mismatch');
            } else {
                const session = req.session;
                if (!session || !session.x || session.userid !== token.userid ||
                    (session.expire != null && session.expire <= now) || web.destroyedSessions?.[session.userid + '/' + session.x] != null) throw new Error('session-revoked');
            }
            if (typeof nodeid !== 'string' || nodeid.length > 256 || !nodeid.startsWith('node/' + domain.id + '/') || nodeid.split('/').length !== 3) throw new Error('invalid-node');
            const node = await readRecord(server.db, nodeid);
            if (node._id !== nodeid || node.domain !== domain.id || typeof node.meshid !== 'string' || !node.meshid.startsWith('mesh/' + domain.id + '/')) throw new Error('node-domain-mismatch');
            const user = web.users[token.userid];
            const domainViewOnly = domain.desktop && domain.desktop.viewonly === true;
            let canControl;
            if (!guest) {
                if (!user || user._id.split('/')[1] !== domain.id || (user.siteadmin !== 0xffffffff && (user.siteadmin & 32))) throw new Error('invalid-user');
                const rights = web.GetNodeRights(user, node.meshid, nodeid);
                if (!(rights & 8) && !(rights & 256)) throw new Error('node-access-denied');
                if (rights !== 0xffffffff && (rights & 0x10000)) throw new Error('desktop-disabled');
                canControl = !domainViewOnly && (rights === 0xffffffff || (rights & 0x100) === 0);
            } else {
                canControl = !domainViewOnly && share.viewOnly !== true && token.vo != 1;
            }
            return { nodeid, guest, principal: guest ? 'share/' + share.publicid : user._id, canControl };
        }
    });

    function setupHttp(webserver) {
        web = webserver;
        const prefixes = new Set(Object.values(server.config.domains).filter(d => d.dns == null && d.share == null).map(d => d.url));
        prefixes.add('/');
        for (const prefix of prefixes) {
            web.app.get(prefix + 'plugin/nativeruntime/client.js', (_req, res) => {
                res.setHeader('Cache-Control', 'no-store, max-age=0');
                res.sendFile(path.join(__dirname, 'client.js'));
            });
            web.app.post(prefix + 'plugin/nativeruntime/request', web.express.json({ limit: '8kb', strict: true }), async (req, res) => {
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('X-Content-Type-Options', 'nosniff');
                if (req.headers['x-native-runtime'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') return res.sendStatus(403);
                const domain = req.xdomain || web.dnsDomains?.[String(req.hostname).toLowerCase()] ||
                    Object.values(server.config.domains).find(d => d.dns == null && d.url === prefix);
                if (!domain || domain.share != null) return res.sendStatus(403);
                const bearer = req.headers.authorization;
                if (typeof bearer !== 'string' || !bearer.startsWith('Bearer ') || bearer.length > 4096) return res.sendStatus(401);
                let token;
                try { token = decodeRuntimeCookie(server, bearer.substring(7)); }
                catch (_) { return res.sendStatus(401); }
                const result = await controller.request(req.body, { req, domain, token });
                res.status(result.error?.code === 'access-denied' ? 403 : 200).json(result);
            });
        }
    }
    return {
        exports: [],
        ['hook_' + 'setupHttpHandlers']: setupHttp,
        ['hook_' + 'processAgentData']: controller.receive,
        close: controller.close
    };
};

module.exports.createController = createController;
module.exports.validShareWindow = validShareWindow;
module.exports.validateRequest = validateRequest;
module.exports.decodeRuntimeCookie = decodeRuntimeCookie;
module.exports.sanitizeStatus = sanitizeStatus;
