# Bypass Methods Assets

Place `bypassmethods-bundle.zip` in this directory. The plugin will expose the archive to MeshAgents
at `/plugins/bypassmethods/assets/<filename>` during deployment. Add a `deploy.manifest.json` to the
bundle if you want to run custom `preDeployCommands`, `postDeployCommands`, `verifyCommands`, or
undeploy hooks around the framework's build process.
