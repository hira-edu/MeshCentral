'use strict';

// The recovery core's console commands (agents/recoverycore.js processConsoleCommand). The recovery
// core module list carries no umhctl and the native agent does not embed it, so the core must not
// offer an umhctl command that can only fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../agents/recoverycore.js'), 'utf8').replace(/\r\n?/g, '\n');

function extractFunction(signature) {
    const start = source.indexOf(signature);
    assert(start >= 0, 'missing function: ' + signature);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; ++i) {
        if (source[i] === '{') { depth++; }
        if (source[i] === '}' && --depth === 0) { return source.slice(start, i + 1); }
    }
    throw new Error('unterminated function: ' + signature);
}

function consoleCommand(cmd) {
    const printed = [];
    const sandbox = {
        process: { platform: 'win32' }, JSON, console: { log() { } },
        sendConsoleText(text) { printed.push(String(text)); },
        require(name) { throw new Error('module not available in the recovery core: ' + name); }
    };
    vm.runInNewContext(extractFunction('function processConsoleCommand(cmd, args, rights, sessionid) {'), sandbox);
    sandbox.processConsoleCommand(cmd, { _: [] }, 0xFFFFFFFF, 'console-1');
    return printed;
}

test('recovery help lists no umhctl command', () => {
    const [help] = consoleCommand('help');
    assert.match(help, /^Available commands are: /);
    assert.doesNotMatch(help, /umhctl/);
});

test('umhctl is an unknown command in the recovery core', () => {
    assert.deepEqual(consoleCommand('umhctl'), ['Unknown command "umhctl", type "help" for list of available commands.']);
});
