/* Minimal MeshCentral plugin to expose an admin panel and a deploy API.
   Note: This uses a simple placeholder endpoint. Integrate with your existing
   device selection + task queuing pattern from other plugins for full rollout. */

module.exports = {
  start: function(env) {
    const plugin = {};
    plugin.name = 'stfdeploy';
    plugin.title = 'Security Testing Framework Deployer';
    plugin.meshServer = env.parent;
    plugin.express = env.expressApp;

    // Admin panel route
    plugin.express.get('/plugin/stfdeploy/admin', function(req, res) {
      res.render(__dirname + '/views/admin.handlebars', { layout: false });
    });

    // Simple API to queue deploy (placeholder)
    plugin.express.post('/plugin/stfdeploy/api/deploy', function(req, res) {
      // TODO: integrate with your existing plugin task runner to:
      // 1) Ensure /plugins/stfdeploy/assets/latest.zip exists
      // 2) Push to selected devices and run install per STF docs
      res.send('Deploy request accepted. (Hook into your task runner here)');
    });

    return plugin;
  }
};

