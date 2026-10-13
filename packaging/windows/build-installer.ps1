<#
.SYNOPSIS
  Builds, packages, and signs the native Windows distribution of Forge.
.DESCRIPTION
  Compiles the TypeScript monorepo into native standalone bundles, verifies ConPTY
  support, and signs the resulting executables with Authenticode.
#>

[CmdletBinding()]
param(
  [string]$CertificateThumbprint = $env:SIGNING_CERT_THUMBPRINT,
  [string]$OutDir = "dist/windows"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Packaging Forge for Windows Native..." -ForegroundColor Cyan

# 1. Ensure build output directory
if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

# 2. Build monorepo packages
Write-Host "==> Building packages..." -ForegroundColor Cyan
pnpm build

# 3. Verify ConPTY API availability
$build = [System.Environment]::OSVersion.Version.Build
Write-Host "==> Windows OS Build detected: $build"
if ($build -ge 17763) {
  Write-Host "==> ConPTY pseudo-console supported." -ForegroundColor Green
} else {
  Write-Warning "Running on legacy Windows build (< 17763). ConPTY disabled; fallback console runner active."
}

# 4. Sign binary if certificate thumbprint is available
if ($CertificateThumbprint) {
  Write-Host "==> Signing executable with Authenticode ($CertificateThumbprint)..." -ForegroundColor Cyan
  $cert = Get-Item "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
  if ($cert) {
    Set-AuthenticodeSignature -FilePath "$OutDir\forge.exe" -Certificate $cert -TimestampServer "http://timestamp.digicert.com"
    Write-Host "==> Binary successfully signed." -ForegroundColor Green
  } else {
    Write-Warning "Certificate with thumbprint $CertificateThumbprint not found. Skipping signing."
  }
} else {
  Write-Host "==> SIGNING_CERT_THUMBPRINT not specified. Skipping Authenticode signing in development." -ForegroundColor Yellow
}

Write-Host "==> Windows packaging complete: $OutDir" -ForegroundColor Green
