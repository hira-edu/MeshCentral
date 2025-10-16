Branding Patch Set

Purpose: Centralize minimal changes needed in the upstream MeshAgent sources to honor generated branding without drifting from upstream.

Files to patch (upstream paths):
- `meshcore/agentcore.c`: include `meshcore/generated/meshagent_branding.h` if present and use `MESH_AGENT_SERVICE_FILE_A` for the Windows default service name.
- `meshservice/ServiceMain.c`: include `../meshcore/generated/meshagent_branding.h`; default `serviceFile`/`serviceName` via macros; use `MESH_AGENT_SERVICE_FILE_A` for dialog fallback.
- `meshservice/MeshService.rc` and `meshservice/MeshService64.rc`: include the generated header and use `MESH_AGENT_FILE_DESCRIPTION` and `MESH_AGENT_PRODUCT_NAME`.

Workflow to produce patches cleanly:
1. Ensure the MeshAgent repo is clean: `git status` should show no modifications.
2. Create a topic branch (developer workstation): `git checkout -b branding-includes`.
3. Make the minimal source edits described above.
4. Build to verify no warnings and the generated header exists under `meshcore/generated/`.
5. Create patches: `git format-patch -1 --stdout > 0001-agentcore-include-branding-header.patch` (and subsequent commits similarly).
6. Reset branch if desired: `git reset --hard HEAD~n` to return to a clean state.

Validation:
- Use the helper: `python custom_meshagent/scripts/patch_validate.py --upstream ..\MeshAgent`.

Note:
- This folder currently contains placeholder patches; regenerate them on your workstation to reflect your exact upstream revision.

