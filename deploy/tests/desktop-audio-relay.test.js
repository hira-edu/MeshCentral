'use strict';

// Guards the fork's meshrelay.js. It must stay meshcentral@1.2.5's meshrelay.js (the npm bytes) with
// only the reviewed fork changes below. If the package is upgraded, take the new release's
// meshrelay.js, re-apply each reviewed change, and update the pinned version and hash together.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UPSTREAM_VERSION = '1.2.5';
const UPSTREAM_SHA256 = '21cae91e1ccb74f29b408d3b78778e3377b22c8496b00bd402ed9470e095206c';
// Each reviewed fork change as [upstream text, fork text]; each fork text must appear exactly once.
const REVIEWED_CHANGES = [
    // Guest share links that grant desktop also admit desktop audio (relay protocol 20), 2747ad90d.
    ['if (cookie.p & 2) { usages.push(2); } // Desktop',
        'if (cookie.p & 2) { usages.push(2); usages.push(20); } // Desktop, and desktop audio (relay protocol 20) which inherits the desktop share']
];

const relayPath = path.join(__dirname, '../../meshrelay.js');
const relay = fs.readFileSync(relayPath);

test('the override is the pinned upstream release plus only the reviewed fork changes', () => {
    let text = relay.toString('latin1');
    for (const [stock, patched] of REVIEWED_CHANGES) {
        assert.equal(text.split(patched).length - 1, 1, 'the fork change appears exactly once: ' + patched);
        assert.equal(text.split(stock).length - 1, patched.split(stock).length - 1,
            'the upstream text appears only inside the fork change, not duplicated: ' + stock);
        text = text.replace(patched, stock);
    }
    assert.equal(crypto.createHash('sha256').update(Buffer.from(text, 'latin1')).digest('hex'), UPSTREAM_SHA256,
        'reverting the reviewed changes must give meshcentral@' + UPSTREAM_VERSION + "'s meshrelay.js byte for byte");
});

test('the override matches the meshcentral version this deployment installs', () => {
    // The fork package at the repo root is what this deployment installs (deploy/package.json depends on its tarball).
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    assert.equal(pkg.version, UPSTREAM_VERSION,
        'the packaged meshcentral release and the meshrelay.js override must be the same release');
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
