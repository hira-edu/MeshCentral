'use strict';

// Contracts for the deployment wrapper's own files (scripts, docs, config template).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
