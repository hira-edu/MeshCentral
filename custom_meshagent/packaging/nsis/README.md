# NSIS Packaging

Placeholder for Windows NSIS installers. Scripts here should:
- Install to the branded install root.
- Register the custom service name (and optional svchost loader).
- Configure persistence (Run key, scheduled task, WMI subscription) based on
  the selected profile.
- Install logs and configuration files to the new locations.

Implementation deferred to Windows environment. Generated assets of note:
- `meshcore/generated/meshagent_branding.h` – consumed by MeshAgent build.
- `meshservice/generated/<icon>.ico` – branded icon for resources.
- `build/meshagent/generated/persistence.ps1` – configure Run keys, scheduled
  tasks, WMI subscriptions, and watchdog.
- `build/meshagent/generated/meshagent.msh` – provisioning bundle with MeshID
  and server endpoint.
