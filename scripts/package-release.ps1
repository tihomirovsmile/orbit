$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
Set-Location -LiteralPath $projectRoot
$releaseDir = Join-Path $projectRoot 'releases'
$sourceDir = Join-Path $releaseDir 'github/Orbit'
$installer = Join-Path $releaseDir 'Orbit-Setup-3.0.0.exe'
if (-not (Test-Path -LiteralPath $installer)) { throw 'Build the installer first: scripts/build-desktop.ps1' }
if (Test-Path -LiteralPath $sourceDir) {
    $resolved = [IO.Path]::GetFullPath($sourceDir)
    if (-not $resolved.StartsWith($releaseDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
$folders = @('apps','packages','scripts','tests','licenses')
$rootFiles = @('package.json','package-lock.json','tsconfig.json','tsconfig.server.json','README.md','ABOUT.md','BUILDING.md','SUPPORT.md','SECURITY.md','LICENSE','.env.example','.gitignore','.gitattributes','THIRD_PARTY_NOTICES.md','Start-Web.cmd','Start-Local.cmd','Start-App.cmd','start-web.sh','start-local.sh','start-app.sh','start.ps1','start.sh')
foreach ($folder in $folders) { Copy-Item -LiteralPath (Join-Path $projectRoot $folder) -Destination (Join-Path $sourceDir $folder) -Recurse -Force }
foreach ($file in $rootFiles) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $sourceDir $file) -Force }
New-Item -ItemType Directory -Path (Join-Path $sourceDir 'desktop') -Force | Out-Null
foreach ($entry in @('src','.cargo','Cargo.toml','Cargo.lock','installer.iss')) { Copy-Item -LiteralPath (Join-Path $projectRoot "desktop/$entry") -Destination (Join-Path $sourceDir "desktop/$entry") -Recurse -Force }
$entries = @(Get-ChildItem -LiteralPath $sourceDir -Recurse -File -Force | ForEach-Object {
    $relative = $_.FullName.Substring($sourceDir.Length + 1).Replace('\','/')
    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Links are not allowed: $relative" }
    if ($relative -match '(^|/)(storage|design-tz|docs|node_modules|\.private|\.build-tools|target|test-results[^/]*|\.env|\.encryption-key|\.orbit-runtime\.json)(/|$)' -or $relative -match '\.(sqlite|db|log|pem|key)$') { throw "Private file blocked: $relative" }
    [pscustomobject]@{path=$relative;fullPath=$_.FullName;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = Join-Path $releaseDir 'Orbit-3.0.0-final.zip'
$stream = [IO.File]::Open($archive,[IO.FileMode]::Create)
$zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($entry in $entries) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$entry.fullPath,('source/' + $entry.path),[IO.Compression.CompressionLevel]::Optimal) | Out-Null }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$installer,'Orbit-Setup-3.0.0.exe',[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    $manifest = [ordered]@{name='Orbit';version='3.0.0';status='final';license='MIT';files=@($entries | Select-Object path,bytes,sha256);installerSha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json -Depth 5
    $writer = [IO.StreamWriter]::new($zip.CreateEntry('MANIFEST.json').Open(),[Text.UTF8Encoding]::new($false))
    try { $writer.Write($manifest) } finally { $writer.Dispose() }
} finally { $zip.Dispose();$stream.Dispose() }
foreach ($artifact in @($archive,$installer)) {
    $hash=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath ($artifact+'.sha256') -Value "$hash  $([IO.Path]::GetFileName($artifact))" -Encoding ascii
}
Write-Output "GitHub source: $sourceDir"
Write-Output "Archive with source and installer: $archive"
