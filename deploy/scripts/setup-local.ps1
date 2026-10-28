Param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Push-Location (Join-Path $PSScriptRoot '..')
try {
  # The installed server reads meshcentral-web/public in place. A copy in the data folder is
  # left over from the old layout and would shadow it.
  if (Test-Path -LiteralPath 'meshcentral-data/public') {
    throw 'meshcentral-data/public is a stale copy of the web overrides. Delete it, and remove WebPublicPath from meshcentral-data/config.json if it is set, then re-run.'
  }

  if (-not (Test-Path 'meshcentral-data/config.json')) {
    New-Item -ItemType Directory -Force -Path 'meshcentral-data' | Out-Null
    Copy-Item 'meshcentral-data/config.json.template' 'meshcentral-data/config.json' -Force
    Write-Host 'Created meshcentral-data/config.json from template.'
  }

  # pluginHandler.js loads plugins only from <datapath>/plugins until the Stage 4 built-in loader.
  Write-Host 'Staging local plugins...'
  New-Item -ItemType Directory -Force -Path 'meshcentral-data/plugins' | Out-Null
  foreach ($plugin in @('nativeruntime')) {
    $source = Join-Path '../plugins' $plugin
    $destination = Join-Path 'meshcentral-data/plugins' $plugin
    if (Test-Path -LiteralPath $destination) {
      Remove-Item -LiteralPath $destination -Recurse -Force
    }
    Copy-Item -LiteralPath $source -Destination $destination -Recurse
  }

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
