# ManualMap Assets

Place the deployment archive (default name: `manualmap-bundle.zip`) in this directory. The plugin
will expose the file over HTTPS at `/plugins/manualmap/assets/<filename>` for connected MeshAgents.

If you include a `deploy.manifest.json` inside the archive (at the root of the extracted payload),
the plugin will execute the defined `preDeployCommands`, `postDeployCommands`, `verifyCommands`,
`preUndeployCommands`, and `postUndeployCommands` when handling deploy/undeploy actions.
