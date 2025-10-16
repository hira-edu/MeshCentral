#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import textwrap
from typing import Any, Dict


def load_config(path: pathlib.Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def generate_install_ps1(cfg: Dict[str, Any]) -> str:
    branding = cfg.get("branding", {})
    install_root = branding.get("installRoot", r"C:/ProgramData/Agent")
    binary_name = branding.get("binaryName", "meshagent.exe")
    service_name = branding.get("serviceName", "Mesh Agent") or "Mesh Agent"
    display_name = branding.get("displayName", service_name) or service_name
    company = branding.get("companyName", "Vendor")
    product = branding.get("productName", "Agent")
    description = branding.get("description", product)
    log_path = branding.get("logPath", install_root)
    version_info = branding.get("versionInfo", {})
    product_version = version_info.get("productVersion", "")
    artifacts = cfg.get("artifacts", {})
    db_name = artifacts.get("databaseName", "")
    log_file_name = artifacts.get("logFileName", "")
    cfg_name = artifacts.get("configFileName", "")

    return textwrap.dedent(f"""
        # Requires administrative privileges.
        Param(
            [Parameter(Mandatory=$true)][string]$SourceDir,
            [string]$InstallRoot = "{install_root}",
            [string]$BinaryName = "{binary_name}",
            [switch]$UseProxy
        )

        function Assert-Admin {{
            $id = [Security.Principal.WindowsIdentity]::GetCurrent()
            $p = New-Object Security.Principal.WindowsPrincipal($id)
            if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{
                throw "This script requires administrative privileges."
            }}
        }}

        Assert-Admin

        $InstallRoot = $InstallRoot -replace '/', '\\'
        $SourceDir = (Resolve-Path $SourceDir)
        $LogPath = "{log_path}" -replace '/', '\\'

        New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
        if (-not (Test-Path $LogPath)) {{ New-Item -ItemType Directory -Path $LogPath -Force | Out-Null }}

        # ACL: Grant SYSTEM Full Control (recursive) on install and log directories
        $targets = @($InstallRoot, $LogPath)
        foreach ($d in $targets) {{
            try {{
                icacls $d /grant 'NT AUTHORITY\SYSTEM:(OI)(CI)(F)' /T /C | Out-Null
                icacls $d /grant 'BUILTIN\Administrators:(OI)(CI)(F)' /T /C | Out-Null
            }}
            catch {{
                try {{
                    $acl = Get-Acl $d
                    $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                        'NT AUTHORITY\SYSTEM',
                        'FullControl',
                        'ContainerInherit,ObjectInherit',
                        'None',
                        'Allow'
                    )
                    $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                        'BUILTIN\Administrators',
                        'FullControl',
                        'ContainerInherit,ObjectInherit',
                        'None',
                        'Allow'
                    )
                    $acl.AddAccessRule($systemRule)
                    $acl.AddAccessRule($adminRule)
                    Set-Acl -Path $d -AclObject $acl
                }} catch {{}}
            }}
        }}

        $BinaryPath = Join-Path $InstallRoot $BinaryName
        Copy-Item -Path (Join-Path $SourceDir $BinaryName) -Destination $BinaryPath -Force
        $directMsh = Join-Path $SourceDir 'meshagent.msh'
        $proxyMsh = Join-Path $SourceDir 'meshagent_proxy.msh'
        if ($UseProxy.IsPresent -and (Test-Path $proxyMsh)) {{
            Copy-Item -Path $proxyMsh -Destination (Join-Path $InstallRoot 'meshagent.msh') -Force
        }} elseif (Test-Path $directMsh) {{
            Copy-Item -Path $directMsh -Destination (Join-Path $InstallRoot 'meshagent.msh') -Force
        }}

        Write-Host "[install] Registering Windows service"
        try {{ sc.exe stop "{service_name}" | Out-Null }} catch {{}}
        try {{ sc.exe delete "{service_name}" | Out-Null }} catch {{}}
        sc.exe create "{service_name}" binPath= ('"' + $BinaryPath + '" --service') DisplayName= "{display_name}" start= auto | Out-Null
        sc.exe description "{service_name}" "{description}" | Out-Null
        sc.exe start "{service_name}" | Out-Null

        # Optional artifacts: create database, config and log files
        if ('{db_name}' -ne '') {{
            $dbPath = Join-Path $InstallRoot '{db_name}'
            if (-not (Test-Path $dbPath)) {{ New-Item -Path $dbPath -ItemType File -Force | Out-Null }}
        }}
        if ('{cfg_name}' -ne '') {{
            $cfgPath = Join-Path $InstallRoot '{cfg_name}'
            if (-not (Test-Path $cfgPath)) {{ New-Item -Path $cfgPath -ItemType File -Force | Out-Null }}
        }}
        if ('{log_file_name}' -ne '') {{
            $lfPath = Join-Path $LogPath '{log_file_name}'
            if (-not (Test-Path $lfPath)) {{ New-Item -Path $lfPath -ItemType File -Force | Out-Null }}
            try {{
                icacls $lfPath /grant 'NT AUTHORITY\SYSTEM:(F)' /C | Out-Null
                icacls $lfPath /grant 'BUILTIN\Administrators:(F)' /C | Out-Null
            }} catch {{ }}
        }}

        # Registry: Service Parameters
        $svcKey = "HKLM:SYSTEM\\CurrentControlSet\\Services\\{service_name}"
        $paramsKey = Join-Path $svcKey 'Parameters'
        New-Item -Path $paramsKey -Force | Out-Null
        New-ItemProperty -Path $paramsKey -Name InstallRoot -Value $InstallRoot -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $paramsKey -Name BinaryName -Value "{binary_name}" -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $paramsKey -Name LogPath -Value $LogPath -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $paramsKey -Name CompanyName -Value "{company}" -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $paramsKey -Name ProductName -Value "{product}" -PropertyType String -Force | Out-Null
        if ('{product_version}' -ne '') {{ New-ItemProperty -Path $paramsKey -Name ProductVersion -Value "{product_version}" -PropertyType String -Force | Out-Null }}

        # Registry: Application key
        $appKey = "HKLM:Software\\{company}\\{product}"
        New-Item -Path $appKey -Force | Out-Null
        New-ItemProperty -Path $appKey -Name InstallRoot -Value $InstallRoot -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $appKey -Name BinaryName -Value "{binary_name}" -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $appKey -Name ServiceName -Value "{service_name}" -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $appKey -Name DisplayName -Value "{display_name}" -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $appKey -Name LogPath -Value $LogPath -PropertyType String -Force | Out-Null
        if ('{product_version}' -ne '') {{ New-ItemProperty -Path $appKey -Name ProductVersion -Value "{product_version}" -PropertyType String -Force | Out-Null }}
        New-ItemProperty -Path $appKey -Name InstallDate -Value (Get-Date).ToString('s') -PropertyType String -Force | Out-Null
        if ('{db_name}' -ne '') {{ New-ItemProperty -Path $appKey -Name DatabasePath -Value (Join-Path $InstallRoot '{db_name}') -PropertyType String -Force | Out-Null }}
        if ('{cfg_name}' -ne '') {{ New-ItemProperty -Path $appKey -Name ConfigPath -Value (Join-Path $InstallRoot '{cfg_name}') -PropertyType String -Force | Out-Null }}
        if ('{log_file_name}' -ne '') {{ New-ItemProperty -Path $appKey -Name LogFilePath -Value (Join-Path $LogPath '{log_file_name}') -PropertyType String -Force | Out-Null }}

        Write-Host "[install] Completed"
    """)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Generate install.ps1 from config")
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", default="build/meshagent/generated/install.ps1")
    ap.add_argument("--source-bundle", help="Optional staged bundle dir to embed copy commands for", required=False)
    args = ap.parse_args(argv)

    cfg = load_config(pathlib.Path(args.config))
    ps = generate_install_ps1(cfg)
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(ps, encoding="utf-8")
    print(f"[install-gen] wrote {out}")


if __name__ == "__main__":
    main()
