'use strict';

// Contracts for the deployment wrapper's own files (scripts, docs, config template).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const deployRoot = path.join(__dirname, '..');

function read(relative) {
    return fs.readFileSync(path.join(deployRoot, relative), 'utf8');
}

// The repo files New-MeshCentralLocalBackup.ps1 copies, as deploy-relative paths.
function backupRepoFiles() {
    const script = read('scripts/ops/New-MeshCentralLocalBackup.ps1');
    const block = /\$repoFiles = @\(([\s\S]*?)\n\)/.exec(script);
    assert.ok(block, 'New-MeshCentralLocalBackup.ps1 defines $repoFiles');
    const entries = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/\\/g, '/'));
    assert.ok(entries.length > 0, '$repoFiles is not empty');
    return entries;
}

test('the local backup names only deployment files that exist', () => {
    // Copy-IfExists skips missing paths silently, so a stale entry would make the backup
    // quietly capture less than it lists.
    const missing = backupRepoFiles().filter((entry) => !fs.existsSync(path.join(deployRoot, entry)));
    assert.deepEqual(missing, []);
});

// Runs the package.json postinstall script's node -e program in cwd.
function runPostinstall(cwd) {
    const script = JSON.parse(read('package.json')).scripts.postinstall;
    const match = /^node -e "(.*)"$/.exec(script);
    assert.ok(match, 'postinstall is a single node -e program: ' + script);
    return spawnSync(process.execPath, ['-e', match[1].replace(/\\"/g, '"')], { cwd, encoding: 'utf8' });
}

test('postinstall creates the data folder and is repeatable', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-deploy-postinstall-'));
    try {
        for (let run = 0; run < 2; run++) {
            const result = runPostinstall(cwd);
            assert.equal(result.status, 0, result.stderr);
            assert.ok(fs.statSync(path.join(cwd, 'meshcentral-data')).isDirectory());
        }
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
    }
});

test('postinstall fails when the data folder cannot be created', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-deploy-postinstall-'));
    try {
        fs.writeFileSync(path.join(cwd, 'meshcentral-data'), 'not a folder');
        const result = runPostinstall(cwd);
        assert.notEqual(result.status, 0, 'a failed mkdir must fail the install');
        assert.match(result.stderr, /EEXIST|ENOTDIR/);
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
    }
});

function listFiles(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).replace(/\\/g, '/')];
    });
}

test('custom.js is the only web override and the installed server reads it in place', () => {
    // D11 and G4: custom.js is the only meshcentral-web/public file.
    assert.deepEqual(listFiles(path.join(deployRoot, 'meshcentral-web')), ['public/scripts/custom.js']);
    // The package installs into deploy/node_modules/meshcentral, and the server picks up
    // ../../meshcentral-web/public from there, as production does. No WebPublicPath is needed.
    const repoRoot = path.join(deployRoot, '..');
    const server = fs.readFileSync(path.join(repoRoot, 'meshcentral.js'), 'utf8');
    assert.match(server, /obj\.webPublicOverridePath = obj\.path\.join\(__dirname, '\.\.\/\.\.\/meshcentral-web\/public'\)/);
    assert.equal(path.resolve(deployRoot, 'node_modules', 'meshcentral', '../../meshcentral-web/public'),
        path.join(deployRoot, 'meshcentral-web', 'public'));
    const template = JSON.parse(read('meshcentral-data/config.json.template'));
    for (const [name, domain] of Object.entries(template.domains)) {
        const keys = Object.keys(domain).map((key) => key.toLowerCase());
        assert.equal(keys.includes('webpublicpath'), false, 'domain "' + name + '" must not redirect the web override');
    }
});

test('setup-local stages no web overrides and refuses a stale data-dir copy', () => {
    const shell = read('scripts/setup-local.sh');
    const powershell = read('scripts/setup-local.ps1');
    for (const [name, text] of [['setup-local.sh', shell], ['setup-local.ps1', powershell]]) {
        assert.doesNotMatch(text, /\b(?:cp|Copy-Item)\b[^\n]*meshcentral-web/, name + ' must not copy the web override');
        assert.doesNotMatch(text, /\b(?:cp|Copy-Item)\b[^\n]*meshcentral-data\/public/, name + ' must not write a data-dir web copy');
    }
    assert.match(shell, /if \[ -e meshcentral-data\/public \]; then[\s\S]*?exit 1\nfi/);
    assert.match(powershell, /if \(Test-Path -LiteralPath 'meshcentral-data\/public'\) \{\s*throw /);
});

test('setup-local stages the nativeruntime plugin as an exact copy of the repository source', () => {
    // pluginHandler.js loads plugins only from <datapath>/plugins, and the package does not ship
    // plugins/ yet. Data-dir staging stays until the Stage 4 built-in loader (PRD-12).
    const shell = read('scripts/setup-local.sh');
    assert.match(shell, /rm -rf "meshcentral-data\/plugins\/\$plugin"\n\s*mkdir -p "meshcentral-data\/plugins"\n\s*cp -R "\.\.\/plugins\/\$plugin" "meshcentral-data\/plugins\/\$plugin"/);
    const powershell = read('scripts/setup-local.ps1');
    assert.match(powershell, /Remove-Item -LiteralPath \$destination -Recurse -Force/);
    assert.match(powershell, /Copy-Item -LiteralPath \$source -Destination \$destination -Recurse/);
    for (const text of [shell, powershell]) {
        assert.match(text, /nativeruntime/);
    }
    assert.ok(fs.existsSync(path.join(deployRoot, '..', 'plugins', 'nativeruntime', 'nativeruntime.js')));
});

test('the config template uses only MeshCentral settings, each once, and marks its dev-only ones', () => {
    const template = JSON.parse(read('meshcentral-data/config.json.template'));
    const schema = JSON.parse(fs.readFileSync(path.join(deployRoot, '..', 'meshcentral-config-schema.json'), 'utf8'));
    const sections = [
        ['settings', template.settings, schema.properties.settings.properties],
        ['domains[""]', template.domains[''], schema.properties.domains.additionalProperties.properties]
    ];
    for (const [label, section, known] of sections) {
        const knownLower = new Set(Object.keys(known).map((key) => key.toLowerCase()));
        const keys = Object.keys(section).filter((key) => !key.startsWith('_')); // _ keys are ignored comments
        // A key MeshCentral does not read does nothing and misleads whoever copies the template.
        assert.deepEqual(keys.filter((key) => !knownLower.has(key.toLowerCase())), [], label + ' keys MeshCentral does not read');
        // Keys are case-insensitive, so two spellings of one key conflict (PRD-8).
        const lower = keys.map((key) => key.toLowerCase());
        assert.deepEqual(lower.filter((key, i) => lower.indexOf(key) !== i), [], label + ' keys set twice');
    }
    assert.deepEqual(Object.keys(template.settings).filter((key) => key.toLowerCase() === 'agentupdatesystem'), ['agentUpdateSystem']);
    assert.equal(template.settings.agentUpdateSystem, 1);
    // NewAccounts lets anyone register from the login page: a local-development convenience.
    assert.equal(template.domains[''].NewAccounts, true);
    assert.match(template.domains[''].__comment__, /NewAccounts[^"]*local development only/);
    assert.match(template.settings.__comment__, /local development/);
});

test('the wrapper carries none of the retired pre-fork deployment files', () => {
    // docker-compose.yml ran upstream 1.2.1 with mounts production never used (T31). The remote
    // scripts and the nginx config targeted /opt/meshcentral-app, Node 18 and an nginx edge; the
    // live host is /opt/meshcentral behind Caddy and cloudflared (T28, T29).
    const retired = ['docker-compose.yml', 'scripts/remote', 'infra/nginx'];
    assert.deepEqual(retired.filter((entry) => fs.existsSync(path.join(deployRoot, entry))), []);
});

test('the operations docs describe the current stack, not snapshots or retired files', () => {
    const dir = path.join(deployRoot, 'docs', 'operations');
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
        const text = fs.readFileSync(path.join(dir, name), 'utf8');
        // Production snapshots hold secrets and are not tracked; the docs must not depend on them.
        assert.doesNotMatch(text, /server-backups\//, name + ' points into server-backups/');
        assert.doesNotMatch(text, /infra\/nginx|scripts\/remote\/|docker-compose/, name + ' names a retired file');
        assert.doesNotMatch(text, /^#+ .*\b20\d\d\b/m, name + ' has a dated section heading');
    }
});

test('the operations index lists exactly the documents in its folder', () => {
    const dir = path.join(deployRoot, 'docs', 'operations');
    const onDisk = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md').sort();
    const listed = [...read('docs/operations/README.md').matchAll(/^- `([^`]+\.md)`/gm)].map((m) => m[1]).sort();
    assert.deepEqual(listed, onDisk);
});
