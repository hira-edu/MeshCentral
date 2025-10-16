# Custom MeshAgent Toolkit

This repository contains the documentation and build scripts for producing branded MeshAgent binaries (standard and SOS variants) tailored for MeshCentral deployments. Scope is Windows (x64/x86).

## Quick Start
- Review MESHAGENT_CUSTOM_BUILD_PLAN.md for the blueprint and repository layout.
- Prepare a Windows host with MeshAgent sources and toolchains (MSVC, PowerShell, optional NSIS/WiX).
- Validate and generate build artifacts using the provided config:

`
python custom_meshagent/scripts/meshagent_build.py validate --config custom_meshagent/configs/meshagent.json
python custom_meshagent/scripts/meshagent_build.py generate --config custom_meshagent/configs/meshagent.json --meshagent-root ..\MeshAgent
`

- Apply custom patches (optional, when ready):

`
python custom_meshagent/scripts/patch_validate.py --upstream ..\MeshAgent
python custom_meshagent/scripts/meshagent_build.py patch --upstream ..\MeshAgent
`

## Repository Layout
`
docs/           # Plans, SOPs, design notes
packaging/      # Installers (NSIS/PowerShell/WiX) – placeholders
provisioning/   # msh templates + generators – placeholders
scripts/        # Build/patch orchestration
src/meshagent/  # Patch sets (branding/network/sos)
tests/          # Test plan and placeholders
configs/        # Branding + deployment configs and schema
build/          # Generated artifacts (gitignored)
`

> Note: Some directories contain placeholders to be completed in later phases per the build plan.
