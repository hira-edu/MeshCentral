# MeshCentral UMH Control Deployment Ledger

Last Updated: 2026-04-14
Owner: Codex + User
Status: Active deployment ledger for the MeshCentral UMH UI override

## Live Override Path

Current deployed UI override path:

- `/opt/meshcentral/meshcentral-web/public/scripts/custom.js`

Current local source path:

- `C:\Users\Workstation\Documents\GitHub\MeshCentral\public\scripts\custom.js`

## Current UI Alignment

The current tracked UI source removes retired operator controls and keeps the retained subset that matches the live `UserModeHook` control contract through the `MeshAgent` operator layer.

Removed from the UI surface:

- `getInjectionState`
- `disable`
- `disableAll`

Added as the read-only replacements surfaced in the current UI:

- `profileProcess`
- `methodPolicy`
- `securityBoundary`
- `safetyState`

## Deployment Rule

Any UMH UI change in `custom.js` is incomplete until:

1. the local repo copy is updated
2. the sister-repo SSOT/ledger docs are updated
3. the live override file on the MeshCentral VPS is republished
