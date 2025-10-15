# SetWindowDisplayAffinity Bypass MeshCentral Plugin

This plugin exposes an **Affinity Bypass** tab in MeshCentral that stages and loads the InfinityHook (SetWindowDisplayAffinity bypass) driver on selected Windows endpoints. It uses MeshCentral's built-in file hosting plus `runcommands` to deliver a zipped payload, install the driver service, and start it under the requested service name.

## Features

- Serve a versioned InfinityHook bundle (`swdabypass-bundle.zip`) directly from MeshCentral.
- One-click deployment, status, and removal of the driver service through the device view.
- SHA-256 validation of the payload before execution and rich log output back to the browser.
- Optional force redeploy for reinstalling over an existing service and configurable staging path/service name.

## Directory Layout

```
meshcentral-data/plugins/swdabypass/
├── assets/                   # Place `swdabypass-bundle.zip` (driver + scripts) here.
├── config.json               # Plugin metadata consumed by MeshCentral.
├── package.json
├── README.md
├── settings.example.json     # Optional overrides for deploy directory, service name, etc.
└── swdabypass.js             # Plugin implementation (server + web UI hooks).
```

## Preparing the Asset Bundle

1. Build or copy the InfinityHook artifacts (from the `Bypass-SetWindowDisplayAffinity` project).
2. Create a zip archive named `swdabypass-bundle.zip` that contains at least:
   - `infinity_hook_pro_max.sys`
   - `infinity_hook_pro_max.inf`
   - `infinity_hook_pro_max.cat`
   - `verify_bypass.ps1`
3. Drop the archive into `meshcentral-data/plugins/swdabypass/assets/`.
4. (Optional) Copy `settings.example.json` to `settings.json` to override the staging directory, service name, or MeshAgent run mode.

## Installation

1. Ensure plugins are enabled in `meshcentral-data/config.json`:
   ```json
   "plugins": { "enabled": true }
   ```
2. Copy the `swdabypass` folder into `<meshcentral-data>/plugins/`.
3. Restart MeshCentral.
4. From **My Server → Plugins**, enable **Affinity Bypass Deployer**.

## Usage

1. Open a device page in MeshCentral.
2. Select the **Affinity Bypass** tab.
3. Adjust the staging directory, kernel service name, or force redeploy flag as needed.
4. Click **Deploy** to push the bundle, copy the driver into `System32\drivers`, register the service, and start it.
5. Use **Check Status** to confirm the agent is online and **Undeploy** to stop/delete the service and remove on-disk artifacts.

## Optional `deploy.manifest.json`

Add a `deploy.manifest.json` to the bundle if you need custom steps before/after the built-in
driver workflow. Example:

```json
{
  "preDeployCommands": [
    "Write-Host 'Preparing host for InfinityHook deployment'"
  ],
  "postDeployCommands": [
    {
      "description": "Run the verification script",
      "command": "& \"$env:ProgramData\\InfinityHook\\verify_bypass.ps1\" -Verbose",
      "ignoreErrors": true
    }
  ],
  "verifyCommands": [
    "Get-Service -Name InfinityHookPro -ErrorAction SilentlyContinue | Format-List Name,Status"
  ],
  "preUndeployCommands": [
    "Write-Host 'Stopping InfinityHookPro before removal'; sc.exe stop InfinityHookPro | Out-Null"
  ]
}
```

`preDeployCommands`, `postDeployCommands`, `verifyCommands`, `preUndeployCommands`, and
`postUndeployCommands` run within the same PowerShell session as the plugin's core logic, so you can
reference environment variables or files laid down by the bundle. Commands can be strings or objects
with `command`, `description`, and `ignoreErrors` fields.

## Notes & Safety

- Loading unsigned kernel drivers requires administrative privileges and typically demands Windows test-signing mode (`bcdedit /set testsigning on`) with Secure Boot disabled.
- The plugin executes PowerShell as `runcommands` type 2 (SYSTEM). Restrict usage to trusted operators.
- Always validate the bundle contents and hashes before deploying to production systems.
