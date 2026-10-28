'use strict';
// Release-dated agent module versions (D17, D22).
//
// The server sends every core module as addModule(name, source, version), and an agent replaces a
// module it already has only when that ISO date is newer than its own copy's
// (MeshAgent microscript/ILibDuktape_Polyfills.c, ILibDuktape_Polyfills_addModule). The version must
// therefore be a function of the release, never of file or install times: npm extracts the tarball
// with the install time as every file's mtime, so mtime versions change on every reinstall.
//
// Every module under agents/modules_meshcore and agents/modules_meshcore_min gets one date: the
// committer date of the commit being packed. pack.js writes the manifest into the package as
// agents/module-versions.json; meshcentral.js reads it and refuses to start when a served module is
// missing from it.
//
//   node deploy/scripts/module-versions.js           print the manifest for HEAD
//   node deploy/scripts/module-versions.js --write   write agents/module-versions.json (for running
//                                                    the server from a checkout; never commit it)
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST = 'agents/module-versions.json';
const MODULE_DIRS = ['agents/modules_meshcore', 'agents/modules_meshcore_min'];

function git(repoRoot, args) {
    const result = childProcess.spawnSync('git', ['-c', 'core.autocrlf=false'].concat(args), { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (result.error) { throw new Error('git ' + args.join(' ') + ': ' + result.error.message); }
    if (result.status !== 0) { throw new Error('git ' + args.join(' ') + ' exited ' + result.status + ': ' + result.stderr); }
    return result.stdout;
}

// The module files HEAD tracks, as paths relative to agents/ (the keys the loader looks up).
function trackedModules(repoRoot) {
    const listing = git(repoRoot, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--'].concat(MODULE_DIRS));
    return listing.split('\0').filter(p => p.toLowerCase().endsWith('.js'))
        .map(p => p.slice('agents/'.length)).sort();
}

// HEAD's committer date in the form the agent parses and earlier versions used (Date.toISOString).
function releaseDate(repoRoot) {
    const seconds = Number(git(repoRoot, ['log', '-1', '--format=%ct', 'HEAD']).trim());
    if (!Number.isInteger(seconds) || seconds <= 0) { throw new Error('cannot read the committer date of HEAD'); }
    return new Date(seconds * 1000).toISOString();
}

// Returns { manifest, bytes } for the commit checked out at repoRoot.
function build(repoRoot) {
    const date = releaseDate(repoRoot);
    const modules = {};
    for (const key of trackedModules(repoRoot)) { modules[key] = date; }
    if (Object.keys(modules).length === 0) { throw new Error('HEAD tracks no agent core modules under ' + MODULE_DIRS.join(', ')); }
    const manifest = { commit: git(repoRoot, ['rev-parse', 'HEAD']).trim(), date, modules };
    return { manifest, bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') };
}

module.exports = { MANIFEST, MODULE_DIRS, build, releaseDate, trackedModules };

if (require.main === module) {
    const repoRoot = path.resolve(__dirname, '../..');
    const { manifest, bytes } = build(repoRoot);
    if (process.argv.includes('--write')) {
        fs.writeFileSync(path.join(repoRoot, MANIFEST), bytes);
        console.log(MANIFEST + ': ' + Object.keys(manifest.modules).length + ' modules at ' + manifest.date + ' (commit ' + manifest.commit + ')');
    } else {
        process.stdout.write(bytes);
    }
}
