'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GENERATION = /^(0|[1-9][0-9]{0,19})$/;
const EPOCH = /^[0-9a-f]{32}$/;
const OPERATIONS = new Set(['getStatus', 'load', 'unload']);
const MUTATIONS = new Set(['load', 'unload']);
const UNBOUNDED_GUEST_COOKIE_MINUTES = Math.floor(Number.MAX_SAFE_INTEGER / 60000);
const COUNT_STATUS_FIELDS = ['matchedTargetCount', 'residentTargetCount', 'activeTargetCount', 'inactiveTargetCount', 'failedTargetCount'];
const CONTROLLER_FLAG_MASK = 0x7f;
const AGENT_ERRORS = Object.freeze({
    'invalid-request': 'The agent rejected the runtime request.',
    'controller-transport-failed': 'One or more runtime controllers could not be reached.',
    'controller-command-failed': 'One or more runtime controllers rejected or could not complete the command.'
});

function emptyStatus() {
    return {
        state: 'unknown', loadEnabled: false, operationPending: false,
        anyResident: false, anyActive: false, anyInactive: false, restartRequired: false,
        matchedTargetCount: 0, residentTargetCount: 0, activeTargetCount: 0,
        inactiveTargetCount: 0, failedTargetCount: 0
    };
}

function failure(request, code, message, controllerEpoch, generation, canControl) {
    const response = { action: 'nativeRuntimeResult', version: 1, operation: request.operation, requestId: request.requestId,
        ok: false, ...emptyStatus(), error: { code, message } };
    if (controllerEpoch) response.controllerEpoch = controllerEpoch;
    if (generation != null) response.generation = String(generation);
    if (typeof canControl === 'boolean') response.canControl = canControl;
    return response;
}

function validateRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !OPERATIONS.has(value.operation)) return false;
    const allowed = new Set(['action', 'version', 'operation', 'requestId', 'nodeid']);
    if (MUTATIONS.has(value.operation)) {
        allowed.add('controllerEpoch');
        allowed.add('expectedGeneration');
    }
    return Object.keys(value).every(key => allowed.has(key)) &&
        value.action === 'nativeRuntime' && value.version === 1 && typeof value.requestId === 'string' && UUID.test(value.requestId) &&
        (!MUTATIONS.has(value.operation) || (typeof value.controllerEpoch === 'string' && EPOCH.test(value.controllerEpoch) &&
            typeof value.expectedGeneration === 'string' && GENERATION.test(value.expectedGeneration)));
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

function uint32(value) {
    return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function sanitizeController(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.transportSuccess !== 'boolean') return null;
    const result = { transportSuccess: value.transportSuccess };
    for (const field of ['transportError', 'result', 'flags', ...COUNT_STATUS_FIELDS, 'lastError']) {
        if (!uint32(value[field])) return null;
        result[field] = value[field];
    }
    if (result.result > 4 ||
        (result.flags & ~CONTROLLER_FLAG_MASK) !== 0 ||
        (result.transportSuccess && result.transportError !== 0) ||
        result.activeTargetCount > result.residentTargetCount ||
        result.inactiveTargetCount > result.residentTargetCount ||
        result.residentTargetCount > result.matchedTargetCount ||
        ((result.flags & 0x4) !== 0) !== (result.residentTargetCount > 0) ||
        ((result.flags & 0x8) !== 0) !== (result.activeTargetCount > 0) ||
        ((result.flags & 0x10) !== 0) !== (result.inactiveTargetCount > 0)) return null;
    return result;
}

function sanitizeStatus(message) {
    if (!message.controllers || typeof message.controllers !== 'object' || Array.isArray(message.controllers)) return null;
    const x86 = sanitizeController(message.controllers.x86);
    const x64 = sanitizeController(message.controllers.x64);
    if (!x86 || !x64) return null;
    const successful = [x86, x64].filter(controller => controller.transportSuccess);
    const loadEnabledMismatch = successful.length === 2 && ((x86.flags & 0x1) !== (x64.flags & 0x1));
    const result = {
        state: successful.length === 0 ? 'unavailable' :
            (successful.length !== 2 || loadEnabledMismatch || successful.some(controller => controller.result !== 0 || controller.lastError !== 0 ||
                (controller.flags & 0x20) !== 0 || controller.failedTargetCount > 0) ? 'degraded' : 'ready'),
        loadEnabled: successful.some(controller => (controller.flags & 0x1) !== 0),
        operationPending: successful.some(controller => (controller.flags & 0x2) !== 0),
        anyResident: successful.some(controller => (controller.flags & 0x4) !== 0),
        anyActive: successful.some(controller => (controller.flags & 0x8) !== 0),
        anyInactive: successful.some(controller => (controller.flags & 0x10) !== 0),
        restartRequired: successful.some(controller => (controller.flags & 0x40) !== 0),
        controllers: { x86, x64 }
    };
    for (const field of COUNT_STATUS_FIELDS) {
        result[field] = successful.reduce((total, controller) => total + controller[field], 0);
    }
    return result;
}

function sanitizeAgentError(value, ok) {
    if (ok) return null;
    const code = value && typeof value.code === 'string' && Object.hasOwn(AGENT_ERRORS, value.code) ? value.code : 'invalid-agent-result';
    return { code, message: code === 'invalid-agent-result' ? 'The agent returned an invalid runtime result.' : AGENT_ERRORS[code] };
}

// MeshCentral is an authenticated, correlated relay. It adds a relay-session
// epoch and per-node generation for stale-browser protection, but it does not
// synthesize target capabilities or policy. Controller state comes from the
// strictly validated agent result.
function createController(options) {
    const pending = new Map();
    const requests = new Map();
    const confirmed = new Map();
    const generations = new Map();
    const mutating = new Set();
    const now = options.now || Date.now;
    const timeoutMs = options.timeoutMs || 15000;
    const controllerEpoch = options.controllerEpoch || crypto.randomBytes(16).toString('hex');
    let sequence = 0;

    function generation(nodeid) { return generations.get(nodeid) || 0n; }
    function finishPending(wireId, item) {
        pending.delete(wireId);
        clearTimeout(item.timer);
        if (item.mutation) mutating.delete(item.nodeid);
    }

    function receive(message, agent) {
        if (!message || message.action !== 'nativeRuntimeResult' || message.version !== 1) return;
        const item = pending.get(message.requestId);
        if (!item || item.agent !== agent || message.operation !== item.operation || agent.dbNodeKey !== item.nodeid || typeof message.ok !== 'boolean') return;
        const status = sanitizeStatus(message);
        if (!status) return;
        const controllerOk = status.controllers.x86.transportSuccess && status.controllers.x64.transportSuccess &&
            status.controllers.x86.result === 0 && status.controllers.x64.result === 0;
        if (message.ok !== controllerOk) return;
        finishPending(message.requestId, item);
        let current = generation(item.nodeid);
        if (item.generation !== current) {
            item.resolve(failure(item, 'stale-generation', 'Runtime state changed. Refresh status.', controllerEpoch, current, item.canControl));
            return;
        }
        if (item.mutation) {
            current += 1n;
            generations.set(item.nodeid, current);
        }
        const response = {
            action: 'nativeRuntimeResult', version: 1, operation: message.operation, requestId: item.requestId,
            ok: message.ok, controllerEpoch, generation: String(current), canControl: item.canControl, ...status,
            error: sanitizeAgentError(message.error, message.ok)
        };
        const prior = confirmed.get(item.nodeid);
        // A status request started during a mutation can have a higher relay
        // sequence while still describing pre-mutation controller state. Do not
        // let it become the mutation baseline; a confirmed mutation always wins.
        if (item.mutation || (!mutating.has(item.nodeid) && (!prior || prior.sequence <= item.sequence))) {
            confirmed.set(item.nodeid, { response, agent, sequence: item.sequence, at: now() });
        }
        item.resolve(response);
    }

    async function request(command, identity) {
        if (!validateRequest(command)) return failure(command || {}, 'invalid-request', 'Invalid runtime request.');
        let access;
        try { access = await options.authorize(identity, command); }
        catch (_) { return failure(command, 'access-denied', 'Runtime access is unavailable.'); }
        const mutation = MUTATIONS.has(command.operation);
        if (mutation && access.canControl !== true) {
            return failure(command, 'access-denied', 'This desktop session is view-only.', controllerEpoch, generation(access.nodeid), false);
        }
        const agent = options.getAgent(access.nodeid);
        if (!agent) return failure(command, 'agent-offline', 'Agent is offline.', controllerEpoch, generation(access.nodeid), access.canControl === true);

        const key = access.principal + '/' + command.requestId;
        const fingerprint = JSON.stringify([access.nodeid, command.operation, command.controllerEpoch, command.expectedGeneration]);
        for (const [id, entry] of requests) if (entry.expires <= now()) requests.delete(id);
        for (const [id, entry] of confirmed) if (now() - entry.at > 15000) confirmed.delete(id);
        const existing = requests.get(key);
        if (existing) {
            if (existing.fingerprint !== fingerprint) return failure(command, 'request-id-conflict', 'Request ID was already used for different contents.', controllerEpoch, generation(access.nodeid), access.canControl === true);
            const duplicateResult = await existing.promise;
            let duplicateAccess;
            try { duplicateAccess = await options.authorize(identity, command); }
            catch (_) { return failure(command, 'access-denied', 'Runtime access is unavailable.'); }
            return { ...duplicateResult, canControl: duplicateAccess.canControl === true };
        }
        if (requests.size >= 512 || pending.size >= 64) return failure(command, 'busy', 'Runtime controller is busy.', controllerEpoch, generation(access.nodeid), access.canControl === true);

        const current = generation(access.nodeid);
        if (mutation) {
            const latest = confirmed.get(access.nodeid);
            if (!latest || latest.agent !== agent || now() - latest.at > 15000) {
                return failure(command, 'refresh-required', 'Refresh runtime status before changing it.', controllerEpoch, current, true);
            }
            if (command.controllerEpoch !== controllerEpoch || command.expectedGeneration !== String(current) ||
                latest.response.controllerEpoch !== controllerEpoch || latest.response.generation !== String(current)) {
                return failure(command, 'stale-generation', 'Runtime state changed. Refresh before trying again.', controllerEpoch, current, true);
            }
            if (mutating.has(access.nodeid)) return failure(command, 'busy', 'A runtime change is already pending.', controllerEpoch, current, true);
        }

        const wireId = mutation ? command.requestId : crypto.randomUUID();
        if (pending.has(wireId)) return failure(command, 'busy', 'A request with this ID is still pending.', controllerEpoch, current, access.canControl === true);
        const promise = new Promise((resolve) => {
            const item = { resolve, agent, nodeid: access.nodeid, operation: command.operation,
                requestId: command.requestId, sequence: ++sequence, generation: current, mutation, canControl: access.canControl === true };
            item.timer = setTimeout(() => {
                finishPending(wireId, item);
                confirmed.delete(access.nodeid);
                resolve(failure(command, 'outcome-unknown', 'No confirmed response. Refresh status before another change.', controllerEpoch, generation(access.nodeid), item.canControl));
            }, timeoutMs);
            pending.set(wireId, item);
            if (mutation) mutating.add(access.nodeid);
            const outgoing = { action: 'nativeRuntime', version: 1, operation: command.operation, requestId: wireId };
            try { agent.send(JSON.stringify(outgoing)); }
            catch (_) {
                finishPending(wireId, item);
                resolve(failure(command, 'outcome-unknown', 'Agent connection changed. Refresh runtime status.', controllerEpoch, generation(access.nodeid), item.canControl));
            }
        });
        requests.set(key, { fingerprint, promise, expires: now() + 300000 });
        const result = await promise;
        // Authorization is live at completion too. A revoked share or session
        // cannot receive target state after its access ends.
        let finalAccess;
        try { finalAccess = await options.authorize(identity, command); }
        catch (_) { return failure(command, 'access-denied', 'Runtime access expired while the request was pending.'); }
        return { ...result, canControl: finalAccess.canControl === true };
    }

    function close() {
        for (const [id, item] of pending) {
            finishPending(id, item);
            item.resolve(failure(item, 'outcome-unknown', 'Runtime controller stopped.', controllerEpoch, generation(item.nodeid), item.canControl));
        }
        confirmed.clear();
        requests.clear();
        generations.clear();
        mutating.clear();
    }
    return { request, receive, close, controllerEpoch };
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
                res.setHeader('Cache-Control', 'no-cache');
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
