#!/usr/bin/env python3
"""Utility to ensure patch sets apply cleanly against upstream MeshAgent source."""

from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PATCH_DIR = ROOT / "custom_meshagent" / "src" / "meshagent" / "patches"


def run_patch(patch: pathlib.Path, upstream_dir: pathlib.Path, check: bool) -> bool:
    cmd = [
        "git",
        "apply",
        "--check" if check else "--apply",
        str(patch),
    ]
    print(f"[patch-validate] {'checking' if check else 'applying'} {patch}")
    result = subprocess.run(cmd, cwd=str(upstream_dir))
    return result.returncode == 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Validate MeshAgent patch sets")
    parser.add_argument("--upstream", default=str((ROOT / ".." / "MeshAgent").resolve()), help="Path to upstream MeshAgent repo root")
    parser.add_argument("--apply", action="store_true", help="Actually apply patches (dev use only)")
    args = parser.parse_args(argv)

    upstream_dir = pathlib.Path(args.upstream).resolve()
    if not upstream_dir.exists():
        print(f"[patch-validate] upstream path not found: {upstream_dir}")
        raise SystemExit(2)

    failures = []
    for patch in sorted(PATCH_DIR.rglob("*.patch")):
        ok = run_patch(patch, upstream_dir, check=not args.apply)
        if not ok:
            failures.append(patch)
            if not args.apply:
                break

    if failures:
        print(f"[patch-validate] failed patches: {failures}")
        raise SystemExit(1)
    print("[patch-validate] all patches valid")


if __name__ == "__main__":
    main(sys.argv[1:])
