'use strict';
// Release-dated agent module versions (D17, D22): deploy/scripts/module-versions.js builds the
// manifest from git, and meshcentral.js serves every core module with the manifest's date, failing
// at startup when the manifest or a module's entry is missing.
const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '../..');
const moduleVersions = require('../scripts/module-versions.js');

function git(cwd, args, env) {
    const result = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, env) });
    assert.strictEqual(result.status, 0, 'git ' + args.join(' ') + ': ' + result.stderr);
    return result.stdout;
}

function fixtureRepo(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-versions-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const files = {
        'package.json': JSON.stringify({ name: 'meshcentral', version: '0.0.0-test', files: ['agents'] }) + '\n',
        'agents/modules_meshcore/alpha.js': 'module.exports = 1;\n',
        'agents/modules_meshcore/win-beta.js': 'module.exports = 2;\n',
        'agents/modules_meshcore/coretranslations.json': '{}\n',
        'agents/modules_meshcore_min/alpha.min.js': 'module.exports=1;\n',
        'agents/meshcore.js': '// core\n'
    };
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
    }
    git(dir, ['init', '-q']);
    git(dir, ['add', '-A']);
    const date = '2026-10-28T09:15:42+02:00';
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'fixture'],
        { GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: date });
    return { dir, date };
}

test('the manifest dates every tracked core module with the commit date, independent of file times', (t) => {
    const { dir, date } = fixtureRepo(t);
    const first = moduleVersions.build(dir);
    const expected = new Date(date).toISOString();
    assert.strictEqual(expected, '2026-10-28T07:15:42.000Z');
    assert.strictEqual(first.manifest.date, expected, 'committer date, not author date');
    assert.deepStrictEqual(first.manifest.modules, {
        'modules_meshcore/alpha.js': expected,
        'modules_meshcore/win-beta.js': expected,
        'modules_meshcore_min/alpha.min.js': expected
    });
    assert.strictEqual(first.manifest.commit, git(dir, ['rev-parse', 'HEAD']).trim());

    const old = new Date('1985-10-26T08:15:00Z');
    for (const file of ['agents/modules_meshcore/alpha.js', 'agents/modules_meshcore_min/alpha.min.js']) { fs.utimesSync(path.join(dir, file), old, old); }
    fs.writeFileSync(path.join(dir, 'agents/modules_meshcore/untracked.js'), 'module.exports = 3;\n');
    assert.ok(moduleVersions.build(dir).bytes.equals(first.bytes), 'file times and untracked files do not change the manifest');
});

function commitAll(dir, message, date) {
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', message],
        { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return git(dir, ['rev-parse', 'HEAD']).trim();
}

function packageFixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-versions-pkg-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const files = {
        'package.json': JSON.stringify({ name: 'meshcentral', version: '0.0.0-test', files: ['*.js', 'agents'] }, null, 2) + '\n',
        'readme.md': 'fixture\n',
        'meshcentral.js': '// server\n',
        'agents/meshcore.js': '// core\n',
        'agents/modules_meshcore/alpha.js': 'module.exports = 1;\n',
        'agents/modules_meshcore/beta.js': 'module.exports = 2;\n',
        'agents/extra.txt': 'packaged, not a module\n',
        'deploy/notes.md': 'not packaged\n',
        'deploy/.gitignore': 'dist/\n',
        'deploy/scripts/module-versions.js': fs.readFileSync(path.join(__dirname, '../scripts/module-versions.js')),
        'deploy/scripts/pack.js': fs.readFileSync(path.join(__dirname, '../scripts/pack.js'))
    };
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
    }
    git(dir, ['init', '-q']);
    const release = commitAll(dir, 'release', '2026-10-01T10:00:00Z');
    return { dir, release };
}

test('commits outside the package leave the manifest unchanged; packaged changes and deletions date it', (t) => {
    const { dir, release } = packageFixture(t);
    const first = moduleVersions.build(dir);
    assert.strictEqual(first.manifest.date, '2026-10-01T10:00:00.000Z');
    assert.strictEqual(first.manifest.commit, release);

    fs.writeFileSync(path.join(dir, 'deploy/notes.md'), 'lockfile update\n');
    commitAll(dir, 'deploy only', '2026-10-02T10:00:00Z');
    fs.writeFileSync(path.join(dir, 'plugins.md'), 'top-level, not packaged\n');
    commitAll(dir, 'unpackaged top-level file', '2026-10-03T10:00:00Z');
    assert.ok(moduleVersions.build(dir).bytes.equals(first.bytes), 'deploy-only and unpackaged commits do not change the manifest');

    fs.writeFileSync(path.join(dir, 'agents/modules_meshcore/alpha.js'), 'module.exports = 11;\n');
    const changed = commitAll(dir, 'packaged change', '2026-10-04T10:00:00Z');
    const second = moduleVersions.build(dir);
    assert.strictEqual(second.manifest.date, '2026-10-04T10:00:00.000Z');
    assert.strictEqual(second.manifest.commit, changed);
    assert.deepStrictEqual(Object.values(second.manifest.modules), ['2026-10-04T10:00:00.000Z', '2026-10-04T10:00:00.000Z']);

    fs.rmSync(path.join(dir, 'agents/extra.txt'));
    const deleted = commitAll(dir, 'packaged deletion', '2026-10-05T10:00:00Z');
    assert.strictEqual(moduleVersions.build(dir).manifest.commit, deleted, 'deleting a packaged file changes the package');
});

test('a merge that brings packaged changes dates the release at the merge', (t) => {
    const { dir } = packageFixture(t);
    const main = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    git(dir, ['checkout', '-q', '-b', 'side']);
    fs.writeFileSync(path.join(dir, 'agents/modules_meshcore/beta.js'), 'module.exports = 22;\n');
    commitAll(dir, 'side change (old date)', '2026-10-02T10:00:00Z');
    git(dir, ['checkout', '-q', main]);
    fs.writeFileSync(path.join(dir, 'deploy/notes.md'), 'mainline deploy-only\n');
    commitAll(dir, 'mainline deploy only', '2026-10-06T10:00:00Z');
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'merge', '-q', '--no-ff', '-m', 'merge side', 'side'],
        { GIT_AUTHOR_DATE: '2026-10-07T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-07T10:00:00Z' });
    const built = moduleVersions.build(dir);
    assert.strictEqual(built.manifest.date, '2026-10-07T10:00:00.000Z');
    assert.strictEqual(built.manifest.commit, git(dir, ['rev-parse', 'HEAD']).trim());
});

test('pack.js: a deploy-only commit leaves the tarball unchanged; a packaged commit changes it', (t) => {
    const { dir } = packageFixture(t);
    const pack = () => {
        const result = childProcess.spawnSync(process.execPath, [path.join(dir, 'deploy/scripts/pack.js'), '--json'], { cwd: dir, encoding: 'utf8' });
        assert.strictEqual(result.status, 0, result.stderr + result.stdout);
        const record = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
        assert.ok(!fs.existsSync(path.join(dir, moduleVersions.MANIFEST)), 'pack.js removes the generated manifest');
        return record;
    };
    const first = pack();
    assert.strictEqual(first.files, 8, 'the 7 packaged files plus the generated manifest');
    fs.writeFileSync(path.join(dir, 'deploy/notes.md'), 'lockfile now pins ' + first.integrity + '\n');
    commitAll(dir, 'pin the tarball integrity', '2026-10-08T10:00:00Z');
    const second = pack();
    assert.notStrictEqual(second.commit, first.commit);
    assert.strictEqual(second.integrity, first.integrity, 'the lockfile commit does not change the tarball');
    assert.strictEqual(second.packagedCommit, first.packagedCommit);

    fs.writeFileSync(path.join(dir, 'meshcentral.js'), '// server 2\n');
    const changed = commitAll(dir, 'server change', '2026-10-09T10:00:00Z');
    const third = pack();
    assert.notStrictEqual(third.integrity, first.integrity);
    assert.strictEqual(third.packagedCommit, changed);
    assert.strictEqual(third.moduleVersion, '2026-10-09T10:00:00.000Z');
});

test('a repository without core modules is refused', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-versions-empty-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'readme.md'), 'x\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'meshcentral', version: '0.0.0-test', files: ['agents'] }) + '\n');
    git(dir, ['init', '-q']);
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'empty']);
    assert.throws(() => moduleVersions.build(dir), /tracks no agent core modules/);
});

// The core builder from the repository's meshcentral.js, run against an in-memory package.
const source = fs.readFileSync(path.join(repoRoot, 'meshcentral.js'), 'utf8');
const builder = source.slice(source.indexOf('    // Agent core module versions are release dates'), source.indexOf('    // Update the default meshcmd'));

function buildCores(manifest, files) {
    const packageDir = path.join(path.sep, 'pkg');
    const agents = path.join(packageDir, 'agents');
    const tree = {};
    tree[path.join(agents, 'meshcore.js')] = '// core';
    for (const [rel, content] of Object.entries(files)) { tree[path.join(agents, rel)] = content; }
    if (manifest !== undefined) { tree[path.join(agents, 'module-versions.json')] = JSON.stringify(manifest); }
    const errors = [];
    const obj = {
        args: { minifycore: false }, datapath: path.join(path.sep, 'data'), path, crypto: require('node:crypto'),
        common: { IntToStr: () => '\0\0\0\0' }, debug: () => { },
        defaultMeshCores: {}, defaultMeshCoresHash: {}, defaultMeshCoresDeflate: {},
        escapeCodeString: value => JSON.stringify(value).slice(1, -1),
        fs: {
            existsSync: file => Object.prototype.hasOwnProperty.call(tree, file),
            readdirSync: dir => {
                const names = Object.keys(tree).filter(file => path.dirname(file) === dir).map(file => path.basename(file));
                if (names.length === 0) { throw new Error('ENOENT ' + dir); }
                return names;
            },
            readFileSync: file => {
                if (!Object.prototype.hasOwnProperty.call(tree, file)) { throw new Error('ENOENT: ' + file); }
                return Buffer.from(tree[file]);
            },
            statSync: () => { throw new Error('the core builder must not read file times'); }
        }
    };
    const exit = new Error('process.exit');
    const context = {
        obj, Buffer, __dirname: packageDir,
        console: { error: message => errors.push(message), log: () => { } },
        process: { exit: code => { exit.code = code; throw exit; } },
        require: () => ({ constants: { Z_BEST_COMPRESSION: 9 }, deflate: (data, options, callback) => callback(null, data) })
    };
    vm.runInNewContext(builder, context);
    try { obj.updateMeshCore(); } catch (ex) { if (ex !== exit) { throw ex; } return { exitCode: exit.code, errors }; }
    const registrations = [];
    vm.runInNewContext(obj.defaultMeshCores['windows-amt'].slice(4).toString(), { addModule: (...args) => registrations.push(args), addedModules: [] });
    return { registrations, errors };
}

test('served modules carry the manifest version', () => {
    const date = '2026-10-28T07:15:42.000Z';
    const result = buildCores({ date, modules: { 'modules_meshcore/alpha.js': date, 'modules_meshcore/win-beta.js': date } },
        { 'modules_meshcore/alpha.js': 'module.exports = 1;', 'modules_meshcore/win-beta.js': 'module.exports = 2;' });
    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.registrations.map(r => [r[0], r[2]]).sort(), [['alpha', date], ['win-beta', date]]);
    assert.strictEqual(result.registrations.find(r => r[0] === 'alpha')[1], 'module.exports = 1;');
});

test('a module missing from the manifest stops the server and is named', () => {
    const date = '2026-10-28T07:15:42.000Z';
    const result = buildCores({ date, modules: { 'modules_meshcore/alpha.js': date } },
        { 'modules_meshcore/alpha.js': 'module.exports = 1;', 'modules_meshcore/win-beta.js': 'module.exports = 2;' });
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.errors.join('\n'), /module "win-beta" .*has no release version in agents\/module-versions\.json/);
});

test('an invalid version stops the server', () => {
    const result = buildCores({ modules: { 'modules_meshcore/alpha.js': '1985' } }, { 'modules_meshcore/alpha.js': 'module.exports = 1;' });
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.errors.join('\n'), /module "alpha"/);
});

test('a missing manifest stops the server', () => {
    const result = buildCores(undefined, { 'modules_meshcore/alpha.js': 'module.exports = 1;' });
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.errors.join('\n'), /cannot read .*module-versions\.json/);
});
