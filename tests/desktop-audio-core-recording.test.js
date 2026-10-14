'use strict';

// Desktop audio (relay protocol 20) is live only and must never land in a session recording. The
// relay in the meshcentral npm package records every protocol when a domain sets
// "sessionrecording": true, or sets it to an object without an explicit "protocols" list, so the
// deployment contract is: any domain that enables recording lists its protocols and the list
// excludes 20. This test checks the committed config template and, with --config <file>, a live
// config.json before it is published.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DESKTOP_AUDIO_PROTOCOL = 20;

// Mirrors meshrelay.js (meshcentral 1.2.1, performRelay): the predicate that decides whether a
// relay session of protocol p is written to a .mcrec file. The per-user / per-group filters that
// follow it only narrow the set of sessions, so they cannot be relied on to exclude a protocol.
function relayRecordsProtocol(domain, protocol) {
    if (domain == null) return false;
    const recording = domain.sessionrecording;
    if (recording === true) return true;
    if ((typeof recording === 'object') && (recording !== null)) {
        return (recording.protocols == null) || (recording.protocols.indexOf(protocol) >= 0);
    }
    return false;
}

// Returns the names of the domains whose recording configuration would capture desktop audio.
function domainsRecordingAudio(config) {
    const domains = (config && typeof config.domains === 'object' && config.domains) || {};
    const offenders = [];
    for (const name of Object.keys(domains)) {
        const domain = Object.assign({}, config.domaindefaults || {}, domains[name] || {});
        if (relayRecordsProtocol(domain, DESKTOP_AUDIO_PROTOCOL)) offenders.push(name === '' ? '(default)' : name);
    }
    return offenders;
}

function readConfig(file) {
    // MeshCentral tolerates comment lines and a BOM in config.json; strip both the same way.
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(line => !line.trim().startsWith('//')).join('\n');
    return JSON.parse(text);
}

const args = process.argv.slice(2);
if (args.length === 2 && args[0] === '--config') {
    const file = path.resolve(args[1]);
    const offenders = domainsRecordingAudio(readConfig(file));
    if (offenders.length) {
        console.error('FAIL ' + file + ': session recording would capture desktop audio (protocol 20) for domain(s): ' + offenders.join(', ') +
            '. Set "sessionrecording" to an object with an explicit "protocols" list that omits 20.');
        process.exit(1);
    }
    console.log('PASS ' + file + ': no domain records desktop audio (protocol 20)');
    process.exit(0);
}
assert(args.length === 0, 'Usage: node desktop-audio-core-recording.test.js [--config <config.json>]');

test('the relay recording predicate records every protocol unless the list is explicit', () => {
    assert.equal(relayRecordsProtocol({ sessionrecording: true }, DESKTOP_AUDIO_PROTOCOL), true);
    assert.equal(relayRecordsProtocol({ sessionrecording: {} }, DESKTOP_AUDIO_PROTOCOL), true);
    assert.equal(relayRecordsProtocol({ sessionrecording: { onlyselectedusers: true } }, DESKTOP_AUDIO_PROTOCOL), true, 'user filters do not exclude a protocol');
    assert.equal(relayRecordsProtocol({ sessionrecording: { protocols: [1, 2, 5, 6, 8, 9, 10, 100, 101, 200] } }, DESKTOP_AUDIO_PROTOCOL), false);
    assert.equal(relayRecordsProtocol({ sessionrecording: { protocols: [2, 20] } }, DESKTOP_AUDIO_PROTOCOL), true);
    assert.equal(relayRecordsProtocol({ sessionrecording: { protocols: [2] } }, 2), true, 'desktop recording itself stays available');
    assert.equal(relayRecordsProtocol({ sessionrecording: false }, DESKTOP_AUDIO_PROTOCOL), false);
    assert.equal(relayRecordsProtocol({}, DESKTOP_AUDIO_PROTOCOL), false);
});

test('domain defaults are applied before the check and offenders are named', () => {
    assert.deepEqual(domainsRecordingAudio({ domains: { '': {} } }), []);
    assert.deepEqual(domainsRecordingAudio({ domaindefaults: { sessionrecording: true }, domains: { '': {}, support: { sessionrecording: { protocols: [2] } } } }), ['(default)']);
    assert.deepEqual(domainsRecordingAudio({ domains: { '': { sessionrecording: true }, lab: { sessionrecording: {} } } }), ['(default)', 'lab']);
});

test('the committed config template never records desktop audio', () => {
    const template = readConfig(path.join(__dirname, '../meshcentral-data/config.json.template'));
    assert.deepEqual(domainsRecordingAudio(template), []);
});

test('the installed relay still decides recording the way this check models it', { skip: !fs.existsSync(path.join(__dirname, '../node_modules/meshcentral/meshrelay.js')) }, () => {
    const relay = fs.readFileSync(path.join(__dirname, '../node_modules/meshcentral/meshrelay.js'), 'utf8');
    assert.match(relay, /domain\.sessionrecording == true \|\| \(\(typeof domain\.sessionrecording == 'object'\) && \(\(domain\.sessionrecording\.protocols == null\) \|\| \(domain\.sessionrecording\.protocols\.indexOf\(parseInt\(obj\.req\.query\.p\)\) >= 0\)\)\)/);
});
