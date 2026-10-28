'use strict';

// Windows terminal plumbing in both agent cores after the win-dispatcher removal (D9): no code may
// still re-add modules at run time, look for a dispatcher, or report ConPTY support (win-virtual-terminal
// is the console bridge, so its `supported` flag is always true on Windows and says nothing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CORES = ['meshcore.js', 'recoverycore.js'];
const sources = {};
for (const core of CORES) { sources[core] = fs.readFileSync(path.join(__dirname, '../../agents', core), 'utf8').replace(/\r\n?/g, '\n'); }

function extractBlock(source, marker) {
    const start = source.indexOf(marker);
    assert(start >= 0, 'missing: ' + marker);
    assert.equal(source.indexOf(marker, start + 1), -1, 'must be unique: ' + marker);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; ++i) {
        if (source[i] === '{') { depth++; }
        if (source[i] === '}' && --depth === 0) { return source.slice(start, i + 1); }
    }
    throw new Error('unterminated block: ' + marker);
}

const forbidden = () => { throw new Error('the core must not re-add modules at run time'); };

for (const core of CORES) {
    test(core + ': no dispatcher or run-time module re-add remains', () => {
        for (const text of ['_dispatcher', 'win-dispatcher', 'windows_add_js_module', 'terminal_windows_prepare_modules', 'ConPTY']) {
            assert.equal(sources[core].indexOf(text), -1, core + ' still contains ' + text);
        }
    });

    test(core + ': osinfo prints the OS name only', () => {
        const printed = [];
        const sandbox = {
            process: { platform: 'win32' }, parseInt, addModule: forbidden, getJSModule: forbidden,
            sendConsoleText(text, sessionid) { printed.push([text, sessionid]); },
            require(name) {
                assert.equal(name, 'os');
                return { name() { const pr = { then(callback) { callback.call(pr, 'Windows 11 Pro'); } }; return pr; } };
            }
        };
        vm.runInNewContext('function osinfo(args, sessionid) { var response = null; switch (\'osinfo\') {\n' + extractBlock(sources[core], "case 'osinfo': {") + '\n} return response; }', sandbox);
        sandbox.osinfo({ _: [] }, 'console-1');
        assert.deepEqual(printed, [['OS: Windows 11 Pro', 'console-1']]);
    });

    test(core + ': a terminal size change on Windows is ignored without a dispatcher, and applied elsewhere', () => {
        const program = 'function control(ws, obj) { switch (obj.type) {\n' + extractBlock(sources[core], "case 'termsize': {") + '\n} }';
        const windows = { process: { platform: 'win32' } };
        vm.runInNewContext(program, windows);
        const request = {};
        Object.defineProperty(request, '_dispatcher', { get() { throw new Error('dispatcher looked up'); } });
        windows.control({ httprequest: request }, { type: 'termsize', cols: 120, rows: 40 });

        const linux = { process: { platform: 'linux' } };
        vm.runInNewContext(program, linux);
        const sizes = [];
        linux.control({ httprequest: { process: { pty: 1, tcsetsize(rows, cols) { sizes.push([rows, cols]); } } } }, { type: 'termsize', cols: 120, rows: 40 });
        assert.deepEqual(sizes, [[40, 120]]);
    });
}
