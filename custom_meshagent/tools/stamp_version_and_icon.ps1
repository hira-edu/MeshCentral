param(
  [Parameter(Mandatory=$true)][string]$ExePath,
  [string]$FileDescription,
  [string]$ProductName,
  [string]$CompanyName,
  [string]$ProductVersion,
  [string]$FileVersion,
  [string]$OriginalFilename,
  [string]$IconPath,
  [switch]$VerboseLogs
)

# Optional resource stamping for prebuilt EXEs using rcedit (https://github.com/electron/rcedit)
# and optional signtool if present. Best-effort: script will skip steps when tools are missing.

$ErrorActionPreference = 'Stop'
function Find-Tool($names){ foreach($n in $names){ $p = (Get-Command $n -ErrorAction SilentlyContinue).Path; if($p){ return $p } } return $null }

$rcedit = Find-Tool @('rcedit-x64.exe','rcedit.exe')
if(-not $rcedit){ Write-Warning 'rcedit not found in PATH; skipping resource stamping.'; exit 0 }

if($VerboseLogs){ Write-Host "[stamp] using rcedit: $rcedit" }

if($FileDescription){ & $rcedit $ExePath --set-file-version $FileVersion 2>$null; & $rcedit $ExePath --set-product-version $ProductVersion 2>$null; & $rcedit $ExePath --set-version-string "FileDescription" $FileDescription }
if($ProductName){ & $rcedit $ExePath --set-version-string "ProductName" $ProductName }
if($CompanyName){ & $rcedit $ExePath --set-version-string "CompanyName" $CompanyName }
if($OriginalFilename){ & $rcedit $ExePath --set-version-string "OriginalFilename" $OriginalFilename }
if($IconPath -and (Test-Path $IconPath)){ & $rcedit $ExePath --set-icon $IconPath }

Write-Host "[stamp] completed stamping for $ExePath"

