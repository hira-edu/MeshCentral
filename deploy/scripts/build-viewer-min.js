'use strict';
// Regenerate the fork's minified viewer scripts from their sources, or with --check fail when a
// checked-in -min.js no longer matches. agent-desktop-0.0.2-min.js is uglify-js output with default
// compress and mangle plus a trailing newline. The uglify-js used is the one the production lockfile
// already installs (via handlebars); a different version produces different output, so it must match.
// agent-redir-ws-0.1.1-min.js is not built here: it is upstream's minified file with the fork's
// protocol-2 connect deferral edited in, followed by the block build-desktop-audio-control.js appends.
const fs = require('node:fs');
const path = require('node:path');

const UGLIFY_VERSION = '3.19.3';
const scripts = path.join(__dirname, '../../public/scripts');
const uglifyRoot = path.dirname(require.resolve('uglify-js/package.json', { paths: [path.join(__dirname, '..')] }));
const installed = JSON.parse(fs.readFileSync(path.join(uglifyRoot, 'package.json'), 'utf8')).version;
if (installed !== UGLIFY_VERSION) {
    throw new Error('uglify-js ' + installed + ' is installed; the viewer min files are built with ' + UGLIFY_VERSION);
}
const uglify = require(uglifyRoot);

const failures = [];
for (const name of ['agent-desktop-0.0.2.js']) {
    const source = fs.readFileSync(path.join(scripts, name), 'utf8');
    const result = uglify.minify(source, { compress: {}, mangle: {} });
    if (result.error) throw result.error;
    const minName = name.replace(/\.js$/, '-min.js');
    const output = result.code + '\n';
    const existing = fs.readFileSync(path.join(scripts, minName), 'utf8').replace(/\r\n/g, '\n');
    if (process.argv.includes('--check')) {
        if (existing !== output) failures.push(minName);
    } else if (existing !== output) {
        fs.writeFileSync(path.join(scripts, minName), output);
        console.log('updated ' + minName);
    }
}
if (failures.length) throw new Error(failures.join(', ') + ': regenerate with node scripts/build-viewer-min.js');
