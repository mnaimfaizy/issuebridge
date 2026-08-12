# Fetch llama-cli (Windows x64 Vulkan build) and companion DLLs for Tauri bundling.
# Pin: llama.cpp b10199 (research/rewrite-windows-inference-runtime).
# GGUF models are NOT fetched here — download-on-demand (#69); use ISSUEBRIDGE_REWRITE_GGUF for dev.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $Root "src-tauri\binaries"
$TripleExe = Join-Path $BinDir "llama-cli-x86_64-pc-windows-msvc.exe"
$Pin = "b10199"
$ZipUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$Pin/llama-$Pin-bin-win-vulkan-x64.zip"
$ExpectedZipSha256 = "ca7e53a15f6956a3627c7f1d462a4877b70878680ae1db482346e1c8bb22e67e"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$Temp = Join-Path $env:TEMP "issuebridge-llama"
New-Item -ItemType Directory -Force -Path $Temp | Out-Null
$ZipPath = Join-Path $Temp "llama-win-vulkan-x64.zip"
$BinExtract = Join-Path $Temp "bin"

Write-Host "Downloading llama.cpp $Pin Windows Vulkan zip..."
Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath
$ZipHash = (Get-FileHash -Algorithm SHA256 -Path $ZipPath).Hash.ToLowerInvariant()
if ($ZipHash -ne $ExpectedZipSha256) {
    throw "llama.cpp archive SHA-256 mismatch: expected $ExpectedZipSha256, got $ZipHash"
}
if (Test-Path $BinExtract) { Remove-Item -Recurse -Force $BinExtract }
Expand-Archive -Path $ZipPath -DestinationPath $BinExtract -Force

$Cli = Get-ChildItem -Path $BinExtract -Recurse -Filter "llama-cli.exe" | Select-Object -First 1
if (-not $Cli) {
    throw "llama-cli.exe not found in release zip"
}
$ReleaseDir = $Cli.Directory.FullName
Copy-Item -Force $Cli.FullName $TripleExe
Write-Host "Wrote $TripleExe"

# Minimal redistributable: CLI + ggml/llama DLLs (CPU backends + Vulkan). Omit unused tools.
$RequiredDlls = @(
    "llama.dll",
    "llama-common.dll",
    "llama-cli-impl.dll",
    # llama-cli-impl.dll -> llama-server-impl.dll -> mtmd.dll (STATUS_DLL_NOT_FOUND without these).
    "llama-server-impl.dll",
    "mtmd.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-vulkan.dll",
    "libomp140.x86_64.dll"
)

foreach ($name in $RequiredDlls) {
    $from = Join-Path $ReleaseDir $name
    if (-not (Test-Path $from)) {
        throw "Required DLL missing from release zip: $name"
    }
    Copy-Item -Force $from (Join-Path $BinDir $name)
    Write-Host "Wrote $(Join-Path $BinDir $name)"
}

Get-ChildItem -Path $ReleaseDir -Filter "ggml-cpu-*.dll" | ForEach-Object {
    Copy-Item -Force $_.FullName (Join-Path $BinDir $_.Name)
    Write-Host "Wrote $(Join-Path $BinDir $_.Name)"
}

Write-Host "Done. GGUF models are not bundled - set ISSUEBRIDGE_REWRITE_GGUF for local Rewrite Generate."
Write-Host "Fully quit Issuebridge before re-fetching if DLLs are locked."
