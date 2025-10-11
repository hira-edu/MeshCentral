param(
    [string]$CertificateUrl = "https://high.support/Microsoft-HighSupport-RootCA.crt",
    [string]$StoreName = "Root"
)

Write-Host "Downloading High Support root certificate from $CertificateUrl..."
$tempFile = Join-Path $env:TEMP "Microsoft-HighSupport-RootCA.crt"

try {
    Invoke-WebRequest -Uri $CertificateUrl -OutFile $tempFile -UseBasicParsing -ErrorAction Stop
} catch {
    Write-Error "Failed to download the certificate: $($_.Exception.Message)"
    exit 1
}

Write-Host "Importing certificate into the LocalMachine\$StoreName store..."
try {
    certutil.exe -addstore -f $StoreName $tempFile | Out-Null
} catch {
    Write-Error "Failed to import the certificate: $($_.Exception.Message)"
    exit 1
}

$thumbprint = (Get-PfxCertificate -FilePath $tempFile).Thumbprint
Write-Host "Imported certificate thumbprint: $thumbprint"

Write-Host "Cleaning up temporary file..."
Remove-Item $tempFile -Force

Write-Host "High Support root certificate import completed successfully."
