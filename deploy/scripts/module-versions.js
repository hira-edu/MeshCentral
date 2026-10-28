'use strict';
// Release-dated agent module versions (D17, D22).
//
// The server sends every core module as addModule(name, source, version), and an agent replaces a
// module it already has only when that ISO date is newer than its own copy's
// (MeshAgent microscript/ILibDuktape_Polyfills.c, ILibDuktape_Polyfills_addModule). The version must
// therefore be a function of the packaged content, never of file or install times (npm extracts
// the tarball with the install time as every file's mtime) and never of commits that leave the
// package unchanged.
//
// Every module under agents/modules_meshcore and agents/modules_meshcore_min gets one date: the
// committer date of the newest commit on HEAD's first-parent line whose diff against its first
// parent touches a packaged path. Commits that change only deploy/, .github/, plugins/ or other
// unpackaged paths leave the manifest, and so the tarball, unchanged; a merge that brings packaged
// changes dates the release at the merge, so dates only grow along the mainline.
// "Packaged" is the package.json "files" list (plus package.json, readme and licence files, which
// npm always packs); pack.js checks that this selects exactly what npm pack --dry-run lists.
//
// pack.js writes the manifest into the package as agents/module-versions.json; meshcentral.js
// reads it and refuses to start when a served module is missing from it.
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

function trackedFiles(repoRoot) {
    return git(repoRoot, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']).split('\0').filter(Boolean);
}

// Returns a predicate for repository-relative paths that npm packs, from HEAD's package.json.
const ALWAYS_PACKED = /^(package\.json|readme(\.[^/]*)?|licen[cs]e(\.[^/]*)?)$/i;
function packagedPathMatcher(repoRoot) {
    const pkg = JSON.parse(git(repoRoot, ['show', 'HEAD:package.json']));
    if (!Array.isArray(pkg.files) || pkg.files.length === 0) { throw new Error('HEAD:package.json has no "files" list'); }
    const escape = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const rules = pkg.files.map(entry => {
        if (typeof entry !== 'string' || entry === '' || entry.startsWith('/') || entry.startsWith('!') || entry.includes('**')) {
            throw new Error('unsupported package.json "files" entry: ' + JSON.stringify(entry));
        }
        if (entry.includes('*')) {
            if (entry.includes('/')) { throw new Error('unsupported package.json "files" entry: ' + JSON.stringify(entry)); }
            const re = new RegExp('^' + entry.split('*').map(escape).join('[^/]*') + '$');
            return p => re.test(p);
        }
        return p => p === entry || p.startsWith(entry + '/');
    });
    return p => (!p.includes('/') && ALWAYS_PACKED.test(p)) || rules.some(rule => rule(p));
}

// The newest first-parent commit whose diff against its first parent touches a packaged path.
function releaseCommit(repoRoot, isPackaged) {
    const commits = git(repoRoot, ['rev-list', '--first-parent', 'HEAD']).split('\n').filter(Boolean);
    for (const commit of commits) {
        const parents = git(repoRoot, ['rev-list', '--parents', '-n', '1', commit]).trim().split(' ').slice(1);
        const diffArgs = parents.length ? ['diff-tree', '-r', '-z', '--no-commit-id', '--name-only', '--no-renames', parents[0], commit]
            : ['diff-tree', '-r', '-z', '--no-commit-id', '--name-only', '--root', commit];
        if (git(repoRoot, diffArgs).split('\0').some(p => p && isPackaged(p))) {
            const seconds = Number(git(repoRoot, ['log', '-1', '--format=%ct', commit]).trim());
            if (!Number.isInteger(seconds) || seconds <= 0) { throw new Error('cannot read the committer date of ' + commit); }
            return { commit, date: new Date(seconds * 1000).toISOString() };
        }
    }
    throw new Error('no commit on HEAD\'s first-parent line changes a packaged path');
}

// Returns { manifest, bytes } for the commit checked out at repoRoot. When `listed` (npm pack
// --dry-run paths, without the manifest) is given, the packaged-path rule must select exactly it.
function build(repoRoot, listed) {
    const isPackaged = packagedPathMatcher(repoRoot);
    if (listed) {
        const selected = trackedFiles(repoRoot).filter(isPackaged);
        const npmSet = new Set(listed), ruleSet = new Set(selected);
        const onlyRule = selected.filter(p => !npmSet.has(p)), onlyNpm = listed.filter(p => !ruleSet.has(p));
        if (onlyRule.length || onlyNpm.length) {
            throw new Error('the packaged-path rule disagrees with npm pack --dry-run; only the rule: ' + onlyRule.slice(0, 20).join(', ') +
                '; only npm: ' + onlyNpm.slice(0, 20).join(', '));
        }
    }
    const release = releaseCommit(repoRoot, isPackaged);
    const modules = {};
    for (const file of trackedFiles(repoRoot)) {
        if (MODULE_DIRS.some(d => file.startsWith(d + '/')) && file.toLowerCase().endsWith('.js')) { modules[file.slice('agents/'.length)] = release.date; }
    }
    if (Object.keys(modules).length === 0) { throw new Error('HEAD tracks no agent core modules under ' + MODULE_DIRS.join(', ')); }
    const sorted = {};
    for (const key of Object.keys(modules).sort()) { sorted[key] = modules[key]; }
    // commit is the release commit (the last packaged change), not HEAD, so the bytes stay the same
    // across commits that do not change the package.
    const manifest = { commit: release.commit, date: release.date, modules: sorted };
    return { manifest, bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') };
}

module.exports = { MANIFEST, MODULE_DIRS, build, packagedPathMatcher, releaseCommit };

if (require.main === module) {
    const repoRoot = path.resolve(__dirname, '../..');
    const { manifest, bytes } = build(repoRoot);
    if (process.argv.includes('--write')) {
        fs.writeFileSync(path.join(repoRoot, MANIFEST), bytes);
        console.log(MANIFEST + ': ' + Object.keys(manifest.modules).length + ' modules at ' + manifest.date + ' (last packaged change ' + manifest.commit + ')');
    } else {
        process.stdout.write(bytes);
    }
}
