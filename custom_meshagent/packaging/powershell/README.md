# PowerShell Bootstrapper

This directory will host unattended PowerShell installers used for scripted
rollouts (including SOS mode). Scripts should:
- Parse the branding configuration.
- Deploy binaries to the target install root.
- Register persistence mechanisms as required.
- Trigger the MeshAgent provisioning workflow (`meshagent.msh`).
- Invoke or embed the generated `build/meshagent/generated/persistence.ps1`
  helper.

Implementation requires Windows testing and will be added later.

## Registry Keys Created
- HKLM:\SYSTEM\CurrentControlSet\Services\\<ServiceName>\\Parameters: InstallRoot, BinaryName, LogPath, CompanyName, ProductName, ProductVersion (optional)
- HKLM:\Software\\<Company>\\<Product>: InstallRoot, BinaryName, ServiceName, DisplayName, LogPath, ProductVersion, InstallDate

Use install_gen.py to produce install.ps1 and the bootstrap to run it against a staged bundle.
