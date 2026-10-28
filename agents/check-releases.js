'use strict';

// Release gate for the fork agent binaries. It runs offline: nothing is downloaded.
//
//   node agents/check-releases.js [--directory <dir>] [--package <npm pack --json output>]
//
// agents/agent-defaults.json must pin at least every agent file the id table serves unsigned (agenttypes.js:
// the fork's Windows service builds, D12), and every pin must verify, with the code the server runs at start,
// in the package agents folder or in <dir>. With --package, the packed agent binaries must be exactly the pins.

const fs = require('fs');
const path = require('path');
const agentbuilds = require('../agentbuilds');

async function main() {
    const args = process.argv.slice(2);
    let directory, packageFile;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--directory') && (i + 1 < args.length)) directory = path.resolve(args[++i]);
        else if ((args[i] === '--package') && (i + 1 < args.length)) packageFile = args[++i];
        else throw new Error('Unknown option: ' + args[i]);
    }
    const types = require('../agenttypes')();
    const manifestPath = path.join(__dirname, agentbuilds.MANIFEST_NAME);
    const defaults = agentbuilds.CreateAgentDefaults({ config: { settings: {} }, meshAgentsArchitectureNumbers: types }, { directory: directory || __dirname, manifest: manifestPath });
    await defaults.prepare();
    const status = defaults.status();
    const problems = status.errors.slice();
    const pinned = new Set(status.files.map(file => file.filename));
    const required = new Set();
    for (const id in types) { if (types[id].unsigned === true) required.add(types[id].localname); }
    for (const name of required) { if (!pinned.has(name)) problems.push(name + ' is served unsigned (agenttypes.js) but is not pinned in ' + manifestPath + '.'); }
    if (packageFile) {
        const data = JSON.parse(await fs.promises.readFile(packageFile, 'utf8'));
        const packages = Array.isArray(data) ? data : Object.values(data);
        if ((packages.length !== 1) || !Array.isArray(packages[0].files)) throw new Error('Invalid npm package file list.');
        const names = packages[0].files.map(file => file.path);
        for (const name of ['agentbuilds.js', 'agenttypes.js', 'agents/' + agentbuilds.MANIFEST_NAME]) { if (!names.includes(name)) problems.push('The package lacks ' + name + '.'); }
        const binaries = names.filter(name => agentbuilds.isAgentBinaryPath(name, agentbuilds.agentNames(types)));
        for (const name of binaries) { if (!pinned.has(name.slice('agents/'.length))) problems.push('The package carries an agent binary that is not pinned: ' + name + '.'); }
        for (const name of pinned) { if (!binaries.includes('agents/' + name)) problems.push('The package lacks the pinned agent binary agents/' + name + '.'); }
    }
    if (problems.length) throw new Error('The fork agent binaries are not ready for release:\n' + problems.join('\n'));
    console.log('Verified ' + pinned.size + ' fork agent binaries built from ' + status.build.repository + ' ' + status.build.commit + (directory ? ' in ' + directory : '') + '.');
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
