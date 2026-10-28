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

test('the wrapper carries none of the retired pre-fork deployment files', () => {
    // docker-compose.yml ran upstream 1.2.1 with mounts production never used (T31). The remote
    // scripts and the nginx config targeted /opt/meshcentral-app, Node 18 and an nginx edge; the
    // live host is /opt/meshcentral behind Caddy and cloudflared (T28, T29).
    const retired = ['docker-compose.yml', 'scripts/remote', 'infra/nginx'];
    assert.deepEqual(retired.filter((entry) => fs.existsSync(path.join(deployRoot, entry))), []);
});

test('the operations index lists exactly the documents in its folder', () => {
    const dir = path.join(deployRoot, 'docs', 'operations');
    const onDisk = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md').sort();
    const listed = [...read('docs/operations/README.md').matchAll(/^- `([^`]+\.md)`/gm)].map((m) => m[1]).sort();
    assert.deepEqual(listed, onDisk);
});
