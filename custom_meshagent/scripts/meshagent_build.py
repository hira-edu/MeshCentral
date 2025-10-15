#!/usr/bin/env python3
"""Custom MeshAgent build orchestrator (Windows only).

This script prepares, patches, and packages branded MeshAgent artifacts in
accordance with docs/MESHAGENT_CUSTOM_BUILD_PLAN.md. The implementation focuses
on modular tasks so Windows CI can call individual phases.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from typing import Any, Dict

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "custom_meshagent" / "configs"
PATCH_DIR = ROOT / "custom_meshagent" / "src" / "meshagent" / "patches"


def load_config(path: pathlib.Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    inherit = data.get("inheritFrom")
    if inherit:
        parent_data = load_config((path.parent / inherit).resolve())
        parent_data.update({k: v for k, v in data.items() if k != "inheritFrom"})
        return parent_data
    return data


def run_command(cmd: list[str], cwd: pathlib.Path | None = None) -> None:
    print(f"[meshagent-build] exec: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def cmd_validate(args: argparse.Namespace) -> None:
    config_path = CONFIG_DIR / args.config
    if not config_path.exists():
        raise SystemExit(f"config not found: {config_path}")
    _ = load_config(config_path)
    print(f"[meshagent-build] validated {config_path}")


def cmd_prepare(args: argparse.Namespace) -> None:
    # Placeholder: fetch/update upstream submodule(s), ensure toolchain present
    print("[meshagent-build] prepare step placeholder (Windows implementation required)")


def cmd_patch(args: argparse.Namespace) -> None:
    # Placeholder: apply patch sets under PATCH_DIR
    print("[meshagent-build] patch step placeholder (requires Windows tooling)")


def cmd_package(args: argparse.Namespace) -> None:
    print("[meshagent-build] package step placeholder (Windows NSIS/PowerShell required)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Custom MeshAgent build pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    validate = sub.add_parser("validate", help="Validate branding config inheritance")
    validate.add_argument("--config", default="meshagent.json", help="Config filename within configs/")
    validate.set_defaults(func=cmd_validate)

    prepare = sub.add_parser("prepare", help="Fetch upstream bits and ensure toolchain")
    prepare.set_defaults(func=cmd_prepare)

    patch = sub.add_parser("patch", help="Apply custom patch sets")
    patch.set_defaults(func=cmd_patch)

    package = sub.add_parser("package", help="Build and package installers (Windows only)")
    package.add_argument("--config", default="meshagent.json")
    package.set_defaults(func=cmd_package)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main(sys.argv[1:])
