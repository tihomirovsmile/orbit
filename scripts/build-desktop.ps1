param([string]$Compiler = '', [switch]$SkipChecks)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
Set-Location -LiteralPath $projectRoot
if ((node -p 'process.versions.node.split(".")[0]') -ne '24') { throw 'Node.js 24 x64 is required.' }
if ((node -p 'process.arch') -ne 'x64') { throw 'Use Node.js x64.' }
if (-not (Test-Path node_modules)) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
if ($SkipChecks) { npm run build } else { npm run check }
if ($LASTEXITCODE -ne 0) { throw 'Project checks failed' }
npm run build:server
if ($LASTEXITCODE -ne 0) { throw 'Server compilation failed' }
$cargo = 'cargo'
if (Test-Path '.build-tools/cargo/bin/cargo.exe') {
    $env:CARGO_HOME = Join-Path $projectRoot '.build-tools/cargo'
    $env:RUSTUP_HOME = Join-Path $projectRoot '.build-tools/rustup'
    $cargo = Join-Path $env:CARGO_HOME 'bin/cargo.exe'
}
Push-Location desktop
$previousFlags = $env:CARGO_ENCODED_RUSTFLAGS
$env:CARGO_ENCODED_RUSTFLAGS = @('-C','linker-flavor=ld.lld','-C','link-self-contained=yes','--remap-path-prefix',($projectRoot + '=Orbit')) -join [char]31
try {
    & $cargo +stable-x86_64-pc-windows-gnu build --release --target x86_64-pc-windows-gnu
    if ($LASTEXITCODE -ne 0) { throw 'Rust compilation failed' }
    & $cargo +stable-x86_64-pc-windows-gnu test --target x86_64-pc-windows-gnu
    if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
} finally { $env:CARGO_ENCODED_RUSTFLAGS = $previousFlags; Pop-Location }
$compiled = Join-Path $projectRoot 'desktop/target/x86_64-pc-windows-gnu/release/Orbit.exe'
New-Item -ItemType Directory -Force 'desktop/target/release' | Out-Null
Copy-Item -LiteralPath $compiled -Destination 'desktop/target/release/Orbit.exe' -Force
$stage = [IO.Path]::GetFullPath((Join-Path $projectRoot 'build/desktop'))
if (-not $stage.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path' }
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
node scripts/stage-desktop.mjs
if ($LASTEXITCODE -ne 0) { throw 'Staging failed' }
& (Join-Path $PSScriptRoot 'create-icon.ps1')
if (-not $Compiler) {
    foreach ($candidate in @((Join-Path $projectRoot '.build-tools/inno/ISCC.exe'), "$env:LOCALAPPDATA\Programs\Inno Setup 7\ISCC.exe", "${env:ProgramFiles}\Inno Setup 7\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 7\ISCC.exe")) {
        if (Test-Path -LiteralPath $candidate) { $Compiler = $candidate; break }
    }
}
if (-not $Compiler) { $Compiler = (Get-Command ISCC.exe -ErrorAction Stop).Source }
& $Compiler /Q 'desktop/installer.iss'
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
