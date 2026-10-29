'use strict';

// The viewer renders an agent console message with msgid 2 as the fixed text "Denied" and discards the agent's
// own text (views/*.handlebars formatAgentConsoleMessage). That hid the 2026-10-29 terminal regression: every
// bridge failure looked like a refusal. msgid 2 is for a local user refusing consent only; a terminal that fails
// to start, or whose bridge fails, sends its error text without a msgid so the viewer shows it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n?/g, '\n');
const meshcore = read('agents/meshcore.js');
const recoverycore = read('agents/recoverycore.js');

function functionSource(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, 'missing function ' + name);
    const end = source.indexOf('\n}\n', start);
    return source.slice(start, end + 2);
}

// The function each msgid 2 sender sits in: the nearest preceding top-level function declaration.
function enclosingFunctions(source) {
    const names = [];
    let index = source.indexOf('msgid: 2');
    while (index >= 0) {
        const before = source.slice(0, index);
        const match = [...before.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)].pop();
        names.push(match ? match[1] : '(top level)');
        index = source.indexOf('msgid: 2', index + 1);
    }
    return names;
}

test('agent core: msgid 2 ("Denied") is sent only by consent refusals', () => {
    const allowed = ['terminal_consent_ask', 'terminal_promise_consent_rejected', 'kvm_consentpromise_rejected',
        'files_consentpromise_rejected', 'registry_consentpromise_rejected'];
    for (const name of enclosingFunctions(meshcore)) {
        assert.ok(allowed.includes(name), 'meshcore.js sends msgid 2 from ' + name + ', which is not a consent refusal');
    }
});

test('recovery core: a terminal failure is never sent as msgid 2', () => {
    assert.deepEqual(enclosingFunctions(recoverycore), [], 'recoverycore.js has no consent prompt, so nothing there is a refusal');
});

test('a terminal that fails to start sends its error text without a msgid', () => {
    const sent = [];
    const sandbox = { JSON };
    vm.runInNewContext(functionSource(meshcore, 'terminal_promise_connection_rejected'), sandbox);
    const ws = { write: data => sent.push(JSON.parse(data)), end: () => sent.push('end') };
    sandbox.terminal_promise_connection_rejected.call({ ws }, 'Failed to start remote terminal session, Error: no active user session found');
    assert.deepEqual(sent, [{ ctrlChannel: '102938', type: 'console', msg: 'Failed to start remote terminal session, Error: no active user session found' }, 'end']);
});

test('a failing terminal bridge sends its error text without a msgid', () => {
    const resolved = functionSource(meshcore, 'terminal_promise_connection_resolved');
    const handler = resolved.match(/term\.on\('error', function \(error\) \{[\s\S]*?\n {8}\}\);/);
    assert.ok(handler, 'terminal_promise_connection_resolved registers an error handler on the Windows terminal');
    assert.ok(!/msgid\s*:/.test(handler[0]), 'the bridge error handler must not send a msgid');
    assert.match(handler[0], /msg: 'Remote terminal session failed, ' \+ error\.toString\(\)/);
});

test('the viewer shows the agent text when there is no msgid, and "Denied" for msgid 2', () => {
    for (const view of ['default3', 'default', 'default-mobile', 'sharing', 'sharing-mobile']) {
        const source = read('views/' + view + '.handlebars');
        const table = source.match(/var agentConsoleMessages = (\[[^\n]*\]);/);
        const formatter = source.match(/function formatAgentConsoleMessage\(msg, msgid, msgargs\) \{[\s\S]*?\n\s*\}/);
        assert.ok(table && formatter, view + ': agentConsoleMessages and formatAgentConsoleMessage');
        const sandbox = {
            EscapeHtml: text => String(text),
            format: (text, a, b, c) => String(text).replace('{0}', a).replace('{1}', b).replace('{2}', c)
        };
        vm.runInNewContext('var agentConsoleMessages = ' + table[1] + ';\n' + formatter[0], sandbox);
        assert.match(sandbox.formatAgentConsoleMessage('Remote terminal session failed, Error: x', undefined, undefined), /Remote terminal session failed, Error: x/, view);
        assert.match(sandbox.formatAgentConsoleMessage('ignored', 2, undefined), /^Denied/, view);
    }
});
