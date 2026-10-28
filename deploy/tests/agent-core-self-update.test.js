'use strict';

// The JavaScript self-update in agents/meshcore.js and agents/recoverycore.js only replaces the agent
// on Linux and FreeBSD. Every other platform must refuse before downloading anything, not download,
// hash and then refuse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../agents', name), 'utf8').replace(/\r\n?/g, '\n');
const cores = { meshcore: read('meshcore.js'), recoverycore: read('recoverycore.js') };

function extractFunction(text, signature) {
    const start = text.indexOf(signature);
    assert(start >= 0, 'missing function: ' + signature);
    let depth = 0;
    for (let i = text.indexOf('{', start); i < text.length; ++i) {
        if (text[i] === '{') { depth++; }
        if (text[i] === '}' && --depth === 0) { return text.slice(start, i + 1); }
    }
    throw new Error('unterminated function: ' + signature);
}

const HASH = 'ab'.repeat(48);

function run(core, platform) {
    const state = { console: [], messages: [], commands: [], downloads: [] };
    const sandbox = {
        process: { platform, execPath: '/usr/local/mesh/meshagent' },
        sendConsoleText(text) { state.console.push(String(text)); },
        sendAgentMessage(text) { state.messages.push(String(text)); },
        getServerTargetUrlEx(url) { return url; },
        require(name) {
            switch (name) {
                case 'MeshAgent': return { ARCHID: 6, serviceName: 'meshagent', SendCommand(cmd) { state.commands.push(cmd.action); } };
                case 'service-manager': return { manager: { getService() { return { isMe: () => true }; } } };
                case 'http': return { parseUri: () => ({}) };
                case 'https': return { get(options) { state.downloads.push(options); return new EventEmitter(); } };
                default: throw new Error('unexpected require: ' + name);
            }
        }
    };
    const text = cores[core];
    vm.runInNewContext(extractFunction(text, 'function agentUpdate_ReportFailure(') + '\n' + extractFunction(text, 'function agentUpdate_Start('), sandbox);
    sandbox.agentUpdate_Start('https://server/meshagents?id=6', { hash: HASH, sessionid: 's-1' });
    return state;
}

for (const core of Object.keys(cores)) {
    for (const platform of ['darwin', 'android']) {
        test(core + ' ' + platform + ': self-update is refused before any download', () => {
            const state = run(core, platform);
            assert.deepEqual(state.downloads, [], 'nothing is downloaded');
            assert.deepEqual(state.console, ['Self Update disabled for this platform; native service lifecycle is required.']);
            assert.deepEqual(state.commands, ['agentupdatefailed']);
        });
    }

    test(core + ' win32: native update owns Windows, nothing is downloaded', () => {
        const state = run(core, 'win32');
        assert.deepEqual(state.downloads, []);
        assert.match(state.console[0], /Windows JavaScript self-update is disabled/);
    });

    for (const platform of ['linux', 'freebsd']) {
        test(core + ' ' + platform + ': self-update downloads the update', () => {
            const state = run(core, platform);
            assert.equal(state.downloads.length, 1);
            assert.deepEqual(state.commands, []);
        });
    }

    test(core + ': the post-download refusal is gone', () => {
        const afterDownload = cores[core].slice(cores[core].indexOf("SendCommand({ action: 'agentupdatedownloaded' })"));
        assert.doesNotMatch(afterDownload.slice(0, afterDownload.indexOf('Updating and restarting agent...')), /Self Update disabled for this platform/);
    });
}

test('after the download only Linux and FreeBSD replacement remains', () => {
    const source = cores.meshcore;
    const restart = source.slice(source.indexOf("if (sessionid != null) { sendConsoleText('Updating and restarting agent...', sessionid); }"));
    const platformSwitch = restart.slice(restart.indexOf('switch (process.platform) {'), restart.indexOf('img.pipe(this._file);'));
    assert.match(platformSwitch, /case 'freebsd':[\s\S]*case 'linux':/);
    assert.doesNotMatch(platformSwitch, /default:|service-manager/, 'no service-restart branch for platforms that never get here');
});
