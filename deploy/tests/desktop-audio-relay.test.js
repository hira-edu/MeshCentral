'use strict';

// Guards the fork's meshrelay.js override. It must stay meshcentral@1.2.1's meshrelay.js with one
// change: guest share links that grant desktop also admit desktop audio (relay protocol 20). If the
// npm package is upgraded, re-copy the new release's meshrelay.js, re-apply the line, and update the
// pinned version and hash below together.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UPSTREAM_VERSION = '1.2.1';
const UPSTREAM_SHA256 = 'a74ad89fb88cc1f5ddf82bb2780555512d5f63d36dcd00c11da7d615e2b771c9';
const STOCK_LINE = 'if (cookie.p & 2) { usages.push(2); } // Desktop';
const PATCHED_LINE = 'if (cookie.p & 2) { usages.push(2); usages.push(20); } // Desktop, and desktop audio (relay protocol 20) which inherits the desktop share';

const relayPath = path.join(__dirname, '../meshrelay.js');
const relay = fs.readFileSync(relayPath);

test('the override is the pinned upstream release plus the single desktop-audio line', () => {
    const text = relay.toString('latin1');
    assert.equal(text.split(PATCHED_LINE).length - 1, 1, 'the desktop-audio line appears exactly once');
    assert.equal(text.indexOf(STOCK_LINE), -1, 'the stock desktop line is replaced, not duplicated');
    const restored = Buffer.from(text.replace(PATCHED_LINE, STOCK_LINE), 'latin1');
    assert.equal(crypto.createHash('sha256').update(restored).digest('hex'), UPSTREAM_SHA256,
        'reverting the one line must give meshcentral@' + UPSTREAM_VERSION + "'s meshrelay.js byte for byte");
});

test('the override matches the meshcentral version this deployment installs', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert.equal(pkg.dependencies.meshcentral, UPSTREAM_VERSION,
        'package.json and the meshrelay.js override must name the same meshcentral release');
});

test('only shares that grant desktop admit protocol 20', () => {
    // Evaluate the relay's own share-usage block for each share permission combination.
    const text = relay.toString('utf8');
    const start = text.indexOf('var usages = [];');
    const end = text.indexOf('command.soptions.usages = usages;', start);
    assert(start > 0 && end > start, 'share usage block located');
    // Array.from: arrays built inside the vm belong to another realm, which strict deep equality rejects.
    const usagesFor = p => Array.from(vm.runInNewContext(text.slice(start, end) + ' usages;', { cookie: { p } }));
    assert.deepEqual(usagesFor(2), [2, 20], 'desktop share');
    assert.deepEqual(usagesFor(7), [1, 6, 8, 9, 2, 20, 5, 10], 'terminal + desktop + files share');
    for (const p of [0, 1, 4, 5]) { assert.equal(usagesFor(p).indexOf(20), -1, 'no desktop, no audio (p=' + p + ')'); }
});
