param(
    [switch]$InstallDependencies
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if ($InstallDependencies) {
    npm ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

node scripts/validate-windows-package.mjs --preflight
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx tauri build --bundles nsis
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node scripts/validate-windows-package.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$installers = Get-ChildItem "src-tauri/target/release/bundle/nsis/*.exe" -ErrorAction Stop
$installers | ForEach-Object {
    Write-Host ("Windows installer: {0} ({1:N1} MiB)" -f $_.FullName, ($_.Length / 1MB))
}
