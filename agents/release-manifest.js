'use strict';

// Writes the fork agent manifest (agents/agent-defaults.json) for built MeshAgent binaries:
//
//   node agents/release-manifest.js --repository owner/name --commit <full sha> file [file ...]
//
// Each file keeps its name, which must be an agent file name in agenttypes.js. The output is checked with the
// parser the server uses before it is printed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const agentbuilds = require('../agentbuilds');

async function main() {
    const args = process.argv.slice(2), files = [], build = { repository: null, commit: null };
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--repository') && (i + 1 < args.length)) build.repository = args[++i];
        else if ((args[i] === '--commit') && (i + 1 < args.length)) build.commit = args[++i];
        else if (args[i].startsWith('--')) throw new Error('Unknown option: ' + args[i]);
        else files.push(args[i]);
    }
    if (!build.repository || !build.commit || !files.length) {
        throw new Error('Usage: node agents/release-manifest.js --repository owner/name --commit <full sha> file [file ...]');
    }
    const manifest = { schema: agentbuilds.MANIFEST_SCHEMA, build, files: [] };
    for (const filename of files) {
        const name = path.basename(filename), before = await fs.promises.lstat(filename);
        if (!before.isFile() || !before.size) throw new Error('Not a regular, non-empty file: ' + filename);
        const hash = crypto.createHash('sha384');
        for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
        const after = await fs.promises.lstat(filename);
        if ((before.ino !== after.ino) || (before.size !== after.size) || (before.mtimeMs !== after.mtimeMs) || (before.ctimeMs !== after.ctimeMs)) throw new Error('File changed while it was hashed: ' + filename);
        manifest.files.push({ filename: name, size: after.size, sha384: hash.digest('hex') });
    }
    manifest.files.sort((a, b) => a.filename.localeCompare(b.filename));
    agentbuilds.parseManifest(manifest, agentbuilds.agentNames(require('../agenttypes')()));
    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
