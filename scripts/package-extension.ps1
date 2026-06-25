param(
  [string]$Version = "",
  [int]$KeepVersions = 3
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$Outputs = Join-Path $Root "outputs"
$Work = Join-Path $Root "work"
$ChineseProductName = -join ([char[]](27714, 32844, 30003, 35831, 21161, 25163))
$PackageLabel = "Job-Application-Helper_$ChineseProductName"

function Get-ManifestVersion {
  $manifestPath = Join-Path $Root "manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  return [string]$manifest.version
}

function Assert-InWorkspace($Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $rootFull = [System.IO.Path]::GetFullPath($Root + [System.IO.Path]::DirectorySeparatorChar)
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside workspace: $full"
  }
  return $full
}

function Reset-Directory($Path) {
  $full = Assert-InWorkspace $Path
  if ([System.IO.Directory]::Exists($full)) {
    [System.IO.Directory]::Delete($full, $true)
  }
  [System.IO.Directory]::CreateDirectory($full) | Out-Null
}

function Copy-CleanDirectory($Source, $Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { return }
  $target = Join-Path $Destination (Split-Path -Leaf $Source)
  Reset-Directory $target
  Get-ChildItem -LiteralPath $Source -Recurse -Force | ForEach-Object {
    $relative = $_.FullName.Substring($Source.Length).TrimStart("\", "/")
    if (-not $relative) { return }
    if ($relative -match "(^|[\\/])__pycache__([\\/]|$)" -or $_.Name -match "\.py[co]$") { return }
    $destPath = Join-Path $target $relative
    if ($_.PSIsContainer) {
      [System.IO.Directory]::CreateDirectory($destPath) | Out-Null
    } else {
      $destDir = Split-Path -Parent $destPath
      [System.IO.Directory]::CreateDirectory($destDir) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $destPath -Force
    }
  }
}

function Copy-Package($Destination) {
  Reset-Directory $Destination
  $rootFiles = @(
    "manifest.json",
    "popup.html",
    "popup.css",
    "popup.js",
    "launcher.html",
    "launcher.css",
    "launcher.js",
    "ui_theme.css",
    "ui_theme.js",
    "profile.html",
    "profile.css",
    "profile.js",
    "settings.html",
    "settings.css",
    "settings.js",
    "resume_tailor.html",
    "resume_tailor.css",
    "resume_tailor.js",
    "job_finder.html",
    "job_finder_app.js",
    "main.py"
  )
  foreach ($file in $rootFiles) {
    Copy-Item -LiteralPath (Join-Path $Root $file) -Destination $Destination -Force
  }
  Get-ChildItem -LiteralPath $Root -File -Filter "*.md" | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Force
  }
  foreach ($dir in @("modules", "job_agent", "vendor", "icons")) {
    Copy-CleanDirectory (Join-Path $Root $dir) $Destination
  }
}

function Remove-OldPackages {
  param([int]$Keep)
  if ($Keep -lt 1) { return }
  $labelEscaped = [regex]::Escape($PackageLabel)
  $pattern = "^$labelEscaped-v(?<version>\d+\.\d+\.\d+)\.zip$"
  $packages = Get-ChildItem -LiteralPath $Outputs -File -Filter "$PackageLabel-v*.zip" | Where-Object { $_.Name -match $pattern }
  $sorted = $packages | Sort-Object @{ Expression = { [version]($_.Name -replace $pattern, '${version}') }; Descending = $true }, LastWriteTime -Descending
  $sorted | Select-Object -Skip $Keep | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force
    Write-Host "Removed old package: $($_.Name)"
  }
}

if (-not $Version) {
  $Version = Get-ManifestVersion
}
$Version = $Version.TrimStart("v")

[System.IO.Directory]::CreateDirectory($Outputs) | Out-Null
[System.IO.Directory]::CreateDirectory($Work) | Out-Null

$current = Join-Path $Outputs "JobApplicationHelper-current\JobApplicationHelper"
$releasePackage = Join-Path $Work "release-v$($Version.Replace('.', ''))\JobApplicationHelper"
$releaseZip = Join-Path $Outputs "$PackageLabel-v$Version.zip"

Copy-Package $current
Copy-Package $releasePackage

if (Test-Path -LiteralPath $releaseZip) { Remove-Item -LiteralPath $releaseZip -Force }

Compress-Archive -Path (Join-Path $releasePackage "*") -DestinationPath $releaseZip -Force

Remove-OldPackages -Keep $KeepVersions

Write-Host "Current extension folder: $current"
Write-Host "Release package: $releaseZip"
Write-Host "Kept latest $KeepVersions unified release package(s)."
