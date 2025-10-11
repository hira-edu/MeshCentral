param(
    [string]$LegacySubject = "MeshCentralRoot-Auto"
)

Write-Host "Searching LocalMachine\\Root store for certificates with subject '$LegacySubject'..."
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root","LocalMachine")
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)

$matches = $store.Certificates | Where-Object { $_.Subject -like "*CN=$LegacySubject*" }

if (-not $matches) {
    Write-Host "No certificates matching '$LegacySubject' were found."
    $store.Close()
    return
}

foreach ($cert in $matches) {
    Write-Host "Removing certificate with thumbprint $($cert.Thumbprint)..."
    $store.Remove($cert)
}

$store.Close()
Write-Host "Legacy MeshCentral root certificates removed."
