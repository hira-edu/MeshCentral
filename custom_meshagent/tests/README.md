# Custom MeshAgent Test Plan

Tests are split into three buckets:
- `unit/`: resource/version metadata validation, config schema checks.
- `functional/`: Windows VM installs verifying service name, registry keys,
  persistence mechanisms, and watchdog behaviour.
- `installer/`: smoke tests for NSIS/PowerShell packages (exit codes, silent
  install/uninstall).

Windows hosts are required for execution; placeholder directories contain `.gitkeep`
files until tests are authored.
