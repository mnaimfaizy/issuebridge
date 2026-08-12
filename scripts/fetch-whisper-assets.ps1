# Fetch whisper-cli (Windows x64), its DLLs, and ggml-base.bin for Tauri bundling.
# Pin: whisper.cpp v1.9.1; model SHA from upstream models table.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $Root "src-tauri\binaries"
$ModelDir = Join-Path $Root "src-tauri\resources\models"
$TripleExe = Join-Path $BinDir "whisper-cli-x86_64-pc-windows-msvc.exe"
$ModelPath = Join-Path $ModelDir "ggml-base.bin"
$ExpectedZipSha256 = "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539"
$ExpectedSha = "465707469ff3a37a2b9b8d8f89f2f99de7299dac"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

$ZipUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip"
$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"

$Temp = Join-Path $env:TEMP "issuebridge-whisper"
New-Item -ItemType Directory -Force -Path $Temp | Out-Null
$ZipPath = Join-Path $Temp "whisper-bin-x64.zip"
$BinExtract = Join-Path $Temp "bin"

Write-Host "Downloading whisper-cli zip..."
Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath
$ZipHash = (Get-FileHash -Algorithm SHA256 -Path $ZipPath).Hash.ToLowerInvariant()
if ($ZipHash -ne $ExpectedZipSha256) {
    throw "Whisper archive SHA-256 mismatch: expected $ExpectedZipSha256, got $ZipHash"
}
if (Test-Path $BinExtract) { Remove-Item -Recurse -Force $BinExtract }
Expand-Archive -Path $ZipPath -DestinationPath $BinExtract -Force

$Cli = Get-ChildItem -Path $BinExtract -Recurse -Filter "whisper-cli.exe" | Select-Object -First 1
if (-not $Cli) {
    throw "whisper-cli.exe not found in release zip"
}
$ReleaseDir = $Cli.Directory.FullName
Copy-Item -Force $Cli.FullName $TripleExe
Write-Host "Wrote $TripleExe"

# Windows LoadLibrary requires these next to whisper-cli (or on PATH).
$DllNames = @(
    "ggml.dll",
    "ggml-base.dll",
    "whisper.dll"
) + @(Get-ChildItem -Path $ReleaseDir -Filter "ggml-cpu-*.dll" | ForEach-Object { $_.Name })

foreach ($name in $DllNames) {
    $from = Join-Path $ReleaseDir $name
    if (-not (Test-Path $from)) {
        throw "Required DLL missing from release zip: $name"
    }
    Copy-Item -Force $from (Join-Path $BinDir $name)
    Write-Host "Wrote $(Join-Path $BinDir $name)"
}

Write-Host "Downloading ggml-base.bin (large)..."
$ModelTemp = Join-Path $Temp "ggml-base.bin"
Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelTemp
$Hash = (Get-FileHash -Algorithm SHA1 -Path $ModelTemp).Hash.ToLowerInvariant()
if ($Hash -ne $ExpectedSha) {
    throw "Model SHA mismatch: expected $ExpectedSha, got $Hash"
}
# Copy (not move) so a locked install-dir model can be replaced after the app quits.
Copy-Item -Force $ModelTemp $ModelPath
Write-Host "Verified model SHA $Hash -> $ModelPath"
Write-Host "Done."
