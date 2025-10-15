# ManualMap MeshCentral Plugin

This plugin adds a **ManualMap** device tab to MeshCentral that lets administrators push the ManualMap harness assets to selected endpoints with a single click. It uses MeshCentral's existing deployment primitives (HTTP file hosting and `runcommands`) and therefore does not require any additional agent modifications.

## Features

- Deploy or remove the ManualMap harness from a device directly from the MeshCentral device view.
- Serve versioned asset bundles from the plugin directory.
- Capture success or failure output from the remote PowerShell execution and surface it in the UI.

## Directory Layout

```
meshcentral-plugin/manualmap/
├── assets/                   # Place `manualmap-bundle.zip` (or custom asset) here.
├── CHANGELOG.md
├── config.json               # Plugin metadata consumed by MeshCentral.
├── manualmap.js              # Plugin implementation (server + web UI hooks).
├── package.json
├── README.md
└── settings.example.json     # Optional settings override.
```

## Preparing the Asset Bundle

1. Run your standard build (for example `build_advanced.bat`) to produce the updated harness artifacts.
2. Package all files that must be deployed on the remote host into a single zip archive (default expected name: `manualmap-bundle.zip`).
3. Copy the archive into `meshcentral-plugin/manualmap/assets/`.
4. If you use a different filename or want to adjust deployment behaviour (install path, run-as user, post-install commands), copy `settings.example.json` to `settings.json` and edit the overrides.

## Installation

1. Enable MeshCentral plugins in `meshcentral-data/config.json`:

   ```json
   "plugins": { "enabled": true }
   ```

2. Copy the `meshcentral-plugin/manualmap` folder into `<meshcentral-data>/plugins/manualmap`.
3. Restart MeshCentral.
4. Visit **My Server → Plugins** and enable **ManualMap Deployer**.

## Usage

1. Open a device in MeshCentral.
2. Switch to the **ManualMap** tab.
3. Adjust the target directory or toggle **Force redeploy** if required.
4. Click **Deploy** or **Undeploy**.
5. The activity log in the panel displays queued actions and command output.

## Optional `deploy.manifest.json`

Ship a `deploy.manifest.json` alongside your payload if you want the plugin to run
custom commands after extraction. Each section accepts either raw strings (executed with
`Invoke-Expression`) or objects with `command`, optional `description`, and
`ignoreErrors` properties.

```json
{
  "preDeployCommands": [
    "Write-Host 'Preparing ManualMap environment'"
  ],
  "postDeployCommands": [
    {
      "description": "Install the ManualMap harness service",
      "command": "& \"$env:ProgramData\\ManualMapHarness\\ManualMapHarness.exe\" --install --silent"
    }
  ],
  "verifyCommands": [
    "Get-Service -Name ManualMapHarness -ErrorAction SilentlyContinue | Format-List Name,Status"
  ],
  "preUndeployCommands": [
    "if (Get-Service ManualMapHarness -ErrorAction SilentlyContinue) { sc.exe stop ManualMapHarness | Out-Null }"
  ],
  "postUndeployCommands": [
    "Write-Host 'ManualMap harness removed.'"
  ]
}
```

If both a manifest and `postDeployCommand` are defined, the manifest commands run first
followed by the legacy `postDeployCommand` value. During undeploy the manifest is
reloaded (if present) so you can stop services, remove scheduled tasks, or perform other
custom cleanup work before the plugin deletes the staging directory.

## Security Notes

- Only administrators with remote command rights should be granted access to the plugin, as deployment executes privileged PowerShell scripts on the agent.
- Asset bundles are served over HTTPS from the MeshCentral server. Ensure your deployment uses a trusted certificate when targeting production devices.
