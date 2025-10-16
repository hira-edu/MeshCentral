#!/usr/bin/env python3
"""Synthesize minimal branding patches against an upstream MeshAgent tree.

This tool creates a temporary git repository from the upstream path, applies
small, well-defined edits to honor generated branding headers, commits them,
and exports `git format-patch` outputs into `src/meshagent/patches/branding`.

No changes are made to your upstream working copy. The temporary repository is
created under `build/meshagent/tmp_patchbuild` and removed on success.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import stat
import subprocess
import sys
from typing import Callable

ROOT = pathlib.Path(__file__).resolve().parents[2]
PATCH_OUT = ROOT / "custom_meshagent" / "src" / "meshagent" / "patches" / "branding"
TMP_ROOT = ROOT / "custom_meshagent" / "build" / "meshagent" / "tmp_patchbuild"


def run(cmd: list[str], cwd: pathlib.Path) -> str:
    print(f"[make-patches] $ {' '.join(cmd)}")
    out = subprocess.run(cmd, cwd=str(cwd), check=True, capture_output=True, text=True)
    return out.stdout.strip()


def edit_text(path: pathlib.Path, transform: Callable[[str], str]) -> bool:
    text = path.read_text(encoding="utf-8", errors="ignore")
    new = transform(text)
    if new != text:
        path.write_text(new, encoding="utf-8")
        return True
    return False


def transform_agentcore(text: str) -> str:
    insert_after = "#include \"agentcore.h\""
    include_block = (
        "#if defined(_MSC_VER)\n"
        "#if defined(__has_include)\n"
        "#  if __has_include(\"generated/meshagent_branding.h\")\n"
        "#    include \"generated/meshagent_branding.h\"\n"
        "#  endif\n"
        "#endif\n"
        "#endif\n\n"
        "#ifndef MESH_AGENT_SERVICE_FILE_A\n"
        "#define MESH_AGENT_SERVICE_FILE_A \"Mesh Agent\"\n"
        "#endif\n"
    )
    if insert_after in text and include_block not in text:
        text = text.replace(insert_after, insert_after + "\n" + include_block, 1)

    # Replace default Windows service name string with macro
    text = text.replace(
        "agentHost->meshServiceName = \"Mesh Agent\";",
        "agentHost->meshServiceName = MESH_AGENT_SERVICE_FILE_A;",
    )
    return text


def transform_servicemain(text: str) -> str:
    # Insert include near headers
    hdr_anchor = "#include <WtsApi32.h>"
    include_block = (
        "#if defined(_MSC_VER)\n"
        "#if defined(__has_include)\n"
        "#  if __has_include(\"../meshcore/generated/meshagent_branding.h\")\n"
        "#    include \"../meshcore/generated/meshagent_branding.h\"\n"
        "#  endif\n"
        "#endif\n"
        "#endif\n\n"
        "#ifndef MESH_AGENT_SERVICE_FILE\n"
        "#define MESH_AGENT_SERVICE_FILE TEXT(\"Mesh Agent\")\n"
        "#endif\n"
        "#ifndef MESH_AGENT_SERVICE_NAME\n"
        "#define MESH_AGENT_SERVICE_NAME TEXT(\"Mesh Agent background service\")\n"
        "#endif\n"
    )
    if hdr_anchor in text and include_block not in text:
        text = text.replace(hdr_anchor, hdr_anchor + "\n" + include_block, 1)

    # Set defaults via macros
    text = text.replace(
        'TCHAR* serviceFile = TEXT("Mesh Agent");',
        'TCHAR* serviceFile = MESH_AGENT_SERVICE_FILE;',
    )
    text = text.replace(
        'TCHAR* serviceName = TEXT("Mesh Agent background service");',
        'TCHAR* serviceName = MESH_AGENT_SERVICE_NAME;',
    )
    # Dialog fallback
    text = text.replace(
        '"meshServiceName", "Mesh Agent"',
        '"meshServiceName", MESH_AGENT_SERVICE_FILE_A',
    )
    return text


def transform_rc(text: str) -> str:
    # Ensure include of branding header (safe for Unicode RCs parsed as text)
    text = text.replace(
        '#include "resource.h"',
        '#include "resource.h"\n#if defined(_MSC_VER)\n#include "../meshcore/generated/meshagent_branding.h"\n#endif',
        1,
    )
    # Replace fixed strings with macros
    text = text.replace(
        'VALUE "FileDescription",', 'VALUE "FileDescription", MESH_AGENT_FILE_DESCRIPTION',
    )
    text = text.replace(
        'VALUE "ProductName",', 'VALUE "ProductName", MESH_AGENT_PRODUCT_NAME',
    )
    return text


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Create branding patches for MeshAgent")
    ap.add_argument("--upstream", default=str((ROOT / ".." / "MeshAgent").resolve()))
    ap.add_argument("--outdir", default=str(PATCH_OUT.resolve()))
    ap.add_argument("--keep-tmp", action="store_true")
    args = ap.parse_args(argv)

    upstream = pathlib.Path(args.upstream).resolve()
    outdir = pathlib.Path(args.outdir).resolve()
    if not upstream.exists():
        raise SystemExit(f"upstream not found: {upstream}")

    # Reset tmp dir
    if TMP_ROOT.exists():
        shutil.rmtree(TMP_ROOT)
    def _ignore(dir, names):
        return {".git"} if ".git" in names else set()
    shutil.copytree(upstream, TMP_ROOT, ignore=_ignore)

    # Init temporary repo and baseline commit
    run(["git", "init"], TMP_ROOT)
    run(["git", "add", "."], TMP_ROOT)
    run(["git", "-c", "user.email=devnull@example.com", "-c", "user.name=patchbot", "commit", "-m", "baseline"], TMP_ROOT)
    baseline = run(["git", "rev-parse", "HEAD"], TMP_ROOT)

    # Apply transforms and commit each as a separate changeset
    changed_any = False
    ac = TMP_ROOT / "meshcore" / "agentcore.c"
    if ac.exists() and edit_text(ac, transform_agentcore):
        run(["git", "add", str(ac.relative_to(TMP_ROOT))], TMP_ROOT)
        run(["git", "commit", "-m", "agentcore: include branding header and macro defaults"], TMP_ROOT)
        changed_any = True

    sm = TMP_ROOT / "meshservice" / "ServiceMain.c"
    if sm.exists() and edit_text(sm, transform_servicemain):
        run(["git", "add", str(sm.relative_to(TMP_ROOT))], TMP_ROOT)
        run(["git", "commit", "-m", "meshservice: include branding header and use macros"], TMP_ROOT)
        changed_any = True

    rc1 = TMP_ROOT / "meshservice" / "MeshService.rc"
    if rc1.exists() and edit_text(rc1, transform_rc):
        run(["git", "add", str(rc1.relative_to(TMP_ROOT))], TMP_ROOT)
        run(["git", "commit", "-m", "rc: use branding macros for FileDescription/ProductName"], TMP_ROOT)
        changed_any = True

    rc2 = TMP_ROOT / "meshservice" / "MeshService64.rc"
    if rc2.exists() and edit_text(rc2, transform_rc):
        run(["git", "add", str(rc2.relative_to(TMP_ROOT))], TMP_ROOT)
        run(["git", "commit", "-m", "rc64: use branding macros for FileDescription/ProductName"], TMP_ROOT)
        changed_any = True

    if not changed_any:
        print("[make-patches] no changes were made; aborting patch creation")
        if not args.keep_tmp and TMP_ROOT.exists():
            shutil.rmtree(TMP_ROOT)
        return

    # Export patches
    outdir.mkdir(parents=True, exist_ok=True)
    # Clean previous patches to avoid duplicates
    for p in outdir.glob("*.patch"):
        try:
            p.unlink()
        except Exception:
            pass
        run(["git", "format-patch", "-o", str(outdir), "--no-signature", f"{baseline}..HEAD"], TMP_ROOT)
    print(f"[make-patches] patches written to {outdir}")

    def _onerror(func, path, exc_info):
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except Exception:
            pass

    if not args.keep_tmp and TMP_ROOT.exists():
        shutil.rmtree(TMP_ROOT, onerror=_onerror)


if __name__ == "__main__":
    main(sys.argv[1:])
