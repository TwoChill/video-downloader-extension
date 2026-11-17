# Installeert de extensie in een vaste map en opent de extensiepagina van je browser.
# Opnieuw draaien = bijwerken (daarna in de browser op de herlaadknop bij de extensie drukken).
# Test/geavanceerd: $env:VD_DEST = andere doelmap, $env:VD_NOOPEN = 1 = geen browser openen.
$ErrorActionPreference = 'Stop'
$repo = 'TwoChill/video-downloader-extension'
$dest = if ($env:VD_DEST) { $env:VD_DEST } else { Join-Path $env:LOCALAPPDATA 'VideoDownloaderExtension' }
$zip  = Join-Path $env:TEMP 'vd-ext.zip'
$tmp  = Join-Path $env:TEMP 'vd-ext-unzip'

Write-Host 'Downloaden...'
Invoke-WebRequest "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip $tmp -Force
$bron = Join-Path (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName 'extension'
if (-not (Test-Path (Join-Path $bron 'manifest.json'))) { throw 'manifest.json niet gevonden in de download.' }

# Bijwerken in dezelfde map: het pad blijft gelijk, dus de browser hoeft alleen te herladen.
if (Test-Path $dest) { Get-ChildItem $dest -Force | Remove-Item -Recurse -Force } else { New-Item -ItemType Directory $dest | Out-Null }
Copy-Item (Join-Path $bron '*') $dest -Recurse -Force
Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $dest 'lib\mux-mp4.min.js'))) { throw 'Installatie onvolledig: lib\mux-mp4.min.js ontbreekt.' }
Set-Clipboard $dest

$browsers = @(
  @{ n = 'Brave';  p = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe";   u = 'brave://extensions' },
  @{ n = 'Brave';  p = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe";   u = 'brave://extensions' },
  @{ n = 'Chrome'; p = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe";                u = 'chrome://extensions' },
  @{ n = 'Edge';   p = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe";        u = 'edge://extensions' }
)
$b = $browsers | Where-Object { Test-Path $_.p } | Select-Object -First 1
Write-Host ''
Write-Host "Klaar. De extensie staat in: $dest   (pad staat op je klembord)"
Write-Host 'Nog 3 klikken in de browser:'
Write-Host '  1. Zet "Ontwikkelaarsmodus" aan (rechtsboven)'
Write-Host '  2. Klik "Uitgepakt laden"'
Write-Host '  3. Plak het pad (Ctrl+V) in de mapkiezer en kies de map'
if ($b -and -not $env:VD_NOOPEN) { Write-Host "Ik open nu $($b.n)..."; Start-Process $b.p $b.u } elseif (-not $b) { Write-Host 'Open zelf de pagina chrome://extensions in je browser.' }
