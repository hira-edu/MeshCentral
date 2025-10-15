# Bypass Methods MeshCentral Plugin

This plugin exposes a **Bypass Methods** tab in MeshCentral that stages and runs the [Bypass Methods Framework](https://github.com/hira-edu/bypass-methods) on selected Windows endpoints. It delivers a zipped bundle, expands it into a chosen staging directory, and executes the framework's `scripts\build_windows.ps1` pipeline to bootstrap the full DirectX/API hooking environment.

## Features

- Serve a versioned `bypassmethods-bundle.zip` bundle directly from MeshCentral.
- One-click deploy, undeploy, and status actions from the device view.
- Optional controls for skipping prerequisite installers/tests and auto-launching the GUI controller post-install.
- SHA-256 validation of the bundle and structured log streaming back to the browser.

## Directory Layout

```
meshcentral-data/plugins/bypassmethods/
├── assets/                   # Place `bypassmethods-bundle.zip` here (framework bundle).
├── bypassmethods.js          # Plugin implementation (server + web UI hooks).
├── config.json               # Plugin metadata consumed by MeshCentral.
├── package.json
├── README.md
└── settings.example.json     # Optional overrides for defaults (deploy dir, flags, etc.).
```

## Preparing the Bundle

1. Build or export the Bypass Methods framework (for example, clone the repo and prepare the required scripts and binaries).
2. Create an archive named `bypassmethods-bundle.zip`. The bundle **must** contain the framework's `scripts\build_windows.ps1` (either at the root or under a `bypass-methods` subdirectory). Include any prerequisite binaries you want staged locally to avoid network downloads.
3. Copy the archive into `meshcentral-data/plugins/bypassmethods/assets/` on the MeshCentral server.
4. (Optional) Copy `settings.example.json` to `settings.json` to adjust the default staging directory, run-as mode, or deployment flags.

## Installation

1. Ensure plugins are enabled in `meshcentral-data/config.json`:
   ```json
   "plugins": { "enabled": true }
   ```
2. Copy the `bypassmethods` folder into `<meshcentral-data>/plugins/`.
3. Restart MeshCentral.
4. From **My Server → Plugins**, enable **Bypass Methods Deployer**.

## Usage

1. Open a device page in MeshCentral and switch to **Bypass Methods**.
2. Configure the staging directory or toggle the deployment options (skip prerequisites/tests, auto-launch GUI, force redeploy).
3. Click **Deploy** to push the bundle, extract it, and run the build bootstrap.
4. Use **Check Status** to confirm agent connectivity and **Undeploy** to remove the staged files.

## Notes

- Running the framework requires administrative privileges and may install additional tooling (Python, Visual Studio Build Tools, etc.) unless you provide a pre-built bundle and disable the prerequisite step.
- The plugin executes PowerShell as SYSTEM (`runcommands` type `2`). Limit usage to trusted operators.
- The build process can take several minutes on first run depending on prerequisites.
