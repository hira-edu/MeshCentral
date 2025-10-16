Param(
  [Parameter(Mandatory=$true)][string]$SourceDir,
  [string]$GeneratedDir = "$(Split-Path $PSScriptRoot -Parent)\..\..\build\meshagent\generated"
)

$ErrorActionPreference = 'Stop'

# Delegate to the generated installer script if present
$installScript = Join-Path $GeneratedDir 'install.ps1'
if (-not (Test-Path $installScript)) {
  throw "Generated install script not found: $installScript. Run the generate step first."
}

Write-Host "Using generated installer: $installScript"
powershell -ExecutionPolicy Bypass -File $installScript -SourceDir (Resolve-Path $SourceDir)

