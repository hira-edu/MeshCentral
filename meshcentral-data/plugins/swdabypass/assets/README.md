# Affinity Bypass Assets

Drop `swdabypass-bundle.zip` (InfinityHook driver bundle) into this directory. The plugin exposes the
archive over HTTPS at `/plugins/swdabypass/assets/<filename>` for MeshAgents to download during
deployment. Include an optional `deploy.manifest.json` inside the archive to run custom pre/post
deployment or undeployment commands around the default driver workflow.
