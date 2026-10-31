[CmdletBinding()]
param(
    [ValidateSet('chrome', 'edge', 'both')]
    [string]$Browser,

    [string]$ChromeExtensionId,
    [string]$EdgeExtensionId,
    [string]$ExtensionId,
    [string]$HelperPath,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$HostName = 'com.pindownloader.clipboard'
$InstallDir = Join-Path $env:LOCALAPPDATA 'PinDownloader\native'
$ManifestPath = Join-Path $InstallDir ($HostName + '.json')
$RegistryRoots = @{
    chrome = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts'
    edge = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'
}
$ExtensionPages = @{
    chrome = 'chrome://extensions'
    edge = 'edge://extensions'
}

function Select-Browser {
    Write-Host 'Where should the clipboard helper be registered?'
    Write-Host '  1) Chrome'
    Write-Host '  2) Edge'
    Write-Host '  3) Both'
    $choice = Read-Host 'Choice [1]'
    switch ($choice) {
        '' { return 'chrome' }
        '1' { return 'chrome' }
        '2' { return 'edge' }
        '3' { return 'both' }
        'chrome' { return 'chrome' }
        'edge' { return 'edge' }
        'both' { return 'both' }
        default { throw 'Invalid browser choice.' }
    }
}

function Normalize-ExtensionId {
    param(
        [string]$Value,
        [string]$Label
    )
    $normalized = $Value.Trim().ToLowerInvariant()
    if ($normalized -notmatch '^[a-p]{32}$') {
        throw "The $Label extension ID must contain 32 characters from a-p."
    }
    return $normalized
}

function Read-ExtensionId {
    param([string]$Label)
    $value = Read-Host "Paste the 32-character $Label extension ID"
    return Normalize-ExtensionId -Value $value -Label $Label
}

if (-not $Browser) {
    if ($Uninstall) {
        $Browser = 'both'
    } else {
        $Browser = Select-Browser
    }
}

$BrowserNames = if ($Browser -eq 'both') { @('chrome', 'edge') } else { @($Browser) }

if ($Uninstall) {
    foreach ($name in $BrowserNames) {
        $key = "$($RegistryRoots[$name])\$HostName"
        if (Test-Path $key) {
            Remove-Item $key -Recurse -Force
        }
        Write-Host "Removed $name native messaging registration."
    }

    $remaining = @()
    foreach ($name in @('chrome', 'edge')) {
        $key = "$($RegistryRoots[$name])\$HostName"
        if (Test-Path $key) {
            $remaining += $name
        }
    }
    if ($remaining.Count -eq 0 -and (Test-Path $InstallDir)) {
        Remove-Item $InstallDir -Recurse -Force
        Write-Host "Removed $InstallDir"
    }
    exit 0
}

if ($ExtensionId) {
    $ExtensionId = Normalize-ExtensionId -Value $ExtensionId -Label 'browser'
}

if (($BrowserNames -contains 'chrome') -and -not $ChromeExtensionId) {
    if ($ExtensionId) {
        $ChromeExtensionId = $ExtensionId
    } else {
        $ChromeExtensionId = Read-ExtensionId -Label 'Chrome'
    }
}
if (($BrowserNames -contains 'edge') -and -not $EdgeExtensionId) {
    if ($ExtensionId) {
        $EdgeExtensionId = $ExtensionId
    } else {
        $EdgeExtensionId = Read-ExtensionId -Label 'Edge'
    }
}

if ($ChromeExtensionId) {
    $ChromeExtensionId = Normalize-ExtensionId -Value $ChromeExtensionId -Label 'Chrome'
}
if ($EdgeExtensionId) {
    $EdgeExtensionId = Normalize-ExtensionId -Value $EdgeExtensionId -Label 'Edge'
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$ExePath = Join-Path $InstallDir 'PinDownloaderClipboard.exe'

if (-not $HelperPath) {
    $packagedHelper = Join-Path $PSScriptRoot 'PinDownloaderClipboard.exe'
    if (Test-Path $packagedHelper) {
        $HelperPath = $packagedHelper
    }
}

if ($HelperPath) {
    if (-not (Test-Path $HelperPath)) {
        throw "Clipboard helper not found: $HelperPath"
    }
    Copy-Item -Path $HelperPath -Destination $ExePath -Force
} else {
    $SourcePath = Join-Path $PSScriptRoot 'PinDownloaderClipboard.cs'
    if (-not (Test-Path $SourcePath)) {
        throw 'Clipboard helper not found. Pass -HelperPath or include PinDownloaderClipboard.exe next to this script.'
    }

    $FrameworkDir = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
    if (-not (Test-Path (Join-Path $FrameworkDir 'csc.exe'))) {
        $FrameworkDir = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'
    }
    $CscPath = Join-Path $FrameworkDir 'csc.exe'
    if (-not (Test-Path $CscPath)) {
        throw 'The .NET Framework 4.x C# compiler was not found. Use a prebuilt helper or install .NET Framework 4.8.'
    }

    $CompilerArgs = @(
        '/nologo',
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        "/out:$ExePath"
    )
    $ReferencePath = Join-Path $FrameworkDir 'System.Windows.Forms.dll'
    if (Test-Path $ReferencePath) {
        $CompilerArgs += "/r:$ReferencePath"
    } else {
        $CompilerArgs += '/r:System.Windows.Forms.dll'
    }
    $CompilerArgs += $SourcePath

    & $CscPath @CompilerArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ExePath)) {
        throw "C# compilation failed with exit code $LASTEXITCODE."
    }
}

$Origins = @()
if (($BrowserNames -contains 'chrome') -and $ChromeExtensionId) {
    $Origins += "chrome-extension://$ChromeExtensionId/"
}
if (($BrowserNames -contains 'edge') -and $EdgeExtensionId) {
    $Origins += "chrome-extension://$EdgeExtensionId/"
}
$Origins = @($Origins | Select-Object -Unique)

$Manifest = [ordered]@{
    name = $HostName
    description = 'PinDownloader clipboard helper'
    path = $ExePath
    type = 'stdio'
    allowed_origins = $Origins
}
$ManifestJson = $Manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
    $ManifestPath,
    $ManifestJson,
    (New-Object System.Text.UTF8Encoding($false))
)

foreach ($name in $BrowserNames) {
    $key = "$($RegistryRoots[$name])\$HostName"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $ManifestPath
    Write-Host "Registered $name native messaging host."
}

$pages = $BrowserNames | ForEach-Object { $ExtensionPages[$_] }
Write-Host "Installed PinDownloader clipboard helper: $ExePath"
Write-Host "Restart the selected browser, then reload PinDownloader."
Write-Host "Load the extension from $($pages -join ' or ') (Developer mode)."
