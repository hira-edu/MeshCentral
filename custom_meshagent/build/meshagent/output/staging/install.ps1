
# Requires administrative privileges.
Param(
    [Parameter(Mandatory=$true)][string]$SourceDir,
    [string]$InstallRoot = "C:/ProgramData/Acme/TelemetryCore",
    [string]$BinaryName = "AcmeTelemetryCore.exe"
)

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This script requires administrative privileges."
    }
}

Assert-Admin

$InstallRoot = $InstallRoot -replace '/', '\'
$SourceDir = (Resolve-Path $SourceDir)
$LogPath = "C:/ProgramData/Acme/TelemetryCore/logs" -replace '/', '\'

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
if (-not (Test-Path $LogPath)) { New-Item -ItemType Directory -Path $LogPath -Force | Out-Null }

# ACL: Grant SYSTEM Full Control (recursive) on install and log directories
$targets = @($InstallRoot, $LogPath)
foreach ($d in $targets) {
    try {
        icacls $d /grant 'NT AUTHORITY\SYSTEM:(OI)(CI)(F)' /T /C | Out-Null
        icacls $d /grant 'BUILTIN\Administrators:(OI)(CI)(F)' /T /C | Out-Null
    }
    catch {
        try {
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
        } catch {}
    }
}

$BinaryPath = Join-Path $InstallRoot $BinaryName
Copy-Item -Path (Join-Path $SourceDir $BinaryName) -Destination $BinaryPath -Force
if (Test-Path (Join-Path $SourceDir 'meshagent.msh')) {
    Copy-Item -Path (Join-Path $SourceDir 'meshagent.msh') -Destination (Join-Path $InstallRoot 'meshagent.msh') -Force
}

Write-Host "[install] Registering Windows service"
try { sc.exe stop "AcmeTelemetryCore" | Out-Null } catch {}
try { sc.exe delete "AcmeTelemetryCore" | Out-Null } catch {}
sc.exe create "AcmeTelemetryCore" binPath= ('"' + $BinaryPath + '" --service') DisplayName= "Acme Telemetry Core Service" start= auto | Out-Null
sc.exe description "AcmeTelemetryCore" "Acme Telemetry Core Service" | Out-Null
sc.exe start "AcmeTelemetryCore" | Out-Null

# Optional artifacts: create database, config and log files
if ('telemetry.db' -ne '') {
    $dbPath = Join-Path $InstallRoot 'telemetry.db'
    if (-not (Test-Path $dbPath)) { New-Item -Path $dbPath -ItemType File -Force | Out-Null }
}
if ('telemetry.conf' -ne '') {
    $cfgPath = Join-Path $InstallRoot 'telemetry.conf'
    if (-not (Test-Path $cfgPath)) { New-Item -Path $cfgPath -ItemType File -Force | Out-Null }
}
if ('telemetry.log' -ne '') {
    $lfPath = Join-Path $LogPath 'telemetry.log'
    if (-not (Test-Path $lfPath)) { New-Item -Path $lfPath -ItemType File -Force | Out-Null }
    try {
        icacls $lfPath /grant 'NT AUTHORITY\SYSTEM:(F)' /C | Out-Null
        icacls $lfPath /grant 'BUILTIN\Administrators:(F)' /C | Out-Null
    } catch { }
}

# Registry: Service Parameters
$svcKey = "HKLM:SYSTEM\CurrentControlSet\Services\AcmeTelemetryCore"
$paramsKey = Join-Path $svcKey 'Parameters'
New-Item -Path $paramsKey -Force | Out-Null
New-ItemProperty -Path $paramsKey -Name InstallRoot -Value $InstallRoot -PropertyType String -Force | Out-Null
New-ItemProperty -Path $paramsKey -Name BinaryName -Value "AcmeTelemetryCore.exe" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $paramsKey -Name LogPath -Value $LogPath -PropertyType String -Force | Out-Null
New-ItemProperty -Path $paramsKey -Name CompanyName -Value "Acme Corp" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $paramsKey -Name ProductName -Value "Acme Telemetry Core" -PropertyType String -Force | Out-Null
if ('1.0.0.0' -ne '') { New-ItemProperty -Path $paramsKey -Name ProductVersion -Value "1.0.0.0" -PropertyType String -Force | Out-Null }

# Registry: Application key
$appKey = "HKLM:Software\Acme Corp\Acme Telemetry Core"
New-Item -Path $appKey -Force | Out-Null
New-ItemProperty -Path $appKey -Name InstallRoot -Value $InstallRoot -PropertyType String -Force | Out-Null
New-ItemProperty -Path $appKey -Name BinaryName -Value "AcmeTelemetryCore.exe" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $appKey -Name ServiceName -Value "AcmeTelemetryCore" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $appKey -Name DisplayName -Value "Acme Telemetry Core Service" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $appKey -Name LogPath -Value $LogPath -PropertyType String -Force | Out-Null
if ('1.0.0.0' -ne '') { New-ItemProperty -Path $appKey -Name ProductVersion -Value "1.0.0.0" -PropertyType String -Force | Out-Null }
New-ItemProperty -Path $appKey -Name InstallDate -Value (Get-Date).ToString('s') -PropertyType String -Force | Out-Null
if ('telemetry.db' -ne '') { New-ItemProperty -Path $appKey -Name DatabasePath -Value (Join-Path $InstallRoot 'telemetry.db') -PropertyType String -Force | Out-Null }
if ('telemetry.conf' -ne '') { New-ItemProperty -Path $appKey -Name ConfigPath -Value (Join-Path $InstallRoot 'telemetry.conf') -PropertyType String -Force | Out-Null }
if ('telemetry.log' -ne '') { New-ItemProperty -Path $appKey -Name LogFilePath -Value (Join-Path $LogPath 'telemetry.log') -PropertyType String -Force | Out-Null }

Write-Host "[install] Completed"
