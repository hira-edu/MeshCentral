'use strict';

// D4 / PRD-1 / DEP-21: the fork no longer uses image-size. Desktop tiles and recording blocks are sized by
// the fork's own JPEG/PNG reader (meshdesktopmultiplex.js, mcrec.js), so the dependency, its InstallModules
// request and the runtime preload that disabled its unpatched ICNS/JXL/HEIF parsers are all retired.
// The server must never ask npm for image-size at start, and the deployment must not install it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deployRoot = path.join(__dirname, '..');
const repoRoot = path.join(__dirname, '../..');

function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

test('the deployment does not depend on image-size', () => {
    const pkg = json(path.join(deployRoot, 'package.json'));
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        assert.equal(Object.hasOwn(pkg[field] || {}, 'image-size'), false, 'deploy/package.json ' + field + ' lists image-size');
    }
    assert.equal(Object.hasOwn(json(path.join(repoRoot, 'package.json')).dependencies, 'image-size'), false);
});

test('the locked dependency tree holds no image-size', () => {
    const lock = json(path.join(deployRoot, 'package-lock.json'));
    const found = Object.keys(lock.packages).filter((key) => key === 'node_modules/image-size' || key.endsWith('/node_modules/image-size'));
    assert.deepEqual(found, []);
    assert.equal(Object.hasOwn(lock.packages[''].dependencies, 'image-size'), false);
});

test('InstallModules never requests image-size', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'meshcentral.js'), 'utf8');
    // mainStart builds the list of modules it asks InstallModules to install, then calls it.
    const start = source.indexOf('var modules = [');
    const end = source.indexOf('InstallModules(modules, args, function', start);
    assert.ok(start >= 0 && end > start, 'meshcentral.js builds a module list for InstallModules');
    const body = source.slice(start, end);
    assert.ok(body.includes("'express@"), 'the base module list was found');
    assert.doesNotMatch(body, /image-size/);
});

test('no packaged server file requires image-size', () => {
    const offenders = [];
    for (const name of fs.readdirSync(repoRoot)) {
        if (!name.endsWith('.js')) { continue; }
        const text = fs.readFileSync(path.join(repoRoot, name), 'utf8');
        if (/require\(\s*['"]image-size['"]\s*\)/.test(text)) { offenders.push(name); }
    }
    assert.deepEqual(offenders, []);
});
