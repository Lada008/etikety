<#
.SYNOPSIS
  Hromadný generátor tiskových PDF etiket pro Vinařství Salajka (bez externích závislostí na Windows).
.DESCRIPTION
  Načte data z data/odrudy.csv, dosadí je do šablony templates/etiketa_template.html,
  vygeneruje pro každou odrůdu dynamický vektorový QR kód z její URL a exportuje:
    1) output/<kod>_tisk.pdf                  — tiskové PDF (150×95 mm + 3 mm spadávka + ořezové značky)
    2) output/spot/<kod>_Spot_UV_Embossing.pdf — technická vrstva 100% Magenta (parciální lak / reliéf)
    3) output/preview/<kod>_nahled.html       — kontrolní náhled (CMYK + poloprůhledný Spot_UV + ořez)
.PARAMETER Shadow
  Zapnutí/vypnutí volitelné stínované vrstvy ('on' nebo 'off'). Výchozí: 'on'.
.PARAMETER CsvPath
  Cesta k CSV souboru s odrůdami. Výchozí: data/odrudy.csv.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\generate_labels.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\generate_labels.ps1 -Shadow off
#>
param(
    [ValidateSet('on', 'off')]
    [string]$Shadow = 'on',
    [string]$CsvPath = ''
)

$ErrorActionPreference = 'Stop'

$RootDir     = Split-Path -Parent $PSScriptRoot
if (-not $CsvPath) { $CsvPath = Join-Path $RootDir 'data\odrudy.csv' }
$TemplatePath = Join-Path $RootDir 'templates\etiketa_template.html'
$LogoSvgPath  = Join-Path $RootDir 'assets\logo_salajka_layers.svg'
$GlassSvgPath = Join-Path $RootDir 'assets\znak_vina_cr.svg'
$QrJsPath     = Join-Path $RootDir 'scripts\qr_svg.js'

$OutDir       = Join-Path $RootDir 'output'
$SpotDir      = Join-Path $OutDir  'spot'
$PreviewDir   = Join-Path $OutDir  'preview'
$TempDir      = Join-Path $env:TEMP ('salajka_etikety_' + [guid]::NewGuid().ToString('N').Substring(0, 8))

foreach ($dir in @($OutDir, $SpotDir, $PreviewDir, $TempDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

# Vyhledání headless prohlížeče (Edge nebo Chrome)
$BrowserCandidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe'
)
$BrowserExe = $BrowserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $BrowserExe) {
    throw 'Nebyl nalezen Microsoft Edge ani Google Chrome pro export do PDF.'
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8File([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Escape-Html([string]$Value) {
    if ($null -eq $Value) { return '' }
    return [System.Net.WebUtility]::HtmlEncode($Value)
}

function Split-Alcohol([string]$AlcoholStr) {
    # Rozdělí "12,5 % obj." na číslo "12,5 %" a jednotku "obj." pro věrnou typografickou hierarchii
    if ($AlcoholStr -match '^([0-9]+(?:[,\.][0-9]+)?\s*%)\s*(.*)$') {
        return @{ Num = $Matches[1]; Unit = $Matches[2] }
    }
    return @{ Num = $AlcoholStr; Unit = '' }
}

function Render-Html([string]$Template, $Row, [string]$LogoSvg, [string]$GlassSvg, [string]$QrJs, [string]$Mode, [string]$ShadowMode) {
    $alc = Split-Alcohol $Row.alkohol
    $layerLabel = switch ($Mode) {
        'cmyk'    { if ($ShadowMode -eq 'on') { 'CMYK + Stin' } else { 'CMYK (bez stinu)' } }
        'spot'    { 'Spot_UV / Embossing (100% M)' }
        'preview' { 'NAHLED (CMYK + Spot_UV)' }
    }

    # Odstranění XML prologu před inline vložením SVG
    $logoClean  = $LogoSvg  -replace '<\?xml[^>]*\?>\s*', ''
    $glassClean = $GlassSvg -replace '<\?xml[^>]*\?>\s*', ''

    $html = $Template
    $replacements = @{
        '{{KOD}}'                   = (Escape-Html $Row.kod)
        '{{ODRUDY_NAZEV}}'          = (Escape-Html $Row.odrudy_nazev)
        '{{ZATRID_CUKR}}'           = (Escape-Html $Row.zatrid_cukr)
        '{{ZATRID_KRATKE}}'         = (Escape-Html $Row.zatrid_kratke)
        '{{ROCNIK}}'                = (Escape-Html $Row.rocnik)
        '{{VINICNI_TRAT}}'          = (Escape-Html $Row.vinicni_trat)
        '{{CISLO_SARZE}}'           = (Escape-Html $Row.cislo_sarze)
        '{{ENERGETICKA_HODNOTA}}'   = (Escape-Html $Row.energeticka_hodnota)
        '{{ALKOHOL_CISLO}}'         = (Escape-Html $alc.Num)
        '{{ALKOHOL_JEDNOTKA}}'      = (Escape-Html $alc.Unit)
        '{{OBJEM}}'                 = (Escape-Html $Row.objem)
        '{{OBSAHUJE}}'              = (Escape-Html $Row.obsahuje)
        '{{URL_E_ETIKETA}}'         = (Escape-Html $Row.url_e_etiketa)
        '{{RENDER_MODE}}'           = $Mode
        '{{SHADOW_MODE}}'           = $ShadowMode
        '{{LAYER_LABEL}}'           = (Escape-Html $layerLabel)
        '{{LOGO_SVG_INLINE}}'       = $logoClean
        '{{WINE_GLASS_SVG_INLINE}}' = $glassClean
        '{{QR_SVG_INLINE}}'         = ''
        '{{QR_JS_INLINE}}'          = $QrJs
    }
    foreach ($k in $replacements.Keys) {
        $html = $html.Replace($k, $replacements[$k])
    }
    return $html
}

function Export-Pdf([string]$HtmlPath, [string]$PdfPath) {
    $fileUri = ([System.Uri]$HtmlPath).AbsoluteUri
    $profileDir = Join-Path $TempDir ('profile_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $args = @(
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-extensions',
        '--virtual-time-budget=2000',
        "--user-data-dir=`"$profileDir`"",
        '--no-pdf-header-footer',
        '--print-to-pdf-no-header',
        "--print-to-pdf=`"$PdfPath`"",
        "`"$fileUri`""
    )
    $proc = Start-Process -FilePath $BrowserExe -ArgumentList $args -Wait -PassThru -NoNewWindow
    if (Test-Path $profileDir) {
        Remove-Item -Path $profileDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($proc.ExitCode -ne 0 -or -not (Test-Path $PdfPath)) {
        throw "Export PDF selhal pro $HtmlPath (exit code $($proc.ExitCode))"
    }
}

Write-Host "=== Generátor tiskových etiket Vinařství Salajka ===" -ForegroundColor Cyan
Write-Host "CSV zdroj : $CsvPath"
Write-Host "Stínování : $Shadow"
Write-Host "Renderer  : $BrowserExe"

$templateContent = Read-Utf8File $TemplatePath
$logoContent     = Read-Utf8File $LogoSvgPath
$glassContent    = Read-Utf8File $GlassSvgPath
$qrJsContent     = Read-Utf8File $QrJsPath

$rows = Import-Csv -Path $CsvPath -Delimiter ';' -Encoding UTF8
Write-Host "Nalezeno odrůd: $($rows.Count)`n"

foreach ($row in $rows) {
    $code = $row.kod.Trim()
    Write-Host "-> Zpracovávám [$code] $($row.odrudy_nazev) ($($row.rocnik)) ..." -ForegroundColor Yellow

    # 1. Tiskové PDF (CMYK základ + volitelný stín)
    $tmpCmykHtml = Join-Path $TempDir "${code}_cmyk.html"
    $outCmykPdf  = Join-Path $OutDir  "${code}_tisk.pdf"
    $htmlCmyk = Render-Html $templateContent $row $logoContent $glassContent $qrJsContent 'cmyk' $Shadow
    [System.IO.File]::WriteAllText($tmpCmykHtml, $htmlCmyk, $Utf8NoBom)
    Export-Pdf $tmpCmykHtml $outCmykPdf
    Write-Host "   [OK] Tiskové PDF : $outCmykPdf" -ForegroundColor Green

    # 2. Technická separace Spot_UV / Embossing (100% Magenta)
    $tmpSpotHtml = Join-Path $TempDir "${code}_spot.html"
    $outSpotPdf  = Join-Path $SpotDir "${code}_Spot_UV_Embossing.pdf"
    $htmlSpot = Render-Html $templateContent $row $logoContent $glassContent $qrJsContent 'spot' 'off'
    [System.IO.File]::WriteAllText($tmpSpotHtml, $htmlSpot, $Utf8NoBom)
    Export-Pdf $tmpSpotHtml $outSpotPdf
    Write-Host "   [OK] Spot_UV PDF : $outSpotPdf" -ForegroundColor Magenta

    # 3. Kontrolní náhled HTML (s čárkovaným čistým ořezem a poloprůhlednou Spot_UV vrstvou)
    $outPreviewHtml = Join-Path $PreviewDir "${code}_nahled.html"
    $htmlPreview = Render-Html $templateContent $row $logoContent $glassContent $qrJsContent 'preview' $Shadow
    [System.IO.File]::WriteAllText($outPreviewHtml, $htmlPreview, $Utf8NoBom)
    Write-Host "   [OK] Náhled HTML : $outPreviewHtml" -ForegroundColor DarkGray
}

# Úklid dočasných souborů
Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "`nHotovo! Všechny etikety byly vygenerovány do složky: $OutDir" -ForegroundColor Cyan
