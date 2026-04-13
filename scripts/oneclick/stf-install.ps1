Param(
  [string]$InstallDir = 'C:\ProgramData\SecurityTestingFramework'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Ensure TLS 1.2 for GitHub
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Owner = 'hira-edu'
$Repo  = 'security-testing-framework'
$Api   = "https://api.github.com/repos/$Owner/$Repo/releases/latest"

Write-Host "Fetching latest release metadata from $Owner/$Repo..."
$latest = Invoke-RestMethod -Method GET -Uri $Api -Headers @{ 'User-Agent' = 'stf-install' }
if (-not $latest) { throw 'Unable to get latest release metadata.' }

$asset = $latest.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
if (-not $asset) { throw 'No .zip asset found in latest release.' }
Write-Host ("Latest asset: {0}" -f $asset.name)

$tmp = Join-Path $env:TEMP ('stf-' + [guid]::NewGuid().ToString('N') + '.zip')
Write-Host ("Downloading to {0}" -f $tmp)
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -UseBasicParsing

Write-Host ("Creating install dir {0}" -f $InstallDir)
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host 'Extracting asset...'
Expand-Archive -Path $tmp -DestinationPath $InstallDir -Force
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue

# Try to run install scripts per STF repo conventions
$installPs1 = Join-Path $InstallDir 'install.ps1'
$installBat = Join-Path $InstallDir 'install.bat'
if (Test-Path -LiteralPath $installPs1) {
  Write-Host 'Running install.ps1'
  powershell -ExecutionPolicy Bypass -File $installPs1
} elseif (Test-Path -LiteralPath $installBat) {
  Write-Host 'Running install.bat'
  & $installBat
} else {
  Write-Warning 'No install.ps1 or install.bat found; extracted only.'
}

Write-Host 'Security Testing Framework installation finished.'

