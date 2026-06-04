param(
    [string]$OutputRoot = 'server-backups'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $repoRoot $OutputRoot
$backupDir = Join-Path $backupRoot ("meshcentral-local-{0}" -f $timestamp)
$repoOut = Join-Path $backupDir 'repo'
$runtimeOut = Join-Path $backupDir 'runtime'
$manifestOut = Join-Path $backupDir 'manifests'

New-Item -ItemType Directory -Force -Path $repoOut,$runtimeOut,$manifestOut | Out-Null

function Copy-IfExists {
    param(
        [string]$RelativePath,
        [string]$Bucket
    )
    $src = Join-Path $repoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $src)) { return }
    $dest = Join-Path $Bucket $RelativePath
    $parent = Split-Path -Parent $dest
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Copy-Item -LiteralPath $src -Destination $dest -Force -Recurse
}

function Read-JsonMap {
    param([string]$Path)
    Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -Depth 100
}

$repoFiles = @(
    '.gitignore',
    'package.json',
    'readme.md',
    'docker-compose.yml',
    'infra\caddy\README.md',
    'infra\caddy\Caddyfile.live',
    'infra\nginx\meshcentral.conf',
    'scripts\setup-local.ps1',
    'scripts\setup-local.sh',
    'scripts\remote\bootstrap.sh',
    'scripts\remote\diagnose.sh',
    'scripts\remote\sync-back.sh',
    'scripts\oneclick\stf-install.ps1',
    'scripts\oneclick\stf-install.sh',
    'scripts\ops\New-MeshCentralLocalBackup.ps1',
    'scripts\ops\Collect-MeshCentralRemoteSnapshot.sh',
    'public\scripts\custom.js',
    'plugins\stfdeploy\README.md',
    'plugins\stfdeploy\config.json',
    'plugins\stfdeploy\stfdeploy.js',
    'plugins\stfdeploy\views\admin.handlebars',
    'docs\operations\README.md',
    'docs\operations\Cloudflare-Change-Ledger.md',
    'docs\operations\Server-Operations-Plan.md',
    'docs\operations\Server-Setup-SSOT.md',
    'docs\operations\Backup-and-Restore-Runbook.md'
)

$runtimeFiles = @(
    'meshcentral-data\config.json',
    'meshcentral-data\config.json.template',
    'meshcentral-data\meshcore.js'
)

foreach ($f in $repoFiles) { Copy-IfExists -RelativePath $f -Bucket $repoOut }
foreach ($f in $runtimeFiles) { Copy-IfExists -RelativePath $f -Bucket $runtimeOut }

$configPath = Join-Path $repoRoot 'meshcentral-data\config.json'
if (Test-Path -LiteralPath $configPath) {
    $sanitized = Read-JsonMap -Path $configPath
    if ($sanitized.Contains('settings')) {
        $settings = $sanitized['settings']
        foreach ($key in 'dbEncryptKey','dbRecordsEncryptKey','sessionKey') {
            if ($settings.Contains($key)) { $settings[$key] = '<redacted>' }
        }
        if ($settings.Contains('mongodb') -and $settings['mongodb']) {
            $settings['mongodb'] = ($settings['mongodb'] -replace '://([^:]+):([^@]+)@', '://<redacted-user>:<redacted-password>@')
        }
    }
    $sanitized | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath (Join-Path $manifestOut 'config.sanitized.json') -Encoding utf8
}

$allFiles = Get-ChildItem -LiteralPath $backupDir -Recurse -File
$manifest = foreach ($file in $allFiles) {
    $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
    [pscustomobject]@{
        path = $file.FullName.Substring($backupDir.Length + 1)
        bytes = $file.Length
        sha256 = $hash.Hash.ToLowerInvariant()
        lastWriteTime = $file.LastWriteTime.ToString('o')
    }
}

$dbMode = 'unknown'
if (Test-Path -LiteralPath $configPath) {
    $cfg = Read-JsonMap -Path $configPath
    if ($cfg.Contains('settings') -and $cfg['settings'].Contains('mongodb') -and $cfg['settings']['mongodb']) {
        $dbMode = 'mongodb'
    } else {
        $dbMode = 'nedb-or-default'
    }
}

[pscustomobject]@{
    createdAt = (Get-Date).ToString('o')
    repoRoot = $repoRoot
    backupDir = $backupDir
    dbMode = $dbMode
    dbDumpStatus = 'not-captured-locally'
    notes = @(
        'Local backup captures tracked repo state plus local runtime carryovers when present.',
        'Tracked live edge reference is infra\\caddy\\Caddyfile.live when available.',
        'Raw server-backups and Cloudflare secret files are intentionally excluded from local backup capture.'
    )
    files = $manifest
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $manifestOut 'backup-manifest.json') -Encoding utf8

Write-Host $backupDir
