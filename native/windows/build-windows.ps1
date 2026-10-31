[CmdletBinding()]
param(
    [ValidateSet('x64', 'arm64')]
    [string]$Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Project = Join-Path $PSScriptRoot 'PinDownloaderClipboard.csproj'
$OutputDir = Join-Path $Root "dist\windows-$Architecture"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw 'dotnet was not found. Install the .NET 8 SDK.'
}
if (-not (Test-Path $Project)) {
    throw "Missing project: $Project"
}

if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

dotnet publish $Project `
    --configuration Release `
    --runtime "win-$Architecture" `
    --self-contained true `
    --output $OutputDir `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=None `
    -p:DebugSymbols=false

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

Get-ChildItem -Path $OutputDir -Filter *.pdb | Remove-Item -Force
$ExePath = Join-Path $OutputDir 'PinDownloaderClipboard.exe'
if (-not (Test-Path $ExePath)) {
    throw "Published executable was not created: $ExePath"
}

Write-Host "Built $ExePath"
