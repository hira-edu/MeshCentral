'use strict';
// Preloaded (node -r) into upstream translate/translate.js and its worker threads by
// deploy/scripts/regenerate.js. It makes translate.js's output a function of its input only.
//
// 1. Line endings. translate.js joins translated .txt emails with os.EOL. The published 1.2.5 files
//    were made on Windows (CRLF), so the line ending is fixed here for every host.
//
// 2. Random placeholders. html-minifier-terser swaps ignored fragments (<?...?>, <%...%>, htmlmin:ignore
//    blocks) for placeholder ids from Math.random() before terser runs. terser picks mangled names by
//    character frequency, and the placeholder's characters are counted, so a script that contains for
//    example '<?xml version="1.0"?>' gets different variable names from run to run
//    (amt-wsman-0.2.0-min.js has flipped between two variants across upstream releases). Each minify()
//    call therefore runs with Math.random replaced by a generator seeded from SEED_SALT and the call's
//    input. uniqueId() runs in minify()'s synchronous prefix, before its first await, so restoring
//    Math.random when the call returns covers it. SEED_SALT is the first salt (counting from 0) with
//    which every committed 1.2.5 file is reproduced (salts 0-2 give amt-wsman-0.2.0-min.js its other
//    variant); changing it can flip such files to their other variant (same code, swapped local names).
//    The seed ignores line endings, so CRLF and LF checkouts give the same output.
const crypto = require('node:crypto');
const Module = require('node:module');
const os = require('node:os');

const SEED_SALT = '3';

const eol = process.env.MESHCENTRAL_REGEN_EOL;
if (eol !== '\r\n' && eol !== '\n') {
    throw new Error('regen-preload: MESHCENTRAL_REGEN_EOL must be CRLF or LF');
}
Object.defineProperty(os, 'EOL', { value: eol, configurable: true, enumerable: true, writable: false });

// sfc32, seeded with 128 bits of SHA-256.
function seededRandom(text) {
    const h = crypto.createHash('sha256').update(SEED_SALT + '\0' + text).digest();
    let a = h.readUInt32LE(0), b = h.readUInt32LE(4), c = h.readUInt32LE(8), d = h.readUInt32LE(12);
    return function () {
        a |= 0; b |= 0; c |= 0; d |= 0;
        const t = (((a + b) | 0) + d) | 0;
        d = (d + 1) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

const load = Module._load;
Module._load = function (request) {
    const exported = load.apply(this, arguments);
    if (request === 'html-minifier-terser' && exported && typeof exported.minify === 'function' && !exported.minify.regenSeeded) {
        const minify = exported.minify;
        const seeded = function (value) {
            const saved = Math.random;
            // Line endings do not change the minified output, so they must not change the seed either.
            Math.random = seededRandom(String(value).split('\r\n').join('\n'));
            try { return minify.apply(this, arguments); } finally { Math.random = saved; }
        };
        seeded.regenSeeded = true;
        exported.minify = seeded;
    }
    return exported;
};
