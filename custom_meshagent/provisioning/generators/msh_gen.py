#!/usr/bin/env python3
"""Standalone generator for meshagent.msh provisioning files.

Reads branding/provisioning fields from a config (JSON) and writes a
MeshCentral-compatible `.msh` file. Mirrors the logic used by the main
build orchestrator, but allows decoupled use.
"""

from __future__ import annotations

import argparse
import json
import pathlib
from typing import Any, Dict


def load_config(p: pathlib.Path) -> Dict[str, Any]:
    return json.loads(p.read_text(encoding="utf-8"))


def write_msh(cfg: Dict[str, Any], out: pathlib.Path) -> None:
    branding = cfg.get("branding", {})
    prov = cfg.get("provisioning", {})
    lines = [
        f"MeshName={prov.get('meshName','')}",
        f"MeshType={prov.get('meshType','')}",
        f"MeshID={prov.get('meshId','')}",
        f"ServerID={prov.get('serverId','')}",
        f"MeshServer={prov.get('serverUrl','')}",
    ]
    if branding.get('serviceName'):
        lines.append(f"meshServiceName={branding.get('serviceName')}")
    if branding.get('displayName'):
        lines.append(f"displayName={branding.get('displayName')}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[msh-gen] wrote {out}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Generate meshagent.msh from config")
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", default="build/meshagent/generated/meshagent.msh")
    args = ap.parse_args(argv)

    cfg = load_config(pathlib.Path(args.config))
    write_msh(cfg, pathlib.Path(args.out))


if __name__ == "__main__":
    main()

