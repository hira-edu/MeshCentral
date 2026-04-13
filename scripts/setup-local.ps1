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

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw 'Node.js 18+ is required. Please install Node.js and re-run.'
  }

  Write-Host 'Installing dependencies...'
  if (Test-Path 'package-lock.json') {
    npm ci
  } else {
    npm install
  }

  Write-Host 'Starting MeshCentral...'
  npm start
}
finally {
  Pop-Location
}

