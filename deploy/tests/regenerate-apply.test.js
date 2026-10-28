'use strict';
// regenerate.js apply(): a failed write restores every original. The undo of a file that did not exist before
// must treat ENOTDIR like ENOENT: Linux reports ENOTDIR for a path through a regular file (Windows reports
// ENOENT), and such a path cannot exist. Found by MeshAgent CI on Linux (meshcentral_regenerate_runtime DEP-5).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const regenerate = require('../scripts/regenerate.js');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'regen-apply-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'a.txt'), 'original a');
    fs.writeFileSync(path.join(root, 'gone.txt'), 'original gone');
    fs.writeFileSync(path.join(root, 'sub'), 'a file where a directory is needed');
    const generated = new Map([['a.txt', Buffer.from('new a')], ['sub/c.txt', Buffer.from('new c')]]);
    return {
        root, results: { views: { generated, committed: ['a.txt', 'gone.txt'] } },
        report: { views: { files: { 'a.txt': 'differ', 'gone.txt': 'missing', 'sub/c.txt': 'extra' } } }
    };
}

// Makes fs.rmSync answer ENOTDIR (as Linux does) for any path under root/sub, on every platform.
function linuxNotDir(t, root) {
    const real = fs.rmSync;
    fs.rmSync = function (target) {
        if (path.resolve(target).startsWith(path.join(root, 'sub') + path.sep)) {
            const error = new Error("ENOTDIR: not a directory, lstat '" + target + "'"); error.code = 'ENOTDIR'; throw error;
        }
        return real.apply(this, arguments);
    };
    t.after(() => { fs.rmSync = real; });
}

test('a failed write restores every original (as the platform reports it)', (t) => {
    const f = fixture(t);
    assert.throws(() => regenerate.apply(f.results, f.report, f.root), /every file restored/);
    assert.strictEqual(fs.readFileSync(path.join(f.root, 'a.txt'), 'utf8'), 'original a');
    assert.strictEqual(fs.readFileSync(path.join(f.root, 'gone.txt'), 'utf8'), 'original gone');
});

test('a failed write restores every original when the undo sees ENOTDIR (Linux)', (t) => {
    const f = fixture(t);
    linuxNotDir(t, f.root);
    assert.throws(() => regenerate.apply(f.results, f.report, f.root), /every file restored/);
    assert.strictEqual(fs.readFileSync(path.join(f.root, 'a.txt'), 'utf8'), 'original a');
    assert.strictEqual(fs.readFileSync(path.join(f.root, 'gone.txt'), 'utf8'), 'original gone');
    assert.ok(!fs.existsSync(path.join(f.root, 'a.txt.regen-tmp')), 'temporary file left behind');
});

test('any other undo error is still reported by path', (t) => {
    const f = fixture(t);
    const real = fs.rmSync;
    fs.rmSync = function (target) {
        if (path.resolve(target) === path.join(f.root, 'sub', 'c.txt')) { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
        return real.apply(this, arguments);
    };
    t.after(() => { fs.rmSync = real; });
    assert.throws(() => regenerate.apply(f.results, f.report, f.root), (error) =>
        /could not be restored/.test(error.message) && error.message.includes(path.join(f.root, 'sub', 'c.txt')) && /EACCES/.test(error.message));
});
