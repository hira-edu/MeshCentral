Build and Publish Custom MeshCentral Agents

Overview
- Wraps `custom_meshagent/scripts/meshagent_build.py` to build x64/x86 Windows agents.
- Archives results under a timestamped folder on the server.
- Optional: publishes to `meshcentral-data/agents` and restarts MeshCentral.

Prerequisites
- Python 3 available as `python3`.
- MeshCentral repo checked out with subfolder `MeshAgent` present for branding generation.
- Your custom core binaries available on the server (x64/x86) if you package using `--binary-*`.
- Systemd service named `meshcentral` (or compatible `meshcentral.service`).

Usage
1) Build and archive both x64 and x86:
   ./build_and_publish.sh \
     --config MeshCentral/custom_meshagent/configs/meshagent.json \
     --binary-x64 /path/to/YourCustomCore_x64.exe \
     --binary-x86 /path/to/YourCustomCore_x86.exe \
     --store /opt/meshcentral/meshcentral-data/agents-archive

2) Also publish to live and restart MeshCentral:
   ./build_and_publish.sh \
     --binary-x64 /path/to/YourCore64.exe \
     --binary-x86 /path/to/YourCore86.exe \
     --publish-live --restart

Outputs
- Archive folder: `/opt/meshcentral/meshcentral-data/agents-archive/YYYYMMDD-HHMMSS/`
  - MeshService64.exe (if built)
  - MeshService.exe (if built)
  - sha256sums.txt
  - manifest.json (names, sha256, sizes)

Serving Archives Over HTTP (optional)
- Symlink the archive store into MeshCentral public web root:
  ln -s /opt/meshcentral/meshcentral-data/agents-archive /opt/meshcentral/meshcentral-web/public/agents-archive
- Then browse to: https://high.support/agents-archive/<timestamp>/

Notes
- MeshCentral will serve the drop-in binaries from `meshcentral-data/agents` via the standard `/meshagents?id=3|4` endpoints.
- Keep `agentSignLock` and cert pinning in mind if rotating TLS certificates; you may need to temporarily relax pinning for older agents.

