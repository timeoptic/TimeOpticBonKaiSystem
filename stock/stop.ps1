<#
.SYNOPSIS
  Stops the app's servers and closes the windows they were started in.

.DESCRIPTION
  start.bat calls this before launching, so running it a second time replaces
  the first pair of windows instead of stacking another pair on top. Run it by
  hand to shut everything down.

  Only this project's processes are touched: each one is matched on the full
  path of this folder, so a Node or PHP server belonging to something else on
  the same PC is left alone.
#>

[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$pattern = [regex]::Escape($root)

function Say([string]$m) { if (-not $Quiet) { Write-Host $m } }

# The servers first. Killing a window before its child leaves the child running
# with no way left to reach it.
$servers = Get-CimInstance Win32_Process -Filter "Name='php.exe' OR Name='node.exe'" |
  Where-Object { $_.CommandLine -match $pattern }

$parents = @($servers | ForEach-Object { $_.ParentProcessId })

foreach ($p in $servers) {
  Stop-Process -Id $p.ProcessId -Force
  Say ("  หยุด {0} (pid {1})" -f $p.Name, $p.ProcessId)
}

Start-Sleep -Milliseconds 400

# Then every console window that was hosting one, plus any left over from an
# earlier run — a window whose server is already gone has nothing left to show.
$windows = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='cmd.exe'" |
  Where-Object {
    $_.ProcessId -ne $PID -and
    ($_.CommandLine -match "$pattern\run\.ps1" -or
     ($_.CommandLine -match 'npm run dev|next dev' -and ($parents -contains $_.ProcessId -or $_.CommandLine -match 'npm run dev')))
  }

foreach ($w in $windows) {
  Stop-Process -Id $w.ProcessId -Force
  Say ("  ปิดหน้าต่าง {0} (pid {1})" -f $w.Name, $w.ProcessId)
}

if (-not $Quiet) {
  Write-Host ''
  Write-Host ("  หยุดเซิร์ฟเวอร์ {0} ตัว · ปิดหน้าต่าง {1} บาน" -f $servers.Count, $windows.Count) -ForegroundColor Green
}
