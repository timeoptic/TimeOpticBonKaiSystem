<#
.SYNOPSIS
  Captures the screenshots the user manual needs, one per screen.

.DESCRIPTION
  Two kinds of shot. Most are just a URL: the script points the browser at the
  page, waits for it to settle, and grabs the browser window. A few show a state
  that only exists after someone clicks something - a dialog, a picked product -
  and those the script cannot reach on its own, so it prints what to set up and
  waits for Enter.

  It grabs the FOREGROUND window, not the whole screen, so nothing else on the
  desktop ends up in the manual. Keep the browser in front while it runs and do
  not touch the mouse; the countdown before each shot is there to let the page
  finish drawing, not as a chance to switch windows.

  You must already be signed in to the app in your default browser. The script
  reuses that session - it has no way to log in for you.

  Kept ASCII-only on purpose, like run.ps1: Windows PowerShell 5.1 reads .ps1
  files as ANSI unless they carry a UTF-8 BOM, so Thai text in a script file
  arrives mangled and the file fails to parse.

.EXAMPLE
  .\capture-docs.ps1                 # every shot, auto then manual
  .\capture-docs.ps1 -Only auto      # only the ones that need no clicking
  .\capture-docs.ps1 -Only manual    # only the ones that do
  .\capture-docs.ps1 -Shot receive   # redo a single shot by name
#>

[CmdletBinding()]
param(
    [ValidateSet('all', 'auto', 'manual')]
    [string]$Only = 'all',

    [string]$Shot,

    [string]$BaseUrl = 'http://localhost:3000',

    [string]$OutDir,

    # Seconds to wait after navigating before the shutter. Raise it on a slow
    # machine: a half-drawn page is worse than a slow script.
    [int]$Settle = 4
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is empty inside param() on Windows PowerShell 5.1.
if (-not $OutDir) {
    $OutDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'docs\shots'
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;

public class Win {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

<#
  The manual's shot list. `Url` means the script can get there by itself;
  `Setup` means a person has to, and the text is what they are told to do.
#>
$Shots = @(
    @{ Name = 'login';        Url = '/login';       Title = 'Sign-in screen' }
    @{ Name = 'issue';        Url = '/';            Title = 'Issue / write-off - product list' }
    @{ Name = 'receive';      Url = '/receive';     Title = 'Receive stock - product list' }
    @{ Name = 'rx';           Url = '/rx';          Title = 'RX orders' }
    @{ Name = 'dashboard';    Url = '/dashboard';   Title = 'Dashboard' }
    @{ Name = 'products';     Url = '/products';    Title = 'Catalogue' }
    @{ Name = 'lots';         Url = '/lots';        Title = 'Stock lots' }
    @{ Name = 'movements';    Url = '/movements';   Title = 'Stock ledger' }
    @{ Name = 'settlements';  Url = '/settlements'; Title = 'Owed by branches' }
    @{ Name = 'branches';     Url = '/branches';    Title = 'Branches' }
    @{ Name = 'users';        Url = '/users';       Title = 'Users' }
    @{ Name = 'help';         Url = '/help';        Title = 'Built-in help page' }

    @{ Name  = 'issue-form'
       Setup = 'On the home page, click any product row so the issue form opens below it.' }
    @{ Name  = 'palette'
       Setup = 'Press Ctrl+K to open the command palette.' }
    @{ Name  = 'newproduct-pick'
       Setup = 'Go to Receive stock, click "New product". Stop at the screen that asks what kind of thing you are adding.' }
    @{ Name  = 'newproduct-copy'
       Setup = 'In that same screen, type a word in "Start from an existing product" and press Search so the matches show.' }
    @{ Name  = 'newproduct-step1'
       Setup = 'Pick a type (Lens is a good one). Stop on step 1, the main details.' }
    @{ Name  = 'newproduct-step2'
       Setup = 'Fill SKU, name and price, then press Next. Stop on step 2, the spec and prescription.' }
    @{ Name  = 'newproduct-step3'
       Setup = 'Press Next again. Stop on step 3, the first lot.' }
    @{ Name  = 'stock-drawer'
       Setup = 'Go to the Catalogue and click any row so the product drawer opens.' }
)

if ($Shot) {
    $Shots = @($Shots | Where-Object { $_.Name -eq $Shot })
    if ($Shots.Count -eq 0) { throw "No shot named '$Shot'." }
} elseif ($Only -eq 'auto') {
    $Shots = @($Shots | Where-Object { $_.ContainsKey('Url') })
} elseif ($Only -eq 'manual') {
    $Shots = @($Shots | Where-Object { $_.ContainsKey('Setup') })
}

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

function Save-Window {
    param([string]$Path)

    $h = [Win]::GetForegroundWindow()
    $r = New-Object Win+RECT
    [void][Win]::GetWindowRect($h, [ref]$r)

    $w = $r.Right - $r.Left
    $ht = $r.Bottom - $r.Top
    if ($w -le 0 -or $ht -le 0) {
        throw 'Could not measure the front window. Is the browser minimised?'
    }

    $bmp = New-Object System.Drawing.Bitmap $w, $ht
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
        $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $g.Dispose()
        $bmp.Dispose()
    }

    return "$w x $ht"
}

function Wait-Countdown {
    param([int]$Seconds)
    for ($i = $Seconds; $i -gt 0; $i--) {
        Write-Host "`r    shutter in $i... " -NoNewline
        Start-Sleep -Seconds 1
    }
    Write-Host "`r                        `r" -NoNewline
}

Write-Host ''
Write-Host "Saving to $OutDir"
Write-Host "Sign in first, and keep the browser window in front."
Write-Host ''

$done = 0

foreach ($s in $Shots) {
    $path = Join-Path $OutDir ($s.Name + '.png')

    if ($s.ContainsKey('Url')) {
        $target = $BaseUrl + $s.Url
        Write-Host ("[{0}] {1}" -f $s.Name, $target)
        Start-Process $target
        Wait-Countdown -Seconds $Settle
    } else {
        Write-Host ("[{0}] needs you:" -f $s.Name) -ForegroundColor Yellow
        Write-Host ("    {0}" -f $s.Setup)
        Write-Host '    Then click the browser window and press Enter here.' -ForegroundColor DarkGray
        [void](Read-Host)
        # The console had focus while you pressed Enter, so give the browser a
        # moment to come back to the front before measuring the window.
        Write-Host '    click the browser now'
        Wait-Countdown -Seconds 3
    }

    try {
        $size = Save-Window -Path $path
        Write-Host ("    saved {0}  ({1})" -f (Split-Path $path -Leaf), $size) -ForegroundColor Green
        $done++
    } catch {
        Write-Host ("    FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ''
Write-Host ("Done - {0} of {1} shots saved." -f $done, $Shots.Count)
Write-Host 'Check them, redo any bad one with:  .\capture-docs.ps1 -Shot <name>'
Write-Host ''
