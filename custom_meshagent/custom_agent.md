# Custom MeshAgent Toolkit

This repository collects documentation and build scripts for producing
branded MeshAgent binaries (standard and SOS variants) tailored for
MeshCentral deployments. The focus is on service/process renaming,
custom install footprints, network obfuscation, and automated
packaging/testing.

## Quick Start (Design
IN PROGRESS)
- Review `docs/MESHAGENT_CUSTOM_BUILD_PLAN.md` for the full blueprint.
- Prepare a Windows build host with the MeshCentral source tree and
  required toolchains (MSVC/MinGW, NSIS, PowerShell, Authenticode certs).
- Follow the implementation roadmap to automate fetch → patch →
  compile → package → sign.

## Repository Layout
```
docs/   # Plans, SOPs, design notes
scripts/ (future) build automation
packaging/ (future) installers and resources
```

> Note: This repository currently contains planning artifacts only. Code
> modules and build automation will be added during implementation.
