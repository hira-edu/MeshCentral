# PowerShell Bootstrapper

This directory will host unattended PowerShell installers used for scripted
rollouts (including SOS mode). Scripts should:
- Parse the branding configuration.
- Deploy binaries to the target install root.
- Register persistence mechanisms as required.
- Trigger the MeshAgent provisioning workflow.

Implementation requires Windows testing and will be added later.
