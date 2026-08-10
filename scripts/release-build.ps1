# Official v0.1 Windows NSIS release build.
# Bakes public client id + OAuth exchange URL at compile time (never the client secret).
#
# Required env:
#   ISSUEBRIDGE_GITHUB_CLIENT_ID
#   ISSUEBRIDGE_OAUTH_EXCHANGE_URL
#
# Optional:
#   -SkipWhisperFetch  skip scripts/fetch-whisper-assets.ps1 when assets already present
#   -SkipLlamaFetch    skip scripts/fetch-llama-assets.ps1 when assets already present

param(
    [switch]$SkipWhisperFetch,
    [switch]$SkipLlamaFetch
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Assert-LastExitCode {
    param([string]$Step)
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

Write-Host "Checking packaging contract and release credentials..."
node (Join-Path $PSScriptRoot "check-release.mjs")
Assert-LastExitCode "Release credential / packaging check"

if (-not $SkipWhisperFetch) {
    Write-Host "Fetching Whisper sidecar + base model..."
    & (Join-Path $PSScriptRoot "fetch-whisper-assets.ps1")
    Assert-LastExitCode "Whisper asset fetch"
}

if (-not $SkipLlamaFetch) {
    Write-Host "Fetching llama.cpp Rewrite sidecar (CPU/Vulkan DLLs; no GGUF)..."
    & (Join-Path $PSScriptRoot "fetch-llama-assets.ps1")
    Assert-LastExitCode "llama.cpp asset fetch"
}

Write-Host "Building NSIS per-user installer (*-setup.exe)..."
npm run tauri -- build
Assert-LastExitCode "tauri build"

$BundleDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"
if (Test-Path $BundleDir) {
    Get-ChildItem $BundleDir -Filter "*-setup.exe" | ForEach-Object {
        Write-Host "Installer: $($_.FullName)"
    }
} else {
    Write-Warning "NSIS bundle directory not found at $BundleDir - check tauri build output."
}
