// Runs inside a MeshAgent console build (Duktape), not Node:
//
//   MeshConsole64.exe duktape-compile-check.js <list-file>
//
// <list-file> holds one absolute path per line. Each file is compiled with new Function(), the
// same function-body form addModule() uses, without running it. Prints one line per file:
//   OK <path>
//   FAIL <path> <error>
// and a final "DONE <ok> <failed>" line. Exit code 0 when every file compiled, 1 otherwise.
var fs = require('fs');
var args = process.argv;
var listFile = args[args.length - 1];
var ok = 0, failed = 0;
try {
    var list = fs.readFileSync(listFile).toString().split(/\r?\n/);
    for (var i = 0; i < list.length; i++) {
        var file = list[i];
        if (file.length == 0) { continue; }
        try {
            new Function(fs.readFileSync(file).toString());
            ok++;
            console.log('OK ' + file);
        } catch (e) {
            failed++;
            console.log('FAIL ' + file + ' ' + e);
        }
    }
} catch (e) {
    failed++;
    console.log('FAIL ' + listFile + ' ' + e);
}
console.log('DONE ' + ok + ' ' + failed);
process.exit(failed == 0 ? 0 : 1);
