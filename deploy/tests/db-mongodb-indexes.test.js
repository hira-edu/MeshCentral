'use strict';

// Guards what the fork's db.js (upstream 1.3.1, #8158) does to the indexes of an existing
// production MongoDB database when it starts, and keeps the rollback drop list honest.
//
// 1.3.1 creates only missing indexes and never resets a collection. 1.2.5 (the release before the
// Stage 6 merge) resets the main, events and power indexes whenever their count differs from its
// own set, so rolling back to 1.2.5 after 1.3.1 has started rebuilds those indexes. Dropping
// ROLLBACK_DROP_LIST before starting 1.2.5 avoids that reset. If an upgrade adds or removes an
// index, this test fails and the rollback procedure (MeshAgent docs/DEPLOYMENT.md) must change too.
//
// db.js runs against an in-memory MongoDB driver double that records every index call; no
// database is opened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const repoRoot = path.join(__dirname, '../..');
const deployRequire = createRequire(path.join(__dirname, '..', 'package.json'));

// The index set meshcentral@1.2.5 creates and expects (db.js 1.2.5, MongoDB branch), without _id_.
const INDEXES_1_2_5 = {
    meshcentral: ['AmtUuid1', 'Email1', 'Mesh1', 'TypeDomainMesh1'],
    events: ['DomainNodeTime1', 'ExpireTime1', 'IdsAndTime1', 'UseridAction1'],
    power: ['ExpireTime1', 'NodeIdAndTime1'],
    serverstats: ['ExpireTime1', 'ExpireTime2']
};
// What the fork's db.js adds on top of 1.2.5's set on its first start: drop exactly these before
// starting 1.2.5 again and 1.2.5 starts without resetting any collection.
const ROLLBACK_DROP_LIST = {
    meshcentral: ['Domain1', 'TypeDomainIdNameCollation1', 'TypeDomainMeshNameCollation1', 'TypeDomainNode1'],
    events: ['DomainIdsTime1', 'DomainUserActionTime1', 'DomainUserTime1'],
    power: ['Domain1'],
    plugins: ['TypeAndName1']
};
const TTL = { events: 1728000, power: 864000, serverstats: 2592000 }; // db.js defaults (20, 10 and 30 days)

function fakeMongo(existing) {
    const calls = [];
    const collections = {};
    function collection(name) {
        if (collections[name]) { return collections[name]; }
        const indexes = [{ name: '_id_', key: { _id: 1 } }].concat(existing[name] || []);
        const c = {
            indexes: function (cb) { setImmediate(cb, null, indexes.slice()); },
            createIndex: function (key, options) { calls.push({ op: 'createIndex', collection: name, name: options.name, key, options }); return Promise.resolve(options.name); },
            dropIndexes: function (cb) { calls.push({ op: 'dropIndexes', collection: name }); if (cb) { setImmediate(cb, null); } return Promise.resolve(); },
            dropIndex: function (ixname, cb) { calls.push({ op: 'dropIndex', collection: name, name: ixname }); if (cb) { setImmediate(cb, null); } return Promise.resolve(); },
            watch: function () { throw new Error('the change stream is not configured in this test'); }
        };
        collections[name] = c;
        return c;
    }
    const db = { collection, admin: () => ({ serverInfo: cb => setImmediate(cb, null, { version: '7.0.31', versionArray: [7, 0, 31, 0] }) }) };
    const client = { db: () => db };
    return { calls, module: { MongoClient: { connect: (url, options, cb) => setImmediate(cb, null, client) } } };
}

// Load the package's db.js with its relative requires from the repository and its dependencies
// from the deployment, except 'mongodb', which is the double.
function loadDbJs(mongodb) {
    const file = path.join(repoRoot, 'db.js');
    const wrapper = vm.runInThisContext('(function (exports, require, module, __filename, __dirname) {' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file });
    const module = { exports: {} };
    const localRequire = name => (name === 'mongodb') ? mongodb : name.startsWith('./') ? require(path.join(repoRoot, name)) : deployRequire(name);
    wrapper(module.exports, localRequire, module, file, repoRoot);
    return module.exports;
}

async function startOn(existing, settings) {
    const mongo = fakeMongo(existing);
    const parent = {
        args: { mongodb: 'mongodb://127.0.0.1:1/', mongodbname: 'meshcentral' },
        config: { settings: Object.assign({ plugins: { enabled: true, list: ['nativeruntime'] } }, settings || {}), domains: { '': {} } },
        datapath: path.join(repoRoot, 'deploy', 'meshcentral-data'), crypto: require('node:crypto'), platform: process.platform,
        debug: function () { }, addServerWarning: function (m) { throw new Error('unexpected server warning: ' + m); }
    };
    const db = await new Promise(resolve => loadDbJs(mongo.module).CreateDB(parent, resolve));
    await new Promise(resolve => setTimeout(resolve, 50)); // let the indexes() callbacks issue their calls
    assert.equal(typeof db.GetAllTypeNoTypeFieldMeshFiltered, 'function');
    return mongo.calls;
}

// Index documents as MongoDB lists them: the TTL indexes carry db.js's default expiry.
function asListed(sets) {
    const out = {};
    for (const [col, names] of Object.entries(sets)) {
        out[col] = names.map(name => (TTL[col] && name === 'ExpireTime1') ? { name, expireAfterSeconds: TTL[col] } : (name === 'ExpireTime2') ? { name, expireAfterSeconds: 0 } : { name });
    }
    return out;
}

function created(calls) {
    const out = {};
    for (const c of calls.filter(c => c.op === 'createIndex')) { (out[c.collection] = out[c.collection] || []).push(c.name); }
    for (const k of Object.keys(out)) { out[k].sort(); }
    return out;
}

test('first start on a 1.2.5 database adds exactly the rollback drop list and drops nothing', async () => {
    const calls = await startOn(asListed(INDEXES_1_2_5));
    assert.deepEqual(calls.filter(c => c.op !== 'createIndex'), [], 'no dropIndexes or dropIndex on an upgrade');
    assert.deepEqual(created(calls), ROLLBACK_DROP_LIST);
    const collation = calls.filter(c => c.options.collation).map(c => c.collection + '.' + c.name + ' ' + JSON.stringify(c.options.collation)).sort();
    assert.deepEqual(collation, [
        'meshcentral.TypeDomainIdNameCollation1 {"locale":"en","strength":2}',
        'meshcentral.TypeDomainMeshNameCollation1 {"locale":"en","strength":2}'
    ], 'the device list indexes use the collation of GetAllTypeNoTypeFieldMeshFiltered');
});

test('a second start creates nothing, and a changed expiry rebuilds only that TTL index', async () => {
    const names = {};
    for (const col of new Set(Object.keys(INDEXES_1_2_5).concat(Object.keys(ROLLBACK_DROP_LIST)))) {
        names[col] = (INDEXES_1_2_5[col] || []).concat(ROLLBACK_DROP_LIST[col] || []);
    }
    const full = asListed(names);
    assert.deepEqual(await startOn(full), [], 'nothing to do once every index exists');

    const changed = JSON.parse(JSON.stringify(full));
    changed.events = changed.events.map(ix => (ix.name === 'ExpireTime1') ? { name: 'ExpireTime1', expireAfterSeconds: 60 } : ix);
    const calls = await startOn(changed);
    assert.deepEqual(calls.map(c => c.op + ' ' + c.collection + '.' + c.name), ['dropIndex events.ExpireTime1', 'createIndex events.ExpireTime1']);
    assert.equal(calls[1].options.expireAfterSeconds, TTL.events);
});

test('an empty database gets the 1.2.5 set plus the drop list', async () => {
    const calls = await startOn({});
    assert.deepEqual(calls.filter(c => c.op !== 'createIndex'), []);
    const expected = {};
    for (const col of new Set(Object.keys(INDEXES_1_2_5).concat(Object.keys(ROLLBACK_DROP_LIST)))) {
        expected[col] = (INDEXES_1_2_5[col] || []).concat(ROLLBACK_DROP_LIST[col] || []).sort();
    }
    assert.deepEqual(created(calls), expected);
    for (const col of Object.keys(TTL)) {
        const ttl = calls.find(c => c.collection === col && c.name === 'ExpireTime1');
        assert.equal(ttl.options.expireAfterSeconds, TTL[col], col + ' keeps the 1.2.5 expiry');
    }
});
