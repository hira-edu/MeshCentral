'use strict';
// Regenerate the fork's generated files with the pinned toolchain, or check that the committed
// files are exactly what the toolchain produces.
//
//   node deploy/scripts/regenerate.js [--check] [--only <list>] [options]
//
// Categories (--only takes a comma-separated list; the default is every category except agents):
//   translations  views/translations/* and the two agent translation JSON files (translate.js translateall)
//   emails        emails/translations/* (translate.js translateall)
//   views         views/*-min.handlebars and the public/scripts/*-min.js that translate.js minifyall makes
//   viewer        public/scripts/agent-desktop-0.0.2-min.js and agent-redir-ws-0.1.1-min.js, both the
//                 translate.js minifyall output, as in the npm package (D25, WEB-21)
//   agents        agents/meshcore.min.js and modules_meshcore_min/ (uglify-js). Proposal only: compared
//                 and reported, never written to the repository.
//
// Options:
//   --check            compare with the committed files and exit 1 on any difference (lists them)
//   --source <ref>     read the generator inputs from a git ref instead of the working tree
//   --against <ref>    compare with a git ref instead of the working tree (implies --check)
//   --profile <name>   fork (default) or upstream. upstream has no viewer category: minifyall owns the two
//                      viewer -min files, as in the npm package.
//   --out <dir>        write the generated files under <dir> instead of the repository (not with --check)
//   --report <file>    write a JSON report (every file and its state)
//   --duktape <exe>    agents: also compile every output in this MeshAgent console build (Duktape)
//   --toolchain <dir>  use <dir>/node_modules instead of deploy/node_modules (experiments; not a pinned run)
//   --keep-temp        keep the temporary tree and print its path
//
// Upstream's translate/translate.js does the translations, emails and views work. It is run
// unchanged in a temporary copy of its inputs, with deploy/node_modules linked in and npm forced
// offline: translate.js installs whatever latest versions npm resolves when it cannot load its
// libraries, and that must never happen here. lib/regen-preload.js fixes its two host- and
// run-dependent inputs (os.EOL and html-minifier-terser's random placeholder ids). The toolchain is
// every devDependency of deploy/package.json, each checked to be installed at its exact pinned version
// (npm ci in deploy/). Nothing in the repository is written until every
// selected category has been generated completely; writes are then applied together and rolled
// back if any of them fails.
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const deployDir = path.join(repoRoot, 'deploy');

const ALL = ['translations', 'emails', 'views', 'viewer', 'agents'];
const DEFAULT = ['translations', 'emails', 'views', 'viewer'];
const VIEWER_FILES = ['public/scripts/agent-desktop-0.0.2-min.js', 'public/scripts/agent-redir-ws-0.1.1-min.js'];
// translateall also writes minified email variants. Upstream does not ship them and meshmail.js
// reads only <name>_<lang>.html and .txt, so they are not part of the generated set.
const UNSHIPPED = [/^emails\/translations\/[^/]+-min_[^/]+\.html$/];
// uglify-js for the agents step: default compress and mangle. uglify-js 3.18+ treats input as a
// strict-mode ES module unless module is false; these are classic scripts (and meshcore.js uses
// sloppy-mode `delete <variable>`), so module is turned off.
const UGLIFY_OPTIONS = Object.freeze({ module: false, compress: {}, mangle: {} });
// Outputs translate.js rewrites in place.
const TRANSLATED_JSON = ['agents/agent-translations.json', 'agents/modules_meshcore/coretranslations.json'];

class RegenerateError extends Error { }
function fail(message) { throw new RegenerateError(message); }

function parseArgs(argv) {
    const options = { check: false, only: null, source: null, against: null, profile: 'fork', out: null, report: null, duktape: null, toolchain: null, keepTemp: false };
    const valued = { '--only': 'only', '--source': 'source', '--against': 'against', '--profile': 'profile', '--out': 'out', '--report': 'report', '--duktape': 'duktape', '--toolchain': 'toolchain' };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const eq = arg.indexOf('=');
        const name = eq > 0 ? arg.slice(0, eq) : arg;
        if (name === '--check') { options.check = true; continue; }
        if (name === '--keep-temp') { options.keepTemp = true; continue; }
        if (valued[name]) {
            const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
            if (value === undefined || value === '') fail(name + ' needs a value');
            if (name === '--only') {
                options.only = (options.only || []).concat(value.split(',').map(s => s.trim()).filter(Boolean));
            } else {
                options[valued[name]] = value;
            }
            continue;
        }
        fail('unknown argument ' + arg);
    }
    if (options.against) options.check = true;
    if (!['fork', 'upstream'].includes(options.profile)) fail('--profile must be fork or upstream');
    options.categories = options.only || DEFAULT;
    for (const c of options.categories) if (!ALL.includes(c)) fail('unknown category ' + c + ' (one of ' + ALL.join(', ') + ')');
    if (options.profile === 'upstream' && options.categories.includes('viewer')) {
        if (options.only) fail('the upstream profile has no viewer category');
        options.categories = options.categories.filter(c => c !== 'viewer');
    }
    if (!options.check && !options.out && options.source) fail('--source writes nothing to the repository; use --check or --out');
    return options;
}

function run(command, args, options) {
    const result = childProcess.spawnSync(command, args, Object.assign({ cwd: repoRoot, encoding: 'buffer', maxBuffer: 1 << 30 }, options));
    if (result.error) fail(command + ' ' + args.join(' ') + ': ' + result.error.message);
    return result;
}

function git(args) {
    const result = run('git', ['-c', 'core.autocrlf=false'].concat(args));
    if (result.status !== 0) fail('git ' + args.join(' ') + ': ' + result.stderr.toString().trim());
    return result.stdout;
}

// A file tree: the working tree (ref null) or a git ref. Paths are repository-relative with '/'.
function tree(ref) {
    if (ref) {
        const commit = git(['rev-parse', '--verify', ref + '^{commit}']).toString().trim();
        const blobs = new Map();
        for (const line of git(['ls-tree', '-r', '-z', commit]).toString('utf8').split('\0')) {
            const tab = line.indexOf('\t');
            if (tab > 0 && line.split(' ')[1] === 'blob') blobs.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[2]);
        }
        const cache = new Map();
        const readMany = rels => {
            const wanted = [...new Set(rels)].filter(rel => !cache.has(rel));
            for (const rel of wanted) if (!blobs.has(rel)) fail(rel + ' is not in ' + ref);
            if (wanted.length) {
                const result = run('git', ['cat-file', '--batch'], { input: Buffer.from(wanted.map(rel => blobs.get(rel)).join('\n') + '\n', 'ascii') });
                if (result.status !== 0) fail('git cat-file --batch: ' + result.stderr.toString());
                let at = 0;
                for (const rel of wanted) {
                    const eol = result.stdout.indexOf(10, at);
                    const size = Number(result.stdout.toString('latin1', at, eol).split(' ')[2]);
                    cache.set(rel, result.stdout.subarray(eol + 1, eol + 1 + size));
                    at = eol + 1 + size + 1;
                }
            }
            return new Map(rels.map(rel => [rel, cache.get(rel)]));
        };
        return {
            label: ref + ' (' + commit.slice(0, 9) + ')',
            readMany,
            read: rel => readMany([rel]).get(rel),
            exists: rel => blobs.has(rel),
            list: dir => [...blobs.keys()].filter(p => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/')).map(p => p.slice(dir.length + 1)).sort()
        };
    }
    const read = rel => fs.readFileSync(path.join(repoRoot, rel));
    return {
        label: 'working tree',
        readMany: rels => new Map(rels.map(rel => [rel, read(rel)])),
        read,
        exists: rel => fs.existsSync(path.join(repoRoot, rel)),
        list: dir => listFiles(path.join(repoRoot, dir))
    };
}

// The pinned toolchain: every devDependency in deploy/package.json, installed at exactly that version.
function toolchain(options) {
    const pkg = JSON.parse(fs.readFileSync(path.join(deployDir, 'package.json'), 'utf8'));
    const pins = pkg.devDependencies || {};
    const nodeModules = options.toolchain ? path.resolve(options.toolchain, 'node_modules') : path.join(deployDir, 'node_modules');
    const versions = {};
    const problems = [];
    for (const name of Object.keys(pins).sort()) {
        if (!/^\d+\.\d+\.\d+$/.test(pins[name])) problems.push(name + ' is pinned as "' + pins[name] + '", not an exact version');
        const file = path.join(nodeModules, name, 'package.json');
        const installed = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).version : null;
        versions[name] = installed;
        if (!options.toolchain && installed !== pins[name]) problems.push(name + ' ' + (installed || 'missing') + ' is installed, ' + pins[name] + ' is pinned');
    }
    if (problems.length) fail('toolchain: ' + problems.join('; ') + '. Run npm ci in deploy/.');
    return { nodeModules, versions, pinned: !options.toolchain };
}

// The minifyall list, read from translate.js itself so that it cannot drift.
function minifyList(translateJs) {
    const match = /var minifyMeshCentralSourceFiles = (\[[\s\S]*?\]);/.exec(translateJs);
    if (!match) fail('cannot find minifyMeshCentralSourceFiles in translate/translate.js');
    return JSON.parse(match[1]).map(p => p.replace(/^\.\.\//, ''));
}

function translationSources(translateJs) {
    const match = /var meshCentralSourceFiles = (\[[\s\S]*?\]);/.exec(translateJs);
    if (!match) fail('cannot find meshCentralSourceFiles in translate/translate.js');
    return JSON.parse(match[1]).map(p => p.replace(/^\.\.\//, ''));
}

function minName(rel) {
    if (rel.endsWith('.handlebars')) return rel.slice(0, -11) + '-min.handlebars';
    if (rel.endsWith('.js')) return rel.slice(0, -3) + '-min.js';
    fail('no -min name for ' + rel);
}

function writeFile(abs, data) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
}

function listFiles(abs) {
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort();
}

// Copy the generator inputs (never their outputs) into the temporary tree.
function stageInputs(src, tmp, categories, translateJs) {
    const inputs = new Set(['translate/translate.js', 'translate/translate.json']);
    // viewer needs minifyall too (the redirector -min base), and minifyall reads every file in its list.
    const upstreamWork = categories.some(c => ['translations', 'emails', 'views', 'viewer'].includes(c));
    if (upstreamWork) {
        for (const rel of translationSources(translateJs)) inputs.add(rel);
        for (const rel of minifyList(translateJs)) inputs.add(rel);
    }
    if (categories.includes('viewer')) {
        inputs.add('public/scripts/agent-desktop-0.0.2.js');
        inputs.add('public/scripts/agent-redir-ws-0.1.1.js');
    }
    if (categories.includes('agents')) {
        inputs.add('agents/meshcore.js');
        for (const name of src.list('agents/modules_meshcore')) if (name.endsWith('.js') || name.endsWith('.json')) inputs.add('agents/modules_meshcore/' + name);
    }
    for (const rel of inputs) if (!src.exists(rel)) fail('input ' + rel + ' is missing from the ' + src.label);
    for (const [rel, data] of src.readMany([...inputs])) writeFile(path.join(tmp, rel), data);
    return inputs;
}

function linkNodeModules(tmp, nodeModules) {
    fs.symlinkSync(nodeModules, path.join(tmp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}

// Run translate.js with the pinned libraries. Fails on a non-zero exit, on any stderr output, on an
// error line in its log, and if it tried to install modules.
function translate(tmp, tool, args, log) {
    const cwd = path.join(tmp, 'translate');
    const resolved = run(process.execPath, ['-e', 'for (const m of ["jsdom","esprima","html-minifier-terser","terser"]) console.log(require.resolve(m))'], { cwd });
    if (resolved.status !== 0) fail('translate.js cannot load its libraries from ' + tool.nodeModules + ': ' + resolved.stderr.toString());
    const root = fs.realpathSync(tool.nodeModules).toLowerCase();
    for (const file of resolved.stdout.toString().split(/\r?\n/).filter(Boolean)) {
        if (!fs.realpathSync(file).toLowerCase().startsWith(root)) fail('translate.js would load ' + file + ', outside ' + tool.nodeModules);
    }
    const env = Object.assign({}, process.env, { npm_config_offline: 'true', MESHCENTRAL_REGEN_EOL: '\r\n' });
    const result = run(process.execPath, ['-r', path.join(__dirname, 'lib', 'regen-preload.js'), 'translate.js'].concat(args), { cwd, env });
    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();
    log.push('$ node translate.js ' + args.join(' ') + '\n' + stdout + stderr);
    const errorLine = stdout.split(/\r?\n/).find(line => /\berror\b|missing modules|installing modules|invalid language file|unable to find/i.test(line));
    if (result.status !== 0 || stderr.trim() || errorLine) {
        fail('translate.js ' + args.join(' ') + ' failed (exit ' + result.status + ')' + (errorLine ? ': ' + errorLine : '') + (stderr.trim() ? '\n' + stderr.trim() : ''));
    }
    for (const leftover of ['node_modules', 'package.json', 'package-lock.json']) {
        if (fs.existsSync(path.join(cwd, leftover))) fail('translate.js created translate/' + leftover + ' (it tried to install modules)');
    }
}

// Each category returns { generated: Map(rel -> Buffer), committed: [rel] }.
function generate(options, src, committedTree, tmp, tool) {
    const translateJs = src.read('translate/translate.js').toString('utf8');
    stageInputs(src, tmp, options.categories, translateJs);
    linkNodeModules(tmp, tool.nodeModules);
    const log = [];
    const results = {};
    const has = c => options.categories.includes(c);
    const viewerOwned = options.profile === 'fork';

    if (has('translations') || has('emails')) translate(tmp, tool, ['translateall'], log);
    if (has('views') || has('viewer')) translate(tmp, tool, ['minifyall'], log);

    const collect = (dir, keep) => {
        const map = new Map();
        for (const name of listFiles(path.join(tmp, dir))) {
            const rel = dir + '/' + name;
            if (keep(rel) && !UNSHIPPED.some(re => re.test(rel))) map.set(rel, fs.readFileSync(path.join(tmp, rel)));
        }
        return map;
    };

    if (has('translations')) {
        const generated = collect('views/translations', () => true);
        for (const rel of TRANSLATED_JSON) generated.set(rel, fs.readFileSync(path.join(tmp, rel)));
        const committed = committedTree.list('views/translations').map(n => 'views/translations/' + n).concat(TRANSLATED_JSON);
        results.translations = { generated, committed };
    }
    if (has('emails')) {
        results.emails = {
            generated: collect('emails/translations', () => true),
            committed: committedTree.list('emails/translations').map(n => 'emails/translations/' + n).filter(rel => !UNSHIPPED.some(re => re.test(rel)))
        };
    }
    if (has('views')) {
        const owned = new Set(minifyList(translateJs).map(minName).filter(rel => !(viewerOwned && VIEWER_FILES.includes(rel))));
        const generated = new Map();
        for (const rel of owned) {
            const abs = path.join(tmp, rel);
            if (fs.existsSync(abs)) generated.set(rel, fs.readFileSync(abs));
        }
        const committed = [...owned].filter(rel => committedTree.exists(rel));
        results.views = { generated, committed };
    }
    if (has('viewer')) results.viewer = { generated: buildViewer(tmp), committed: VIEWER_FILES.filter(rel => committedTree.exists(rel)) };
    if (has('agents')) results.agents = buildAgents(options, tmp, tool, committedTree, log);
    return { results, log };
}

// Both viewer -min files are upstream's own minifyall output of their sources (D25 for the
// redirector, WEB-21 for the desktop), so the fork uses the one minifier that makes the npm copies.
function buildViewer(tmp) {
    const generated = new Map();
    for (const rel of VIEWER_FILES) {
        const abs = path.join(tmp, rel);
        if (!fs.existsSync(abs)) fail('minifyall did not write ' + rel);
        generated.set(rel, fs.readFileSync(abs));
    }
    return generated;
}

// Proposal (C1/C9/S6a), never written to the repository: the pinned uglify-js (default compress and
// mangle) on agents/meshcore.js and every agents/modules_meshcore/*.js, one
// <name>.min.js per module (no .js copies), JSON minified the way translate.js minifydir does it.
// Not minifydir itself: it wraps the script in <script> for html-minifier-terser, which rewrites the
// quotes of meshcore.js's '<?xml version="1.0" ...' literal and breaks the core.
// meshcmd.min.js and modules_meshcmd_min/ are upstream files the fork does not build; they are listed
// as missing.
function buildAgents(options, tmp, tool, committedTree) {
    const uglify = require(path.join(tool.nodeModules, 'uglify-js'));
    const generated = new Map();
    const sources = new Map();
    const minifyJs = (rel, out) => {
        const result = uglify.minify(fs.readFileSync(path.join(tmp, rel), 'utf8'), UGLIFY_OPTIONS);
        if (result.error) fail('uglify-js ' + rel + ': ' + result.error.message);
        generated.set(out, Buffer.from(result.code, 'utf8'));
        sources.set(out, rel);
    };
    minifyJs('agents/meshcore.js', 'agents/meshcore.min.js');
    for (const name of listFiles(path.join(tmp, 'agents/modules_meshcore'))) {
        const rel = 'agents/modules_meshcore/' + name;
        if (name.endsWith('.js')) minifyJs(rel, 'agents/modules_meshcore_min/' + name.slice(0, -3) + '.min.js');
        else if (name.endsWith('.json')) generated.set('agents/modules_meshcore_min/' + name, Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(path.join(tmp, rel), 'utf8'))), 'utf8'));
    }
    const checks = verifyAgents(tmp, generated, sources, tool, options);
    const committed = ['agents/meshcore.min.js', 'agents/meshcmd.min.js'].filter(rel => committedTree.exists(rel))
        .concat(committedTree.list('agents/modules_meshcore_min').map(n => 'agents/modules_meshcore_min/' + n))
        .concat(committedTree.list('agents/modules_meshcmd_min').map(n => 'agents/modules_meshcmd_min/' + n));
    return { generated, committed, checks, proposal: true };
}

// Every minified script must parse (esprima) and, with --duktape, compile in Duktape like its source.
function verifyAgents(tmp, generated, sources, tool, options) {
    const esprima = require(path.join(tool.nodeModules, 'esprima'));
    const checks = {};
    for (const [rel, data] of generated) {
        if (!rel.endsWith('.js')) continue;
        const entry = checks[rel] = { source: sources.get(rel), sourceBytes: fs.statSync(path.join(tmp, sources.get(rel))).size, minBytes: data.length };
        try { esprima.parseScript(data.toString('utf8')); entry.esprima = 'ok'; } catch (e) { entry.esprima = String(e.message || e); }
    }
    if (options.duktape) {
        const sourceFiles = new Map([...sources.entries()].map(([out, rel]) => ['source:' + out, fs.readFileSync(path.join(tmp, rel))]));
        const sourceChecks = {};
        for (const key of sourceFiles.keys()) sourceChecks[key] = {};
        duktapeCheck(sourceFiles, sourceChecks, options.duktape);
        duktapeCheck(generated, checks, options.duktape);
        for (const rel of Object.keys(checks)) checks[rel].duktapeSource = sourceChecks['source:' + rel].duktape;
    }
    return checks;
}

function duktapeCheck(generated, checks, exe) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcentral-duk-'));
    try {
        const files = [];
        for (const [rel, data] of generated) {
            if (!rel.endsWith('.js')) continue;
            const abs = path.join(dir, files.length + '-' + path.basename(rel));
            fs.writeFileSync(abs, data);
            files.push([rel, abs]);
        }
        const list = path.join(dir, 'files.txt');
        fs.writeFileSync(list, files.map(f => f[1]).join('\n') + '\n');
        const consoleExe = path.join(dir, path.basename(exe));
        fs.copyFileSync(path.resolve(exe), consoleExe);
        const result = run(consoleExe, [path.join(__dirname, 'lib', 'duktape-compile-check.js'), list], { cwd: dir, timeout: 300000 });
        const lines = result.stdout.toString().split(/\r?\n/);
        for (const [rel, abs] of files) {
            const line = lines.find(l => l.startsWith('OK ' + abs) || l.startsWith('FAIL ' + abs));
            checks[rel].duktape = !line ? 'no result' : line.startsWith('OK ') ? 'ok' : line.slice(5 + abs.length + 1);
        }
        if (!lines.some(l => l.startsWith('DONE '))) fail('duktape check did not finish: ' + result.stdout.toString() + result.stderr.toString());
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function compare(results, committedTree) {
    const report = {};
    for (const [category, r] of Object.entries(results)) {
        const files = {};
        const committed = new Set(r.committed);
        const existing = committedTree.readMany([...r.generated.keys()].filter(rel => committed.has(rel)));
        for (const [rel, data] of r.generated) {
            if (!committed.has(rel)) { files[rel] = 'extra'; continue; }
            files[rel] = existing.get(rel).equals(data) ? 'match' : 'differ';
        }
        for (const rel of committed) if (!r.generated.has(rel)) files[rel] = 'missing';
        const counts = { match: 0, differ: 0, missing: 0, extra: 0 };
        for (const state of Object.values(files)) counts[state]++;
        report[category] = { counts, files, proposal: !!r.proposal, checks: r.checks };
    }
    return report;
}

// Apply every write and delete, or none: originals are kept until all succeeded.
function apply(results, report, root) {
    const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcentral-regen-backup-'));
    const done = [];
    try {
        for (const [category, r] of Object.entries(results)) {
            for (const [rel, state] of Object.entries(report[category].files)) {
                if (state === 'match') continue;
                const abs = path.join(root, rel);
                const saved = path.join(backup, String(done.length));
                const existed = fs.existsSync(abs);
                if (existed) fs.copyFileSync(abs, saved);
                done.push({ abs, saved, existed });
                if (state === 'missing') { fs.rmSync(abs); continue; }
                const temp = abs + '.regen-tmp';
                writeFile(temp, r.generated.get(rel));
                fs.renameSync(temp, abs);
            }
        }
    } catch (e) {
        // Undo every change. A restore that fails too is named, and the backup that still holds its
        // original is kept for the operator.
        const unrestored = [];
        for (const { abs, saved, existed } of done.reverse()) {
            try {
                if (existed) fs.copyFileSync(saved, abs); else fs.rmSync(abs, { force: true });
                fs.rmSync(abs + '.regen-tmp', { force: true });
            } catch (restoreError) {
                unrestored.push(abs + (existed ? ' (original kept as ' + saved + ')' : '') + ': ' + restoreError.message);
            }
        }
        if (unrestored.length) fail('write failed (' + e.message + ') and ' + unrestored.length + ' file(s) could not be restored; the backup ' + backup + ' is kept:\n  ' + unrestored.join('\n  '));
        fs.rmSync(backup, { recursive: true, force: true });
        fail('write failed, every file restored: ' + e.message);
    }
    fs.rmSync(backup, { recursive: true, force: true });
    return done.length;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const tool = toolchain(options);
    const src = tree(options.source);
    const committedTree = tree(options.against);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcentral-regen-'));
    let exitCode = 0;
    try {
        const { results, log } = generate(options, src, committedTree, tmp, tool);
        if (results.agents) results.agents.checks = await results.agents.checks;
        const report = compare(results, committedTree);

        console.log('regenerate: profile ' + options.profile + ', sources from ' + src.label + ', compared with ' + committedTree.label + (tool.pinned ? '' : ' (experimental toolchain ' + tool.nodeModules + ')'));
        console.log('toolchain: node ' + process.version + ', ' + Object.entries(tool.versions).map(([n, v]) => n + ' ' + v).join(', '));
        let differences = 0;
        for (const [category, entry] of Object.entries(report)) {
            const c = entry.counts;
            console.log(category.padEnd(13) + ' match ' + String(c.match).padStart(5) + '  differ ' + String(c.differ).padStart(4) + '  missing ' + String(c.missing).padStart(4) + '  extra ' + String(c.extra).padStart(4) + (entry.proposal ? '  (proposal)' : ''));
            const bad = Object.entries(entry.files).filter(([, s]) => s !== 'match');
            if (!entry.proposal) differences += bad.length;
            for (const [rel, state] of bad.slice(0, 40)) console.log('  ' + state.padEnd(8) + rel);
            if (bad.length > 40) console.log('  ... ' + (bad.length - 40) + ' more (see --report)');
            if (entry.checks) {
                const failed = Object.entries(entry.checks).filter(([, k]) => k.esprima !== 'ok' || (k.duktape && k.duktape !== 'ok') || (k.duktapeSource && k.duktapeSource !== 'ok'));
                const sum = (key) => Object.values(entry.checks).reduce((a, k) => a + k[key], 0);
                console.log('  checks: ' + Object.keys(entry.checks).length + ' scripts, ' + sum('sourceBytes') + ' -> ' + sum('minBytes') + ' bytes, ' + failed.length + ' failed' + (options.duktape ? ' (esprima, Duktape for source and min)' : ' (esprima; no --duktape)'));
                for (const [rel, k] of failed) console.log('  FAIL ' + rel + ' ' + JSON.stringify(k));
                if (failed.length) exitCode = 1;
            }
        }
        if (options.report) {
            writeFile(path.resolve(options.report), JSON.stringify({ options, node: process.version, toolchain: tool.versions, pinned: tool.pinned, report }, null, 2) + '\n');
        }
        if (options.keepTemp) {
            fs.writeFileSync(path.join(tmp, 'translate.log'), log.join('\n'));
            console.log('temp tree kept: ' + tmp);
        }

        if (options.check) {
            if (differences) { console.log('regenerate --check: ' + differences + ' file(s) differ from the generators'); exitCode = 1; }
            else if (!exitCode) console.log('regenerate --check: all generated files match');
        } else {
            const writable = {};
            for (const [category, r] of Object.entries(results)) if (!r.proposal) writable[category] = r;
            if (options.out) {
                const out = path.resolve(options.out);
                let count = 0;
                for (const r of Object.values(results)) for (const [rel, data] of r.generated) { writeFile(path.join(out, rel), data); count++; }
                console.log('wrote ' + count + ' file(s) under ' + out);
            } else {
                if (results.agents) console.log('agents: proposal only, not written (C1/S6a decision pending)');
                const count = apply(writable, report, repoRoot);
                console.log(count ? 'updated ' + count + ' file(s); review with git status' : 'nothing to update');
            }
        }
    } finally {
        if (!options.keepTemp) fs.rmSync(tmp, { recursive: true, force: true });
    }
    process.exit(exitCode);
}

module.exports = { parseArgs, apply, RegenerateError };

if (require.main === module) {
    main().catch(e => {
        console.error('regenerate: ' + (e instanceof RegenerateError ? e.message : (e && e.stack) || String(e)));
        process.exit(2);
    });
}
