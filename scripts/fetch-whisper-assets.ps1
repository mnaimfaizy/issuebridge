# Fetch whisper-cli (Windows x64) and ggml-base.bin for Tauri bundling.
# Pin: whisper.cpp v1.9.1; model SHA from upstream models table.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $Root "src-tauri\binaries"
$ModelDir = Join-Path $Root "src-tauri\resources\models"
$TripleExe = Join-Path $BinDir "whisper-cli-x86_64-pc-windows-msvc.exe"
$ModelPath = Join-Path $ModelDir "ggml-base.bin"
$ExpectedSha = "465707469ff3a37a2b9b8d8f89f2f99de7299dac"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

$ZipUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip"
$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"

$Temp = Join-Path $env:TEMP "issuebridge-whisper"
New-Item -ItemType Directory -Force -Path $Temp | Out-Null
$ZipPath = Join-Path $Temp "whisper-bin-x64.zip"

Write-Host "Downloading whisper-cli zip..."
Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath
Expand-Archive -Path $ZipPath -DestinationPath (Join-Path $Temp "bin") -Force

$Cli = Get-ChildItem -Path (Join-Path $Temp "bin") -Recurse -Filter "whisper-cli.exe" | Select-Object -First 1
if (-not $Cli) {
    throw "whisper-cli.exe not found in release zip"
}
Copy-Item -Force $Cli.FullName $TripleExe
Write-Host "Wrote $TripleExe"

Write-Host "Downloading ggml-base.bin (large)..."
Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelPath

$Hash = (Get-FileHash -Algorithm SHA1 -Path $ModelPath).Hash.ToLowerInvariant()
if ($Hash -ne $ExpectedSha) {
    throw "Model SHA mismatch: expected $ExpectedSha, got $Hash"
}
Write-Host "Verified model SHA $Hash"
Write-Host "Done."
