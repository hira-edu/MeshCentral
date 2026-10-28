'use strict';

// The desktop privacy bar while desktop audio starts or stops (agents/meshcore.js
// desktop_audio_updateBar). The bar is replaced to show the audio state; a desktop session that shows a
// privacy bar must never continue without one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(path.join(__dirname, '../../agents/meshcore.js'), 'utf8').replace(/\r\n?/g, '\n');

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

function setup(options) {
    const order = [], logs = [];
    const oldBar = new EventEmitter();
    oldBar.audio = false;
    oldBar.close = () => order.push('close old bar');
    oldBar.on('close', () => order.push('old close listener ran'));
    const kvm = { rusers: ['Alice'], users: ['alice'], connectionBar: oldBar, _pipedStreams: [{ end() { order.push('end piped stream'); } }], end() { order.push('end kvm'); } };
    const desktop = { remoteaddr: '198.51.100.7', privacybartext: 'Sharing desktop with: {0}', desktop: { kvm, tunnel: { tsid: 1 } } };
    oldBar.httprequest = desktop;
    const sandbox = {
        color_options: {},
        currentTranslation: { privacyBarAudio: 'audio on' },
        desktop_audio_findDesktop: () => desktop,
        desktop_audio_listeners: () => 1,
        MeshServerLogEx(msgid) { logs.push(msgid); },
        require(name) {
            assert.equal(name, 'notifybar-desktop');
            return (text, tsid) => {
                if (options.fail) { order.push('bar failed'); throw new Error('no bar'); }
                order.push('create new bar');
                const bar = new EventEmitter();
                bar.text = text; bar.tsid = tsid; bar.close = () => order.push('close new bar');
                return bar;
            };
        }
    };
    const functions = ['function desktop_audio_updateBar(tsid)', 'function desktop_audio_barClosed()', 'function desktop_audio_endDesktop(request)'];
    vm.runInNewContext(functions.map(extractFunction).join('\n'), sandbox);
    return { sandbox, order, logs, kvm, oldBar, desktop };
}

test('the new bar is shown before the old one closes', () => {
    const run = setup({});
    run.sandbox.desktop_audio_updateBar(1);
    assert.deepEqual(run.order, ['create new bar', 'close old bar']);
    const bar = run.kvm.connectionBar;
    assert.notEqual(bar, run.oldBar);
    assert.equal(bar.text, 'Sharing desktop with: Alice - audio on');
    assert.equal(bar.tsid, 1);
    assert.equal(bar.audio, true);
    assert.equal(bar.httprequest, run.desktop);
    assert.deepEqual(run.logs, [31]);
    run.oldBar.emit('close');
    assert.deepEqual(run.order, ['create new bar', 'close old bar'], 'closing the replaced bar does not end the session');
    bar.emit('close');
    assert.deepEqual(run.order.slice(2), ['end piped stream', 'end kvm'], 'the local user closing the new bar ends the session');
});

test('when no new bar can be shown, the desktop session ends', () => {
    const run = setup({ fail: true });
    run.sandbox.desktop_audio_updateBar(1);
    assert.deepEqual(run.order, ['bar failed', 'close old bar', 'end piped stream', 'end kvm']);
    assert.equal(run.kvm.connectionBar, null);
    assert.deepEqual(run.logs, [32]);
});
