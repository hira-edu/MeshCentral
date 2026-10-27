Param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Push-Location (Join-Path $PSScriptRoot '..')
try {
  if (-not (Test-Path 'meshcentral-data/config.json')) {
    New-Item -ItemType Directory -Force -Path 'meshcentral-data' | Out-Null
    Copy-Item 'meshcentral-data/config.json.template' 'meshcentral-data/config.json' -Force
    Write-Host 'Created meshcentral-data/config.json from template.'
  }

  Write-Host 'Staging local plugins...'
  foreach ($plugin in @('nativeruntime')) {
    $source = Join-Path '../plugins' $plugin
    $destination = Join-Path 'meshcentral-data/plugins' $plugin
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item (Join-Path $source '*') $destination -Recurse -Force
  }

  Write-Host 'Staging web overrides...'
  New-Item -ItemType Directory -Force -Path 'meshcentral-data/public' | Out-Null
  Copy-Item (Join-Path 'meshcentral-web/public' '*') 'meshcentral-data/public' -Recurse -Force

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw 'Node.js 20+ is required. Please install Node.js and re-run.'
  }
  $nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
  if ($nodeMajor -lt 20) {
    throw 'Node.js 20+ is required. Please install Node.js and re-run.'
  }

  Write-Host 'Packing the fork package...'
  node scripts/pack.js
  if ($LASTEXITCODE -ne 0) { throw 'Packing the fork package failed.' }

  Write-Host 'Installing dependencies...'
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }

  Write-Host 'Starting MeshCentral...'
  npm start
}
finally {
  Pop-Location
}
