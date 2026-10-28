'use strict';

// Default agent binaries. Fork: the package carries the fork's own MeshAgent builds, and
// agents/agent-defaults.json pins each of them by size and SHA384. Every pinned file is verified when the
// server starts and only verified files are served. Nothing is downloaded and no release check runs
// (upstream 1.3.1 fetched these files from GitHub releases into meshcentral-data/agentbuilds). Agent
// architecture definitions stay in agenttypes.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_SCHEMA = 'meshcentral-fork-agents/1';
const MANIFEST_NAME = 'agent-defaults.json';
// MeshCentral tools shipped as package files. They are not agents and the fork does not build them, so they
// are served from the package as upstream serves them, without a pin.
const TOOL_NAMES = ['MeshCentralRouter.exe', 'MeshCentralRouter.dmg', 'MeshCentralAssistant.exe'];
const SAFE_NAME = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const MAX_FILE_SIZE = 128 * 1024 * 1024;
// Agent binaries by name: every agent file name in the id table, plus the patterns upstream 1.3.1 keeps out
// of the npm package (its agents/.npmignore and agents/check-releases.js).
const AGENT_BINARY_PATTERN = /^(?:meshagent[_-]|MeshService|MeshConsole|MeshAgent-|MeshCmd[^/]*\.exe$)/i;

// The agent file names the id table serves (agenttypes.js localnames, without the "Unknown" placeholder and
// the tools: id 10006 is MeshCentralAssistant.exe).
function agentNames(types) {
    const names = new Set();
    for (const id in types) {
        const name = types[id].localname;
        if ((name !== 'Unknown') && !TOOL_NAMES.includes(name) && SAFE_NAME.test(name)) names.add(name);
    }
    return names;
}

// True for a package path (as npm lists it) that holds an agent binary: a direct child of agents/ named like
// one, or anything in an agents/agents_<name>/ folder of test builds.
function isAgentBinaryPath(packagePath, names) {
    const match = /^agents\/(.+)$/.exec(packagePath);
    if (!match) return false;
    if (/^agents_[^/]+\//.test(match[1])) return true;
    if (match[1].includes('/')) return false;
    return names.has(match[1]) || AGENT_BINARY_PATTERN.test(match[1]);
}

// Parses a fork agent manifest: { schema, build: { repository, commit }, files: [{ filename, size, sha384 }] }.
// Returns { build, files } with files as a Map by file name, or throws naming the fault. A manifest that pins
// nothing (build null, files empty) parses; the server and the release gate refuse it, pack.js reports it.
function parseManifest(manifest, names) {
    if ((manifest == null) || (typeof manifest !== 'object') || Array.isArray(manifest) || (manifest.schema !== MANIFEST_SCHEMA)) throw new Error('not a fork agent manifest (schema "' + MANIFEST_SCHEMA + '").');
    const extra = Object.keys(manifest).filter(key => !['schema', 'build', 'files'].includes(key));
    if (extra.length) throw new Error('unknown manifest field ' + extra.join(', ') + '.');
    if (!Array.isArray(manifest.files) || (manifest.files.length > 64)) throw new Error('"files" must list at most 64 pinned agent binaries.');
    let build = null;
    if (manifest.files.length === 0) {
        if (manifest.build !== null) throw new Error('"build" must be null when no agent binary is pinned.');
    } else {
        const value = manifest.build;
        if ((value == null) || (typeof value !== 'object') || Array.isArray(value) || (Object.keys(value).sort().join(',') !== 'commit,repository') ||
            (typeof value.repository !== 'string') || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value.repository) ||
            (typeof value.commit !== 'string') || !/^[0-9a-f]{40}$/.test(value.commit)) throw new Error('"build" must name the MeshAgent repository (owner/name) and the full commit the binaries were built from.');
        build = { repository: value.repository, commit: value.commit };
    }
    const files = new Map(), lower = new Set();
    for (const file of manifest.files) {
        if ((file == null) || (typeof file !== 'object') || (typeof file.filename !== 'string') || !SAFE_NAME.test(file.filename)) throw new Error('invalid pinned file name.');
        if (!names.has(file.filename)) throw new Error(file.filename + ' is not an agent file name in agenttypes.js.');
        if (lower.has(file.filename.toLowerCase())) throw new Error(file.filename + ' is pinned more than once.');
        if ((Object.keys(file).sort().join(',') !== 'filename,sha384,size') || !Number.isSafeInteger(file.size) || (file.size <= 0) || (file.size > MAX_FILE_SIZE) ||
            (typeof file.sha384 !== 'string') || !/^[0-9a-f]{96}$/.test(file.sha384)) throw new Error('invalid size or SHA384 for pinned file ' + file.filename + '.');
        lower.add(file.filename.toLowerCase());
        files.set(file.filename, { filename: file.filename, size: file.size, sha384: file.sha384 });
    }
    return { build, files };
}

// Checks one file against its pin. Returns null when it matches, otherwise why it does not. The file must be
// a regular file (not a link), keep its size, and not change while it is read.
async function verifyFile(filename, file) {
    let handle;
    try {
        let entry;
        try { entry = await fs.promises.lstat(filename); } catch (ex) { if (ex.code === 'ENOENT') return 'the file is missing'; throw ex; }
        if (!entry.isFile()) return 'not a regular file';
        if (entry.size !== file.size) return entry.size + ' bytes, pinned ' + file.size;
        handle = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
        const stat = await handle.stat();
        if (!stat.isFile() || (stat.size !== file.size)) return 'the file changed while it was checked';
        const hash = crypto.createHash('sha384');
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat();
        if ((stat.size !== after.size) || (stat.mtimeMs !== after.mtimeMs) || (stat.ctimeMs !== after.ctimeMs)) return 'the file changed while it was checked';
        const digest = hash.digest('hex');
        return (digest === file.sha384) ? null : ('SHA384 ' + digest + ', pinned ' + file.sha384);
    } finally { if (handle) await handle.close(); }
}

// The default agent binaries of this server, as meshcentral.js uses them (prepare, start, sourcePath, info,
// activate, status). options.directory is the folder holding the binaries (the package agents folder) and
// options.manifest the pin file (agents/agent-defaults.json).
function CreateAgentDefaults(parent, options = {}) {
    const bundled = options.directory || path.join(__dirname, 'agents');
    const manifestPath = options.manifest || path.join(__dirname, 'agents', MANIFEST_NAME);
    const log = options.log || (message => console.error(message));
    const settings = (parent.config && parent.config.settings) || {};
    const agents = agentNames(parent.meshAgentsArchitectureNumbers), tools = new Set(TOOL_NAMES);
    const served = new Set([...agents, ...tools]);
    const ready = new Map(), entries = new Map();
    let busy = null, errors = [], loaded = false, activating = null, activePaths = null, build = null;

    function regular(filename) {
        try { return fs.lstatSync(filename).isFile(); } catch (ex) { if ((ex.code === 'ENOENT') || (ex.code === 'ENOTDIR')) return false; throw ex; }
    }
    // Where a name resolves right now: a pinned file once it verified, or a package tool. An agent file the
    // manifest does not pin is never served, even when the package holds a file of that name.
    function current(name) {
        if (entries.has(name)) return ready.has(name) ? ready.get(name) : null;
        if (tools.has(name)) { const file = path.join(bundled, name); return regular(file) ? file : null; }
        return null;
    }
    function sourcePath(name) {
        if (!served.has(name)) return null;
        return activePaths ? activePaths.get(name) : current(name);
    }
    function changed() {
        return Array.from(served).some(name => activePaths.get(name) !== current(name));
    }
    // Swap in what changed since the paths were frozen. The server calls this at the start of an
    // activation pass so signing and the table rebuild see the same files.
    function activate() {
        if (!activePaths || !changed()) return false;
        activePaths = new Map(Array.from(served, name => [name, current(name)]));
        return true;
    }
    function notify() {
        if (typeof parent.activateAgentDefaults !== 'function') { activate(); return; }
        const task = new Promise(resolve => parent.activateAgentDefaults(resolve))
            .catch(ex => log('Unable to load the verified agent binaries: ' + ((ex && ex.message) || ex)))
            .finally(() => { if (activating === task) activating = null; });
        activating = task;
    }
    // settings.agentDownloads configured GitHub release downloads upstream. Only "enabled: false", which is
    // what the fork does anyway, is accepted; anything else would ask for binaries this server never serves.
    function settingsErrors() {
        const value = settings.agentdownloads;
        if (value == null) return [];
        if ((typeof value === 'object') && !Array.isArray(value) && Object.keys(value).every(key => (key === 'enabled') && (value.enabled === false))) return [];
        return ['settings.agentDownloads is not supported: this server serves only the fork agent binaries pinned in ' + manifestPath + ' and never downloads agents. Remove the setting.'];
    }
    async function load() {
        const stat = await fs.promises.lstat(manifestPath);
        if (!stat.isFile() || (stat.size > 1024 * 1024)) throw new Error('not a regular file of at most 1 MiB.');
        const parsed = parseManifest(JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')), agents);
        build = parsed.build;
        entries.clear();
        for (const [name, file] of parsed.files) entries.set(name, Object.assign({}, file, { status: 'Not checked' }));
        loaded = true;
    }
    function prepare() {
        if (busy) return busy;
        busy = (async function () {
            errors = settingsErrors();
            try { if (!loaded) await load(); }
            catch (ex) { errors.push('Unable to read the fork agent manifest ' + manifestPath + ': ' + ex.message + ' No agent binary is served.'); return; }
            if (entries.size === 0) errors.push(manifestPath + ' pins no agent binaries, so none is served. Pin the fork MeshAgent builds (agents/release-manifest.js) before running this package.');
            for (const file of entries.values()) {
                if (ready.has(file.filename)) continue;
                delete file.error;
                const target = path.join(bundled, file.filename);
                let reason;
                try { reason = await verifyFile(target, file); } catch (ex) { reason = ex.message; }
                if (reason == null) { ready.set(file.filename, target); file.status = 'Ready'; continue; }
                file.status = 'Unavailable'; file.error = reason;
                errors.push(file.filename + ': ' + target + ' does not match its pin (' + reason + '), so it is not served.');
            }
            // Files that verified after start() froze the paths are switched in by the server, not by a restart.
            if (activePaths && changed()) notify();
        })().finally(() => { busy = null; });
        return busy;
    }
    function status() {
        return {
            busy: !!busy, activating: !!activating, enabled: false, source: 'package', manifest: manifestPath,
            build: build ? Object.assign({}, build) : null, errors: errors.slice(), updates: null,
            files: Array.from(entries.values(), file => Object.assign({}, file))
        };
    }
    function info(name) {
        const file = entries.get(name);
        if (!file || !ready.has(name) || (activePaths && (activePaths.get(name) !== ready.get(name)))) return null;
        return { repository: build.repository, commit: build.commit, sha384: file.sha384 };
    }
    function start() {
        // Signing and table loading must see the same files from here on.
        if (!activePaths) activePaths = new Map(Array.from(served, name => [name, current(name)]));
    }
    return { prepare, status, sourcePath, info, start, activate };
}

module.exports = { CreateAgentDefaults, parseManifest, verifyFile, agentNames, isAgentBinaryPath, MANIFEST_SCHEMA, MANIFEST_NAME, TOOL_NAMES };
