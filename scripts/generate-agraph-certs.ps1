param(
  [string]$OutputDir = "certs",
  [int]$Days = 825
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root $OutputDir
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$caKey = Join-Path $certDir "agraph-ca.key"
$caCert = Join-Path $certDir "agraph-ca.crt"
$serverKey = Join-Path $certDir "agraph-server.key"
$serverCsr = Join-Path $certDir "agraph-server.csr"
$serverCert = Join-Path $certDir "agraph-server.crt"
$serverPem = Join-Path $certDir "agraph-server.pem"
$extFile = Join-Path $certDir "agraph-server.ext"

$existingFiles = @($caKey, $caCert, $serverKey, $serverCert, $serverPem) | Where-Object { Test-Path $_ }
if ($existingFiles.Count -gt 0) {
  throw "Refusing to overwrite existing cert files in $certDir. Remove them first if you want to regenerate."
}

@"
subjectAltName=DNS:allegrograph,DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
keyUsage=digitalSignature,keyEncipherment
"@ | Set-Content -Path $extFile -Encoding ascii

openssl genrsa -out $caKey 4096
openssl req -x509 -new -nodes -key $caKey -sha256 -days $Days -out $caCert -subj "/CN=Sitrep AllegroGraph Internal CA"

openssl genrsa -out $serverKey 2048
openssl req -new -key $serverKey -out $serverCsr -subj "/CN=allegrograph"
openssl x509 -req -in $serverCsr -CA $caCert -CAkey $caKey -CAcreateserial -out $serverCert -days $Days -sha256 -extfile $extFile

Get-Content -Path $serverCert, $serverKey | Set-Content -Path $serverPem -Encoding ascii

Remove-Item -Path $serverCsr, $extFile -Force

Write-Host "Created:"
Write-Host "  $caCert"
Write-Host "  $serverPem"
Write-Host ""
Write-Host "These files are ignored by git. Keep agraph-ca.key private; it signs new internal certs."
