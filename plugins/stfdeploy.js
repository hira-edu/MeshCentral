// Loader shim so MeshCentral can `require('./plugins/stfdeploy')`
// and still load the implementation in ./stfdeploy/stfdeploy.js
module.exports = require('./stfdeploy/stfdeploy.js');

