'use strict';
// Mobile templates load the redirector, but not custom.js. Bundle only its
// standalone audio control into both served redirectors, avoiding page forks
// and avoiding loading unrelated custom desktop features on mobile.
const fs = require('node:fs');
const path = require('node:path');
const scripts = path.join(__dirname, '../../public/scripts');
const webScripts = path.join(__dirname, '../meshcentral-web/public/scripts');
const marker = '// BEGIN GENERATED DESKTOP AUDIO CONTROL';
const custom = fs.readFileSync(path.join(webScripts, 'custom.js'), 'utf8');
const guard = custom.indexOf('  if (window.__meshDesktopAudioControl)');
if (guard < 0) throw new Error('Audio control marker missing');
const start = custom.lastIndexOf('(function () {', guard);
const control = custom.slice(start).trim();
if (!control.endsWith('})();')) throw new Error('Audio control must be the final custom.js block');
for (const name of ['agent-redir-ws-0.1.1.js', 'agent-redir-ws-0.1.1-min.js']) {
    const file = path.join(scripts, name);
    const existing = fs.readFileSync(file, 'utf8');
    const eol = existing.includes('\r\n') ? '\r\n' : '\n';
    const bundled = control.replace("  'use strict';", "  'use strict';" + eol + "  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof document.createElement !== 'function') return;");
    const base = existing.split(marker)[0].trimEnd();
    const output = base + eol + eol + marker + eol + ';' + bundled + eol;
    if (process.argv.includes('--check')) {
        if (existing !== output) throw new Error(name + ': regenerate desktop audio control');
    } else { fs.writeFileSync(file, output); }
}
