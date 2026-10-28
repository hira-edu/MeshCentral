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

test('a repository without core modules is refused', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-versions-empty-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'readme.md'), 'x\n');
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
