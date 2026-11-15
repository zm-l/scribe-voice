[CmdletBinding()]
param([ValidateSet('Dev','Build','Exe','Test')][string]$Mode='Dev')
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
Set-Location $project
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js LTS is required. Install Node and open a new terminal.' }
$npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw 'npm.cmd was not found. Install Node.js LTS.' }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $tools=Join-Path $project '..\..\.work\voice-input-stack\tools'
    $cargo=Join-Path $tools 'cargo'
    $rustup=Join-Path $tools 'rustup'
    if (-not (Test-Path (Join-Path $cargo 'bin\cargo.exe'))) { throw 'Rust is not installed. Install current stable MSVC Rust from https://rustup.rs/, then open a new terminal.' }
    $env:CARGO_HOME=[IO.Path]::GetFullPath($cargo)
    $env:RUSTUP_HOME=[IO.Path]::GetFullPath($rustup)
    $env:PATH="$env:CARGO_HOME\bin;$env:PATH"
    # The validation cache uses a temporary loopback transport configuration.
    # All required crates are cached; offline prevents depending on that build-only service.
    $env:CARGO_NET_OFFLINE='true'
    $env:CARGO_TARGET_DIR=[IO.Path]::GetFullPath((Join-Path $tools '..\native-target'))
    Write-Host 'Using the workspace-local cached Rust toolchain (offline).'
}
Write-Host "Scribe Voice project: $project"
# Windows PowerShell wraps native stderr as error records, even for successful
# Cargo/Tauri informational messages. Use exit codes for native commands below.
$ErrorActionPreference='Continue'
& node --version
& cargo --version
if (-not (Test-Path (Join-Path $project 'node_modules'))) {
    & $npm.Source ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
switch ($Mode) {
    'Dev' { & $npm.Source run desktop:dev }
    'Build' { & $npm.Source run desktop:build }
    'Exe' { & $npm.Source run desktop:build:exe }
    'Test' {
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
        & $npm.Source test
        if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
        & cargo test --manifest-path src-tauri/Cargo.toml --features custom-protocol
    }
}
if ($LASTEXITCODE -ne 0) { throw "Scribe Voice $Mode command failed with exit code $LASTEXITCODE." }
