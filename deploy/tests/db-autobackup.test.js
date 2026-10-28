'use strict';

// Guards the autobackup zip step of the fork's db.js (upstream 1.3.1 #8098: @zip.js/zip.js with
// fs.promises.glob instead of archiver). Production runs autobackup every 24 hours with skip globs.
// The zip step needs fs.promises.glob, which Node 22 added; on Node 20 every backup fails and old
// backups are never pruned. This test runs the real createBackupfile and removeExpiredBackupfiles
// on a NeDB data folder in a temporary directory, so it fails on a Node that cannot back up.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const repoRoot = path.join(__dirname, '../..');
const deployRequire = createRequire(path.join(__dirname, '..', 'package.json'));

// Load the package's db.js with its relative requires from the repository and its dependencies
// (NeDB, @zip.js/zip.js) from the deployment.
function loadDbJs() {
    const file = path.join(repoRoot, 'db.js');
    const wrapper = vm.runInThisContext('(function (exports, require, module, __filename, __dirname) {' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file });
    const module = { exports: {} };
    wrapper(module.exports, name => name.startsWith('./') ? require(path.join(repoRoot, name)) : deployRequire(name), module, file, repoRoot);
    return module.exports;
}

// File names in a zip, from its central directory.
function zipEntries(file) {
    const data = fs.readFileSync(file);
    const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert(end >= 0, 'zip end of central directory found');
    const count = data.readUInt16LE(end + 10);
    let offset = data.readUInt32LE(end + 16);
    const names = [];
    for (let i = 0; i < count; i++) {
        assert.equal(data.readUInt32LE(offset), 0x02014b50, 'central directory entry');
        const nameLength = data.readUInt16LE(offset + 28), extraLength = data.readUInt16LE(offset + 30), commentLength = data.readUInt16LE(offset + 32);
        names.push(data.toString('utf8', offset + 46, offset + 46 + nameLength));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return names.sort();
}

test('autobackup zips the data folder, honours the skip globs and prunes expired backups', async (t) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-autobackup-'));
    t.after(() => fs.rmSync(work, { recursive: true, force: true }));
    const datapath = path.join(work, 'meshcentral-data');
    const backuppath = path.join(work, 'meshcentral-backups');
    fs.mkdirSync(path.join(datapath, 'signedagents'), { recursive: true });
    fs.mkdirSync(backuppath);
    fs.writeFileSync(path.join(datapath, 'signedagents', 'skipped.bin'), 'skipped');
    fs.writeFileSync(path.join(datapath, 'kept.txt'), 'kept');
    const expired = path.join(backuppath, 'meshcentral-autobackup-2020-01-01-00-00.zip');
    fs.writeFileSync(expired, 'expired');

    const warnings = [];
    const parent = {
        args: {}, datapath, parentpath: work, backuppath, platform: process.platform, crypto: require('node:crypto'),
        config: { settings: { autobackup: { backupname: 'meshcentral-autobackup-', zipcompression: 5, keeplastdaysbackup: 14, backupskipfoldersglob: ['**/signedagents'] } }, domains: { '': {} } },
        debug: function () { }, addServerWarning: m => warnings.push(String(m)), getConfigFilePath: f => path.join(datapath, f),
        webserver: { meshes: {}, users: {}, userGroups: {} }, DispatchEvent: function () { }
    };
    const db = await new Promise(resolve => loadDbJs().CreateDB(parent, resolve));
    // db.js starts daily NeDB compaction timers; stop them so the test process can exit.
    t.after(() => { for (const store of [db.file, db.eventsfile, db.powerfile, db.serverstatsfile, db.pluginsfile]) { if (store) { store.stopAutocompaction(); } } });
    await new Promise(resolve => db.SetupDatabase(resolve));
    await new Promise(resolve => db.Set({ _id: 'user//admin', type: 'user', domain: '', name: 'admin' }, resolve));

    const messages = [];
    const zip = path.join(backuppath, 'meshcentral-autobackup-2026-10-29-00-00.zip');
    await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('autobackup did not finish: ' + JSON.stringify(messages))), 20000);
        db.newAutoBackupFile = zip; db.newDBDumpFile = null; db.backupStatus = 0; db.performingBackup = true;
        db.createBackupfile(function (m) {
            messages.push(String(m));
            if (/^Checked \d+ candidates/.test(m) || /^(Zipbackup|Backup) failed/.test(m)) { clearTimeout(deadline); resolve(); }
        });
    });

    assert.equal(typeof fs.promises.glob, 'function', 'db.js autobackup (upstream 1.3.1 #8098) needs fs.promises.glob, which Node ' + process.version +
        ' does not have (Node 22 or later); messages: ' + JSON.stringify(messages));
    assert.deepEqual(messages.filter(m => /error|fail|warning/i.test(m)), [], 'no backup error');
    assert.equal(messages.filter(m => m.startsWith('Auto-backup completed: ' + zip)).length, 1);
    assert.deepEqual(warnings, []);
    assert.equal(db.performingBackup, false);
    const entries = zipEntries(zip);
    assert(entries.includes('meshcentral-data/kept.txt') && entries.includes('meshcentral-data/meshcentral.db'), 'data folder zipped: ' + entries.join(', '));
    assert.deepEqual(entries.filter(e => e.includes('signedagents')), [], 'backupskipfoldersglob honoured');
    assert.equal(fs.existsSync(expired), false, 'the expired backup was removed');
    assert.equal(fs.existsSync(zip), true, 'the new backup is kept');
});
