#Requires -Version 5.1
<#
.SYNOPSIS
    Performs a quick health check of the MeshCentral signing pipeline.

.DESCRIPTION
    Validates that agent signing is enabled (`agentSignLock`), that a signing certificate
    exists (agentsigningcert.pem or codesign cert pair), and that both `meshcentral-data/agents`
    and `meshcentral-data/signedagents` contain the expected binaries. Emits a summary object
    so CI or operators can gate redeployments before restarting MeshCentral.

.PARAMETER MeshCentralRoot
    Path to the MeshCentral repository root. Defaults to the parent folder of this script.

.EXAMPLE
    pwsh ./tools/Check-AgentSigning.ps1

.EXAMPLE
    pwsh ./tools/Check-AgentSigning.ps1 -MeshCentralRoot 'D:\Repos\MeshCentral'
#>
[CmdletBinding()]
param(
    [string]$MeshCentralRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $MeshCentralRoot) {
    $MeshCentralRoot = Split-Path $MyInvocation.MyCommand.Definition -Parent
}

function Resolve-ExistingPath {
    param([string]$Path)
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    return $resolved.ProviderPath
}

$root = Resolve-ExistingPath $MeshCentralRoot
$dataDir = Join-Path $root 'meshcentral-data'
$agentsDir = Join-Path $dataDir 'agents'
$signedDir = Join-Path $dataDir 'signedagents'
$configPath = Join-Path $root 'deployment-configs\meshcentral-config.json'
$certPem = Join-Path $dataDir 'agentsigningcert.pem'
$codePub = Join-Path $dataDir 'codesign-cert-public.crt'
$codeKey = Join-Path $dataDir 'codesign-cert-private.key'

$result = [ordered]@{
    meshCentralRoot = $root
    agentSignLock   = $false
    signingCert     = $false
    agentsPresent   = @()
    signedPresent   = @()
    warnings        = New-Object System.Collections.Generic.List[string]
}

if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json -Depth 4
        if ($config.settings.agentSignLock -eq $true) {
            $result.agentSignLock = $true
        } else {
            $result.warnings.Add("settings.agentSignLock is disabled in deployment-configs/meshcentral-config.json")
        }
    } catch {
        $result.warnings.Add("Unable to parse $configPath: $($_.Exception.Message)")
    }
} else {
    $result.warnings.Add("Configuration file not found at deployment-configs/meshcentral-config.json")
}

if (Test-Path -LiteralPath $certPem) {
    $result.signingCert = $true
} elseif ((Test-Path -LiteralPath $codePub) -and (Test-Path -LiteralPath $codeKey)) {
    $result.signingCert = $true
} else {
    $result.warnings.Add("No agent signing certificate detected (agentsigningcert.pem or codesign cert/key).")
}

function Get-AgentFiles {
    param([string]$Dir)
    if (-not (Test-Path -LiteralPath $Dir)) { return @() }
    return Get-ChildItem -LiteralPath $Dir -File -Filter 'MeshService*.exe' |
        Select-Object -ExpandProperty Name
}

$result.agentsPresent = Get-AgentFiles -Dir $agentsDir
if ($result.agentsPresent.Count -eq 0) {
    $result.warnings.Add("meshcentral-data/agents is missing MeshService binaries.")
}

$result.signedPresent = Get-AgentFiles -Dir $signedDir
if ($result.signedPresent.Count -eq 0) {
    $result.warnings.Add("meshcentral-data/signedagents has no MeshService binaries. Restart MeshCentral to re-sign.")
}

$resultObject = [pscustomobject]$result
$resultObject | ConvertTo-Json -Depth 4

if ($result.warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "Warnings:" -ForegroundColor Yellow
    foreach ($warn in $result.warnings) {
        Write-Host " - $warn" -ForegroundColor Yellow
    }
    exit 1
} else {
    Write-Host ""
    Write-Host "[OK] MeshCentral signing prerequisites satisfied." -ForegroundColor Green
}
