<#
.SYNOPSIS
  Builds the user manual by dropping the captured screenshots into the template.

.DESCRIPTION
  The template carries a marker per picture - <!--SHOT:name|caption--> - and this
  fills each one from docs\shots\<name>.png.

  Pictures are shrunk and re-encoded as JPEG on the way in. A published page has
  to carry its images inside itself, and twenty full-size PNGs would be tens of
  megabytes of base64; at 1200px wide and quality 80 the same twenty come to a
  few. The PNGs on disk stay untouched, so a shot can be re-cropped and the page
  rebuilt without capturing again.

  A marker with no matching file becomes a visible placeholder rather than a
  broken image, so an unfinished manual says which shots are still missing
  instead of showing gaps.

  Kept ASCII-only on purpose, like run.ps1: Windows PowerShell 5.1 reads .ps1
  files as ANSI unless they carry a UTF-8 BOM, so Thai text in a script file
  arrives mangled and the file fails to parse.

.EXAMPLE
  .\build-manual.ps1
  .\build-manual.ps1 -MaxWidth 1400 -Quality 88
#>

[CmdletBinding()]
param(
    [string]$Template,
    [string]$ShotDir,
    [string]$Out,
    [int]$MaxWidth = 1200,
    [int]$Quality  = 80
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# $PSScriptRoot is empty inside param() on Windows PowerShell 5.1, so anything
# that hangs off it is resolved here rather than as a parameter default.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Template) { $Template = Join-Path $root 'docs\manual.template.html' }
if (-not $ShotDir)  { $ShotDir  = Join-Path $root 'docs\shots' }
if (-not $Out)      { $Out      = Join-Path $root 'docs\manual.html' }

if (-not (Test-Path $Template)) { throw "No template at $Template" }

$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

function Get-DataUri {
    param([string]$Path)

    $src = [System.Drawing.Image]::FromFile($Path)
    try {
        $w = $src.Width
        $h = $src.Height
        if ($w -gt $MaxWidth) {
            $h = [int][Math]::Round($h * ($MaxWidth / $w))
            $w = $MaxWidth
        }

        $dst = New-Object System.Drawing.Bitmap $w, $h
        $g = [System.Drawing.Graphics]::FromImage($dst)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.DrawImage($src, 0, 0, $w, $h)

            $ms = New-Object System.IO.MemoryStream
            try {
                $dst.Save($ms, $jpeg, $params)
                $b64 = [Convert]::ToBase64String($ms.ToArray())
            } finally { $ms.Dispose() }
        } finally {
            $g.Dispose()
            $dst.Dispose()
        }
    } finally { $src.Dispose() }

    return @{ Uri = "data:image/jpeg;base64,$b64"; W = $w; H = $h; Kb = [int]($b64.Length / 1024) }
}

$html = Get-Content -Raw -Encoding UTF8 $Template
$found = 0
$missing = @()
$totalKb = 0

$pattern = '<!--SHOT:([a-z0-9\-]+)\|([^>]*?)-->'

$html = [regex]::Replace($html, $pattern, {
    param($m)

    $name = $m.Groups[1].Value
    $caption = $m.Groups[2].Value

    # .png from the local capture script, .jpg from a browser-side capture.
    # Either is fine here - both get re-encoded on the way in anyway.
    $file = Join-Path $ShotDir "$name.png"
    if (-not (Test-Path $file)) { $file = Join-Path $ShotDir "$name.jpg" }

    if (-not (Test-Path $file)) {
        $script:missing += $name
        return @"
<figure class="shot shot--todo">
  <div class="shot__todo">screenshot missing &mdash; <code>$name.png</code></div>
  <figcaption>$caption</figcaption>
</figure>
"@
    }

    $img = Get-DataUri -Path $file
    $script:found++
    $script:totalKb += $img.Kb

    Write-Host ("  {0,-22} {1}x{2}  {3} KB" -f $name, $img.W, $img.H, $img.Kb)

    return @"
<figure class="shot">
  <img src="$($img.Uri)" alt="$caption" width="$($img.W)" height="$($img.H)" loading="lazy">
  <figcaption>$caption</figcaption>
</figure>
"@
})

Set-Content -Path $Out -Value $html -Encoding UTF8 -NoNewline

Write-Host ''
Write-Host ("Built {0}" -f $Out)
Write-Host ("  {0} pictures embedded, about {1} KB of image data" -f $found, $totalKb)

if ($missing.Count -gt 0) {
    Write-Host ("  {0} still missing: {1}" -f $missing.Count, ($missing -join ', ')) -ForegroundColor Yellow
    Write-Host '  capture them with:  .\capture-docs.ps1 -Shot <name>' -ForegroundColor DarkGray
}

$size = [int]((Get-Item $Out).Length / 1024)
Write-Host ("  page is {0} KB" -f $size)
if ($size -gt 15000) {
    Write-Host '  WARNING: over 15 MB - lower -MaxWidth or -Quality before publishing.' -ForegroundColor Red
}
Write-Host ''
