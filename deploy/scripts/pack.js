'use strict';
// Pack the fork package (the repository root) into deploy/dist/ and print its integrity.
//
//   node deploy/scripts/pack.js          pack, verify, print
//   node deploy/scripts/pack.js --json   also print the record as JSON
//
// The tarball must be a function of the commit: every packed file must be tracked by git and
// unchanged from HEAD, and the packed bytes are compared with HEAD's blobs after packing.
// Refused: *.bak* and *.pdb anywhere (T33), and any top-level file not listed below (T34).
// deploy/package.json depends on dist/meshcentral-<version>.tgz, and its lockfile pins the sha512.
// Release packs run on Linux (D4); a pack made on Windows serves the local duplicate server.
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.join(repoRoot, 'deploy', 'dist');

// Every top-level file the package may contain. A new one (for example from an upstream merge)
// must be reviewed and added here.
const TOP_LEVEL_FILES = new Set([
    'LICENSE', 'package.json', 'readme.md', 'sample-config.json', 'sample-config-advanced.json',
    'agentcertificatehistory.js',
    'amt-ider.js', 'amtevents.js', 'amtmanager.js', 'amtprovisioningserver.js', 'amtscanner.js', 'amtscript.js',
    'apprelays.js', 'authenticode.js', 'backup.js', 'certoperations.js', 'common.js', 'crowdsec.js', 'db.js',
    'exeHandler.js', 'firebase.js', 'interceptor.js', 'letsencrypt.js', 'macosinstaller.js', 'mcrec.js',
    'meshaccelerator.js', 'meshagent.js', 'meshbot.js', 'meshcentral.js', 'meshctrl.js', 'meshdesktopmultiplex.js',
    'meshdevicefile.js', 'meshipkvm.js', 'meshmail.js', 'meshmessaging.js', 'meshrelay.js', 'meshscanner.js',
    'meshsms.js', 'meshuser.js', 'migrate-volume-info.js', 'monitoring.js', 'mpsserver.js', 'mqttbroker.js',
    'multiserver.js', 'pass.js', 'pkcs7-modified.js', 'pluginHandler.js', 'redirserver.js', 'swarmserver.js',
    'taskmanager.js', 'webauthn.js', 'webrelayserver.js', 'webserver.js', 'winservice.js'
]);
const REFUSED = [/\.bak/i, /\.pdb$/i];

function fail(message) {
    console.error('pack: ' + message);
    process.exit(1);
}

// The npm that ships with the running Node, run without a shell.
const NPM_CLI = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
].find(candidate => fs.existsSync(candidate));

function run(command, args, options) {
    const result = childProcess.spawnSync(command, args, Object.assign({ cwd: repoRoot, encoding: 'buffer', maxBuffer: 1 << 30 }, options));
    if (result.error) { fail(command + ' ' + args.join(' ') + ': ' + result.error.message); }
    if (result.status !== 0) { fail(command + ' ' + args.join(' ') + ' exited ' + result.status + ': ' + result.stderr.toString()); }
    return result.stdout;
}

function git(args) { return run('git', ['-c', 'core.autocrlf=false'].concat(args)); }

function npm(args) {
    if (!NPM_CLI) { fail('cannot find npm-cli.js beside ' + process.execPath); }
    return run(process.execPath, [NPM_CLI].concat(args));
}

function npmPack(extra) {
    const out = npm(['pack', '--json', '--ignore-scripts'].concat(extra)).toString('utf8');
    const parsed = JSON.parse(out.slice(out.indexOf('[')));
    if (parsed.length !== 1) { fail('npm pack returned ' + parsed.length + ' packages'); }
    return parsed[0];
}

// path -> blob sha1 of HEAD
function headBlobs() {
    const blobs = new Map();
    for (const line of git(['ls-tree', '-r', '-z', 'HEAD']).toString('utf8').split('\0')) {
        if (!line) { continue; }
        const tab = line.indexOf('\t');
        const [, type, sha] = line.slice(0, tab).split(' ');
        if (type === 'blob') { blobs.set(line.slice(tab + 1), sha); }
    }
    return blobs;
}

function blobSha(data) {
    return crypto.createHash('sha1').update('blob ' + data.length + '\0').update(data).digest('hex');
}

// Minimal ustar/pax reader for npm's tarballs: returns path -> bytes for regular files under package/.
function readTarball(file) {
    const tar = zlib.gunzipSync(fs.readFileSync(file));
    const files = new Map();
    let offset = 0;
    let paxPath = null;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every(b => b === 0)) { break; }
        const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
        const size = parseInt(field(124, 12).trim() || '0', 8);
        const type = field(156, 1) || '0';
        const prefix = field(345, 155);
        let name = prefix ? prefix + '/' + field(0, 100) : field(0, 100);
        const body = tar.subarray(offset + 512, offset + 512 + size);
        offset += 512 + Math.ceil(size / 512) * 512;
        if (type === '5' || type === 'g') { continue; }
        if (type === 'x') {
            const match = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
            paxPath = match ? match[1] : null;
            continue;
        }
        if (paxPath) { name = paxPath; paxPath = null; }
        if (type !== '0') { fail('unexpected tar entry type ' + type + ' for ' + name); }
        if (!name.startsWith('package/')) { fail('unexpected tar entry outside package/: ' + name); }
        files.set(name.slice('package/'.length), Buffer.from(body));
    }
    return files;
}

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
if (pkg.name !== 'meshcentral' || !Array.isArray(pkg.files)) { fail('repository root package.json is not the meshcentral package with a files list'); }

// 1. What npm would pack, checked before anything is written.
const dryRun = npmPack(['--dry-run']);
const listed = dryRun.files.map(f => f.path);
const problems = [];
for (const p of listed) {
    if (REFUSED.some(re => re.test(p))) { problems.push('refused file: ' + p); }
    if (!p.includes('/') && !TOP_LEVEL_FILES.has(p)) { problems.push('unlisted top-level file: ' + p); }
}
const blobs = headBlobs();
const untracked = listed.filter(p => !blobs.has(p));
for (const p of untracked) { problems.push('not tracked by git: ' + p); }
const dirty = git(['status', '--porcelain', '-z', '--untracked-files=no', '--', '.']).toString('utf8').split('\0').filter(Boolean)
    .map(line => line.slice(3)).filter(p => listed.includes(p));
for (const p of dirty) { problems.push('changed since HEAD: ' + p); }
if (problems.length) { fail(problems.length + ' problem(s):\n  ' + problems.join('\n  ')); }

// 2. Pack into deploy/dist/.
fs.mkdirSync(outDir, { recursive: true });
const packed = npmPack(['--pack-destination', outDir]);
const tarball = path.join(outDir, packed.filename);

// 3. The tarball holds exactly the dry-run list, byte-equal to HEAD.
const contents = readTarball(tarball);
const mismatch = [];
for (const p of listed) {
    if (!contents.has(p)) { mismatch.push('missing from tarball: ' + p); }
    else if (blobSha(contents.get(p)) !== blobs.get(p)) { mismatch.push('differs from HEAD: ' + p); }
}
for (const p of contents.keys()) { if (!listed.includes(p)) { mismatch.push('not in dry-run list: ' + p); } }
if (mismatch.length) { fs.unlinkSync(tarball); fail(mismatch.length + ' tarball problem(s):\n  ' + mismatch.slice(0, 50).join('\n  ')); }

const bytes = fs.readFileSync(tarball);
const record = {
    tarball: path.relative(repoRoot, tarball).split(path.sep).join('/'),
    version: pkg.version,
    commit: git(['rev-parse', 'HEAD']).toString('utf8').trim(),
    files: contents.size,
    size: bytes.length,
    integrity: 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    node: process.version,
    npm: npm(['--version']).toString('utf8').trim(),
    platform: process.platform
};
console.log(record.tarball + ': ' + record.files + ' files, ' + record.size + ' bytes, commit ' + record.commit);
console.log('integrity ' + record.integrity);
console.log('sha256    ' + record.sha256);
if (process.argv.includes('--json')) { console.log(JSON.stringify(record, null, 2)); }
