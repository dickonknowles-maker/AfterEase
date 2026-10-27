<#
.SYNOPSIS
  Installs the AfterEase CEP extension for development on Windows.

.DESCRIPTION
  Copies the extension to %APPDATA%\Adobe\CEP\extensions\com.afterease and
  sets PlayerDebugMode to 1 under HKCU\Software\Adobe\CSXS.11 and CSXS.12, so
  After Effects loads the unsigned extension. Restart After Effects afterwards
  and open Window > Extensions (Legacy) > AfterEase.

  -Link makes a directory junction to this repo instead of copying, so edits
  show up after reloading the panel. Use a plain copy for the phase 0
  "fresh install" check.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-dev.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-dev.ps1 -Link
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-dev.ps1 -Uninstall
#>
param(
    [switch]$Link,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$bundleId = 'com.afterease'
$repo = Split-Path -Parent $PSScriptRoot
$extensions = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$dest = Join-Path $extensions $bundleId
$runtimeItems = @('CSXS', 'client', 'core', 'host', 'launchers', '.debug')

function Remove-Existing {
    if (Test-Path -LiteralPath $dest) {
        $item = Get-Item -LiteralPath $dest -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            # A junction: remove the link only, never the repo it points to.
            $item.Delete()
        } else {
            Remove-Item -LiteralPath $dest -Recurse -Force
        }
        Write-Host "Removed $dest"
    }
}

if ($Uninstall) {
    Remove-Existing
    Write-Host 'PlayerDebugMode left as it is; other unsigned extensions may need it.'
    return
}

foreach ($version in '11', '12') {
    $key = "HKCU:\Software\Adobe\CSXS.$version"
    if (-not (Test-Path $key)) {
        New-Item -Path $key -Force | Out-Null
    }
    Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
    Write-Host "PlayerDebugMode = 1 under $key"
}

New-Item -ItemType Directory -Path $extensions -Force | Out-Null
Remove-Existing

if ($Link) {
    New-Item -ItemType Junction -Path $dest -Target $repo | Out-Null
    Write-Host "Linked $dest -> $repo"
} else {
    New-Item -ItemType Directory -Path $dest | Out-Null
    foreach ($name in $runtimeItems) {
        $src = Join-Path $repo $name
        if (-not (Test-Path -LiteralPath $src)) {
            throw "Missing $src"
        }
        Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
    }
    Write-Host "Copied extension to $dest"
}

Write-Host ''
Write-Host 'Next:'
Write-Host '  1. Restart After Effects.'
Write-Host '  2. Window > Extensions (Legacy) > AfterEase.'
Write-Host '  3. Debugger (optional): http://localhost:8088 in Chrome while the panel is open.'
Write-Host "  4. Spike 1: copy the files in $(Join-Path $repo 'launchers') to AE's Scripts folder"
Write-Host '     (needs admin), e.g. C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts'
