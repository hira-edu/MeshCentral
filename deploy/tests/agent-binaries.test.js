'use strict';
// Fork agent binaries (Stage 6, D11/D12): the package serves only the fork's own MeshAgent builds, pinned by
// size and SHA384 in agents/agent-defaults.json. agentbuilds.js verifies them at start and never downloads;
// agents/check-releases.js is the offline release gate, agents/release-manifest.js writes the pins, and
// deploy/scripts/pack.js packs exactly the pinned binaries.
const assert = require('node:assert');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const repoRoot = path.resolve(__dirname, '../..');
const agentbuilds = require(path.join(repoRoot, 'agentbuilds.js'));
const agentTypes = require(path.join(repoRoot, 'agenttypes.js'));
const SERVICES = ['MeshService.exe', 'MeshService64.exe', 'MeshServiceARM64.exe'];
const BUILD = { repository: 'hira-edu/MeshAgent', commit: 'a'.repeat(40) };

function tempDir(t, prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
function sha384(data) { return crypto.createHash('sha384').update(data).digest('hex'); }
function binary(name) { return Buffer.from('MZ fork build of ' + name + '\n'); }
function pin(name, data) { return { filename: name, size: data.length, sha384: sha384(data) }; }
function manifestOf(files) { return { schema: agentbuilds.MANIFEST_SCHEMA, build: files.length ? BUILD : null, files }; }
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }

// A package agents folder with the three service builds and a manifest pinning them; tweak() edits the pins.
function agentsFolder(t, tweak) {
    const dir = tempDir(t, 'agent-binaries-');
    const files = SERVICES.map(name => { write(path.join(dir, name), binary(name)); return pin(name, binary(name)); });
    const manifest = manifestOf(files);
    if (tweak) { tweak(manifest, dir); }
    write(path.join(dir, agentbuilds.MANIFEST_NAME), JSON.stringify(manifest, null, 2));
    return dir;
}
function defaultsFor(dir, settings) {
    return agentbuilds.CreateAgentDefaults({ config: { settings: settings || {} }, meshAgentsArchitectureNumbers: agentTypes() },
        { directory: dir, manifest: path.join(dir, agentbuilds.MANIFEST_NAME), log: message => { throw new Error('unexpected log: ' + message); } });
}

test('agentbuilds.js loads no network module and has no download or release-check code', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'agentbuilds.js'), 'utf8');
    const required = [...source.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map(m => m[1]).sort();
    assert.deepStrictEqual(required, ['crypto', 'fs', 'path']);
    assert.doesNotMatch(source, /https?:\/\/|github\.com|CreateAgentReleaseUpdates|httpsDownloads|setTimeout|setInterval/);
    assert.deepStrictEqual(Object.keys(agentbuilds).sort(),
        ['CreateAgentDefaults', 'MANIFEST_NAME', 'MANIFEST_SCHEMA', 'TOOL_NAMES', 'agentNames', 'isAgentBinaryPath', 'parseManifest', 'verifyFile']);
});

test('preparing the agents makes no network call, even when a pin fails', async (t) => {
    const dir = agentsFolder(t, (manifest) => { manifest.files[0].sha384 = 'b'.repeat(96); });
    const calls = [];
    const traps = [[require('node:https'), ['request', 'get']], [require('node:http'), ['request', 'get']], [require('node:dns'), ['lookup', 'resolve']],
        [require('node:dns').promises, ['lookup', 'resolve']], [require('node:net'), ['connect', 'createConnection']], [require('node:tls'), ['connect']]];
    for (const [mod, names] of traps) {
        for (const name of names) {
            const original = mod[name];
            mod[name] = function () { calls.push(name); throw new Error('network call ' + name); };
            t.after(() => { mod[name] = original; });
        }
    }
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function () { calls.push('fetch'); throw new Error('network call fetch'); };
    t.after(() => { globalThis.fetch = originalFetch; });
    const defaults = defaultsFor(dir);
    await defaults.prepare();
    defaults.start();
    assert.strictEqual(defaults.status().errors.length, 1);
    assert.deepStrictEqual(calls, []);
});

test('a pinned build that verifies is served from the package folder with its build identity', async (t) => {
    const dir = agentsFolder(t);
    const defaults = defaultsFor(dir);
    await defaults.prepare();
    defaults.start();
    const status = defaults.status();
    assert.deepStrictEqual(status.errors, []);
    assert.strictEqual(status.enabled, false, 'downloads are never enabled');
    assert.deepStrictEqual(status.build, BUILD);
    assert.deepStrictEqual(status.files.map(file => file.status), ['Ready', 'Ready', 'Ready']);
    for (const name of SERVICES) { assert.strictEqual(defaults.sourcePath(name), path.join(dir, name)); }
    assert.deepStrictEqual(defaults.info('MeshService64.exe'), { repository: BUILD.repository, commit: BUILD.commit, sha384: sha384(binary('MeshService64.exe')) });
});

test('a pin that does not match is refused and never served', async (t) => {
    const cases = {
        size: [(m, dir) => { fs.appendFileSync(path.join(dir, 'MeshService64.exe'), 'x'); }, /bytes, pinned/],
        hash: [(m, dir) => { const data = binary('MeshService64.exe'); data[0] = 0x4e; fs.writeFileSync(path.join(dir, 'MeshService64.exe'), data); }, /SHA384 [0-9a-f]{96}, pinned/],
        missing: [(m, dir) => { fs.rmSync(path.join(dir, 'MeshService64.exe')); }, /the file is missing/],
        folder: [(m, dir) => { fs.rmSync(path.join(dir, 'MeshService64.exe')); fs.mkdirSync(path.join(dir, 'MeshService64.exe')); }, /not a regular file/]
    };
    for (const [label, [tweak, reason]] of Object.entries(cases)) {
        const dir = agentsFolder(t, tweak);
        const defaults = defaultsFor(dir);
        await defaults.prepare();
        defaults.start();
        const errors = defaults.status().errors;
        assert.strictEqual(errors.length, 1, label);
        assert.match(errors[0], /^MeshService64\.exe: .* does not match its pin \(/, label);
        assert.match(errors[0], reason, label);
        assert.strictEqual(defaults.sourcePath('MeshService64.exe'), null, label);
        assert.strictEqual(defaults.info('MeshService64.exe'), null, label);
        assert.strictEqual(defaults.sourcePath('MeshService.exe'), path.join(dir, 'MeshService.exe'), label + ': the other pins still serve');
    }
});

test('a symbolic link in place of a pinned build is refused', async (t) => {
    const dir = agentsFolder(t);
    const target = path.join(dir, 'real.exe');
    fs.renameSync(path.join(dir, 'MeshService64.exe'), target);
    try { fs.symlinkSync(target, path.join(dir, 'MeshService64.exe'), 'file'); } catch (ex) {
        if (ex.code === 'EPERM') { t.skip('creating a symbolic link needs a privilege this account lacks (EPERM)'); return; }
        throw ex;
    }
    const defaults = defaultsFor(dir);
    await defaults.prepare();
    assert.match(defaults.status().errors.join('\n'), /MeshService64\.exe: .*not a regular file/);
    assert.strictEqual(defaults.sourcePath('MeshService64.exe'), null);
});

test('an agent file the manifest does not pin is not served; package tools are', async (t) => {
    const dir = agentsFolder(t);
    write(path.join(dir, 'meshagent_x86-64'), 'upstream linux agent');
    write(path.join(dir, 'MeshCmd64.exe'), 'upstream meshcmd');
    write(path.join(dir, 'MeshCentralRouter.exe'), 'router');
    const defaults = defaultsFor(dir);
    await defaults.prepare();
    defaults.start();
    assert.strictEqual(defaults.sourcePath('meshagent_x86-64'), null);
    assert.strictEqual(defaults.sourcePath('MeshCmd64.exe'), null);
    assert.strictEqual(defaults.sourcePath('MeshCentralRouter.exe'), path.join(dir, 'MeshCentralRouter.exe'));
    assert.strictEqual(defaults.sourcePath('MeshCentralAssistant.exe'), null, 'an absent tool resolves to nothing');
    assert.strictEqual(defaults.sourcePath('not-an-agent.exe'), null);
});

test('a manifest that pins nothing serves no agent and says so', async (t) => {
    const dir = agentsFolder(t, (manifest) => { manifest.files = []; manifest.build = null; });
    const defaults = defaultsFor(dir);
    await defaults.prepare();
    defaults.start();
    assert.match(defaults.status().errors.join('\n'), /pins no agent binaries, so none is served/);
    for (const name of SERVICES) { assert.strictEqual(defaults.sourcePath(name), null); }
});

test('an unreadable or invalid manifest serves no agent', async (t) => {
    const broken = {
        'upstream 1.3.1 shape': { schemaVersion: 1, releases: [{ repository: 'Ylianst/MeshAgent', tag: 'legacy-1.2.6', files: [] }] },
        'unknown name': manifestOf([pin('MeshService-2022.exe', binary('x'))]),
        'duplicate name': manifestOf([pin('MeshService64.exe', binary('x')), pin('meshservice64.exe', binary('x'))]),
        'bad hash': manifestOf([{ filename: 'MeshService64.exe', size: 3, sha384: 'ABC' }]),
        'extra field': Object.assign(manifestOf([]), { releases: [] }),
        'build missing': { schema: agentbuilds.MANIFEST_SCHEMA, build: null, files: [pin('MeshService64.exe', binary('x'))] },
        'short commit': { schema: agentbuilds.MANIFEST_SCHEMA, build: { repository: 'hira-edu/MeshAgent', commit: 'abc' }, files: [pin('MeshService64.exe', binary('x'))] }
    };
    for (const [label, manifest] of Object.entries(broken)) {
        const dir = agentsFolder(t, (m, folder) => { write(path.join(folder, agentbuilds.MANIFEST_NAME + '.next'), JSON.stringify(manifest)); });
        fs.renameSync(path.join(dir, agentbuilds.MANIFEST_NAME + '.next'), path.join(dir, agentbuilds.MANIFEST_NAME));
        const defaults = defaultsFor(dir);
        await defaults.prepare();
        defaults.start();
        assert.match(defaults.status().errors.join('\n'), /Unable to read the fork agent manifest .* No agent binary is served\./, label);
        for (const name of SERVICES) { assert.strictEqual(defaults.sourcePath(name), null, label); }
    }
    const missing = tempDir(t, 'agent-binaries-none-');
    const defaults = defaultsFor(missing);
    await defaults.prepare();
    assert.match(defaults.status().errors.join('\n'), /Unable to read the fork agent manifest .*ENOENT/);
});

test('settings.agentDownloads is refused unless it only disables downloads', async (t) => {
    const dir = agentsFolder(t);
    for (const [settings, refused] of [[{ agentdownloads: { manifest: 'agentbuilds/custom.json' } }, true], [{ agentdownloads: { enabled: true } }, true],
        [{ agentdownloads: { enabled: false, checkintervalhours: 0 } }, true], [{ agentdownloads: { enabled: false } }, false], [{}, false]]) {
        const defaults = defaultsFor(dir, settings);
        await defaults.prepare();
        const errors = defaults.status().errors;
        assert.strictEqual(errors.some(e => /settings\.agentDownloads is not supported/.test(e)), refused, JSON.stringify(settings));
    }
});

test('agenttypes.js: the fork service builds 3, 4 and 43 are served unsigned and never re-signed (D12)', () => {
    const types = agentTypes();
    for (const id of [3, 4, 43]) {
        assert.strictEqual(types[id].unsigned, true, 'id ' + id);
        assert.strictEqual(types[id].codesign, undefined, 'id ' + id);
    }
    assert.deepStrictEqual(Object.keys(types).filter(id => types[id].unsigned === true).map(id => types[id].localname).sort(),
        ['MeshService.exe', 'MeshService.exe', 'MeshService64.exe', 'MeshService64.exe', 'MeshServiceARM64.exe']);
    assert.deepStrictEqual(Object.keys(types).filter(id => types[id].codesign === true), ['11000', '11001', '11002']);
    assert.notStrictEqual(agentTypes(), agentTypes(), 'each call returns a fresh table (meshcentral.js mutates it)');
});

// A package-shaped folder: agentbuilds.js and agenttypes.js at the root, the scripts in agents/.
function packageFolder(t, pins, files) {
    const root = tempDir(t, 'agent-package-');
    for (const file of ['agentbuilds.js', 'agenttypes.js', 'agents/check-releases.js', 'agents/release-manifest.js']) { write(path.join(root, file), fs.readFileSync(path.join(repoRoot, file))); }
    for (const name of files) { write(path.join(root, 'agents', name), binary(name)); }
    write(path.join(root, 'agents', agentbuilds.MANIFEST_NAME), JSON.stringify(manifestOf(pins.map(name => pin(name, binary(name)))), null, 2));
    return root;
}
function runScript(root, script, args) {
    return childProcess.spawnSync(process.execPath, [path.join(root, 'agents', script)].concat(args || []), { cwd: root, encoding: 'utf8' });
}
function packList(names) { return JSON.stringify([{ files: names.map(name => ({ path: name })) }]); }

test('check-releases.js passes only when every unsigned service build is pinned and verifies', (t) => {
    const ok = runScript(packageFolder(t, SERVICES, SERVICES), 'check-releases.js');
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Verified 3 fork agent binaries built from hira-edu\/MeshAgent a{40}\./);

    const partial = runScript(packageFolder(t, SERVICES.slice(1), SERVICES), 'check-releases.js');
    assert.strictEqual(partial.status, 1);
    assert.match(partial.stderr, /MeshService\.exe is served unsigned \(agenttypes\.js\) but is not pinned/);

    const empty = runScript(packageFolder(t, [], []), 'check-releases.js');
    assert.strictEqual(empty.status, 1);
    assert.match(empty.stderr, /pins no agent binaries/);

    const changed = packageFolder(t, SERVICES, SERVICES);
    fs.appendFileSync(path.join(changed, 'agents', 'MeshServiceARM64.exe'), 'tampered');
    const tampered = runScript(changed, 'check-releases.js');
    assert.strictEqual(tampered.status, 1);
    assert.match(tampered.stderr, /MeshServiceARM64\.exe: .* does not match its pin/);

    const elsewhere = packageFolder(t, SERVICES, []);
    const built = tempDir(t, 'agent-build-');
    for (const name of SERVICES) { write(path.join(built, name), binary(name)); }
    assert.strictEqual(runScript(elsewhere, 'check-releases.js').status, 1, 'the package folder lacks the files');
    const directory = runScript(elsewhere, 'check-releases.js', ['--directory', built]);
    assert.strictEqual(directory.status, 0, directory.stderr);
});

test('check-releases.js --package: the packed agent binaries are exactly the pins', (t) => {
    const root = packageFolder(t, SERVICES, SERVICES);
    const support = ['agentbuilds.js', 'agenttypes.js', 'agents/agent-defaults.json', 'agents/meshcore.js', 'agents/MeshCentralRouter.exe'];
    const cases = [
        ['exact', support.concat(SERVICES.map(n => 'agents/' + n)), 0, null],
        ['unpinned upstream binary', support.concat(SERVICES.map(n => 'agents/' + n), ['agents/meshagent_x86-64']), 1, /not pinned: agents\/meshagent_x86-64/],
        ['test build folder', support.concat(SERVICES.map(n => 'agents/' + n), ['agents/agents_sep2026/meshagent_x86']), 1, /not pinned: agents\/agents_sep2026\/meshagent_x86/],
        ['pin not packed', support.concat(['agents/MeshService64.exe', 'agents/MeshServiceARM64.exe']), 1, /lacks the pinned agent binary agents\/MeshService\.exe/],
        ['no agentbuilds.js', support.slice(1).concat(SERVICES.map(n => 'agents/' + n)), 1, /lacks agentbuilds\.js/]
    ];
    for (const [label, names, status, message] of cases) {
        const file = path.join(root, 'pack-' + label.replace(/\W+/g, '-') + '.json');
        fs.writeFileSync(file, packList(names));
        const result = runScript(root, 'check-releases.js', ['--package', file]);
        assert.strictEqual(result.status, status, label + ': ' + result.stderr);
        if (message) { assert.match(result.stderr, message, label); }
    }
});

test('release-manifest.js writes pins the server and the release gate accept', (t) => {
    const root = packageFolder(t, [], SERVICES);
    const files = SERVICES.map(name => path.join(root, 'agents', name));
    const result = runScript(root, 'release-manifest.js', ['--repository', BUILD.repository, '--commit', BUILD.commit].concat(files.slice().reverse()));
    assert.strictEqual(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    assert.deepStrictEqual(manifest, manifestOf(SERVICES.map(name => pin(name, binary(name)))), 'sorted by name, sizes and SHA384 of the files');
    fs.writeFileSync(path.join(root, 'agents', agentbuilds.MANIFEST_NAME), result.stdout);
    assert.strictEqual(runScript(root, 'check-releases.js').status, 0);

    const misnamed = path.join(root, 'MeshService-2022.exe');
    write(misnamed, 'build output');
    const wrongName = runScript(root, 'release-manifest.js', ['--repository', BUILD.repository, '--commit', BUILD.commit, misnamed]);
    assert.strictEqual(wrongName.status, 1);
    assert.match(wrongName.stderr, /MeshService-2022\.exe is not an agent file name in agenttypes\.js/);

    const twice = path.join(root, 'other', 'MeshService64.exe');
    write(twice, 'another build');
    const duplicate = runScript(root, 'release-manifest.js', ['--repository', BUILD.repository, '--commit', BUILD.commit, files[1], twice]);
    assert.strictEqual(duplicate.status, 1);
    assert.match(duplicate.stderr, /MeshService64\.exe is pinned more than once/);

    for (const args of [['--repository', BUILD.repository].concat(files), ['--repository', BUILD.repository, '--commit', 'main'].concat(files)]) {
        const bad = runScript(root, 'release-manifest.js', args);
        assert.strictEqual(bad.status, 1, args.join(' '));
    }
});

// pack.js on a fixture repository shaped like the package.
function git(cwd, args) {
    const result = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' }) });
    assert.strictEqual(result.status, 0, 'git ' + args.join(' ') + ': ' + result.stderr);
    return result.stdout;
}
function packFixture(t, pins, files) {
    const dir = tempDir(t, 'agent-pack-');
    const content = {
        'package.json': JSON.stringify({ name: 'meshcentral', version: '0.0.0-test', files: ['*.js', 'agents'] }, null, 2) + '\n',
        'readme.md': 'fixture\n',
        'meshcentral.js': '// server\n',
        'agentbuilds.js': fs.readFileSync(path.join(repoRoot, 'agentbuilds.js')),
        'agenttypes.js': fs.readFileSync(path.join(repoRoot, 'agenttypes.js')),
        'agents/meshcore.js': '// core\n',
        'agents/modules_meshcore/alpha.js': 'module.exports = 1;\n',
        'agents/agent-defaults.json': JSON.stringify(manifestOf(pins.map(name => pin(name, binary(name)))), null, 2) + '\n',
        'deploy/.gitignore': 'dist/\n',
        'deploy/scripts/module-versions.js': fs.readFileSync(path.join(repoRoot, 'deploy/scripts/module-versions.js')),
        'deploy/scripts/pack.js': fs.readFileSync(path.join(repoRoot, 'deploy/scripts/pack.js'))
    };
    for (const name of files) { content['agents/' + name] = binary(name); }
    for (const [file, data] of Object.entries(content)) { write(path.join(dir, file), data); }
    git(dir, ['init', '-q']);
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'fixture']);
    return dir;
}
function runPack(dir) { return childProcess.spawnSync(process.execPath, [path.join(dir, 'deploy/scripts/pack.js'), '--json'], { cwd: dir, encoding: 'utf8' }); }
function tarballNames(file) {
    const tar = zlib.gunzipSync(fs.readFileSync(file)), names = [];
    for (let offset = 0; offset + 512 <= tar.length;) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every(b => b === 0)) { break; }
        const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
        names.push(header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, ''));
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return names;
}

test('pack.js packs exactly the pinned fork builds', (t) => {
    const dir = packFixture(t, SERVICES, SERVICES);
    const result = runPack(dir);
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const record = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    assert.deepStrictEqual(record.agentBuild, BUILD);
    assert.deepStrictEqual(record.agents.map(a => a.filename), SERVICES);
    assert.match(result.stdout, /agents {4}3 pinned fork binaries built from hira-edu\/MeshAgent a{40}/);
    const names = tarballNames(path.join(dir, record.tarball));
    for (const name of SERVICES) { assert.ok(names.includes('package/agents/' + name), name); }
    assert.strictEqual(names.filter(name => agentbuilds.isAgentBinaryPath(name.slice('package/'.length), agentbuilds.agentNames(agentTypes()))).length, 3, names.join(' '));
});

test('pack.js refuses the upstream agent binaries the fork does not pin', (t) => {
    for (const name of ['meshagent_x86-64', 'MeshCmd.exe', 'meshagent_android.apk', 'agents_sep2026/meshagent_x86']) {
        const result = runPack(packFixture(t, SERVICES, SERVICES.concat([name])));
        assert.strictEqual(result.status, 1, name);
        assert.ok(result.stderr.includes('agent binary not pinned in agents/agent-defaults.json: agents/' + name), name + ': ' + result.stderr);
    }
});

test('pack.js refuses an unpinned, missing or changed agent binary', (t) => {
    const unpinned = runPack(packFixture(t, SERVICES.slice(0, 2), SERVICES));
    assert.strictEqual(unpinned.status, 1);
    assert.match(unpinned.stderr, /agent binary not pinned in agents\/agent-defaults\.json: agents\/MeshServiceARM64\.exe/);

    const missing = runPack(packFixture(t, SERVICES, SERVICES.slice(1)));
    assert.strictEqual(missing.status, 1);
    assert.match(missing.stderr, /pinned agent binary not in the package: agents\/MeshService\.exe/);

    const dir = packFixture(t, SERVICES, SERVICES);
    fs.appendFileSync(path.join(dir, 'agents/MeshService64.exe'), 'rebuilt');
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-am', 'rebuilt without new pins']);
    const changed = runPack(dir);
    assert.strictEqual(changed.status, 1);
    assert.match(changed.stderr, /agent binary does not match its pin: agents\/MeshService64\.exe \(\d+ bytes, pinned \d+\)/);

    const invalid = packFixture(t, [], []);
    fs.writeFileSync(path.join(invalid, 'agents/agent-defaults.json'), JSON.stringify({ schemaVersion: 1, releases: [] }));
    git(invalid, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-am', 'upstream manifest']);
    const upstream = runPack(invalid);
    assert.strictEqual(upstream.status, 1);
    assert.match(upstream.stderr, /agents\/agent-defaults\.json: not a fork agent manifest/);
});

test('pack.js packs a manifest that pins nothing and says the release gate refuses it', (t) => {
    const result = runPack(packFixture(t, [], []));
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /agents {4}none pinned in agents\/agent-defaults\.json: the server serves no agent binary and agents\/check-releases\.js refuses this package/);
    const record = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    assert.deepStrictEqual(record.agents, []);
    assert.strictEqual(record.agentBuild, null);
});
