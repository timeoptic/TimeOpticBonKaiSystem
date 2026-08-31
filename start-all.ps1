<#
.SYNOPSIS
  Starts both halves of the merged project: the storefront and the stock module.

.DESCRIPTION
  Four servers, four ports, chosen so this folder can run at the same time as
  the two standalone checkouts next to it (which use 3000/8080 and 3005/8090):

    storefront UI   http://localhost:3010    storefront API   :8095
    stock UI        http://localhost:3011    stock API        :8085

  The database lives on another machine on the shop LAN. Turn that machine on
  before running this, or every screen will show a connection error - the ports
  will still open, which is why this script says so up front rather than
  failing later inside a page.

  Kept ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI
  unless they carry a UTF-8 BOM, so Thai text in a script file arrives mangled.

.EXAMPLE
  .\start-all.ps1          # start everything
  .\start-all.ps1 -Stop    # stop everything this script started
#>

[CmdletBinding()]
param([switch]$Stop)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Stop-Ours {
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='php.exe'" |
    Where-Object { $_.CommandLine -like "*timeoptic-merged*" } |
    ForEach-Object {
      Write-Host ("  stopping pid {0}" -f $_.ProcessId)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if ($Stop) {
  Write-Host "`nStopping the merged project" -ForegroundColor Cyan
  Stop-Ours
  Write-Host "  done`n"
  return
}

# The database host, read out of the module's own .env so there is one copy.
$dbHost = 'unknown'
$envFile = Join-Path $root 'stock\.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
  if ($line -and $line.Line -match '@([^:/]+)') { $dbHost = $Matches[1] }
}

Write-Host "`nDatabase host: $dbHost" -ForegroundColor Cyan
$up = Test-NetConnection -ComputerName $dbHost -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($up) {
  Write-Host "  reachable on 3306" -ForegroundColor Green
} else {
  Write-Host "  NOT reachable on 3306 - turn that machine on, or every page will error" -ForegroundColor Yellow
}

Write-Host "`nStopping anything already running from this folder" -ForegroundColor Cyan
Stop-Ours

Write-Host "`nStarting" -ForegroundColor Cyan
Start-Process php -ArgumentList '-S', '0.0.0.0:8095', '-t', "$root\api", "$root\api\router.php" `
  -WorkingDirectory $root -WindowStyle Minimized
Start-Process php -ArgumentList '-S', '0.0.0.0:8085', '-t', "$root\stock\api\public", "$root\stock\api\public\index.php" `
  -WorkingDirectory "$root\stock" -WindowStyle Minimized
Start-Process cmd -ArgumentList '/k', 'npm run dev -- -p 3010 --hostname 0.0.0.0' `
  -WorkingDirectory "$root\frontend-next" -WindowStyle Minimized
Start-Process cmd -ArgumentList '/k', 'npm run dev -- -p 3011 --hostname 0.0.0.0' `
  -WorkingDirectory "$root\stock\web" -WindowStyle Minimized

Write-Host "  waiting for the two web servers to compile"
foreach ($port in 8095, 8085, 3010, 3011) {
  $ok = $false
  foreach ($try in 1..40) {
    if (Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) { $ok = $true; break }
    Start-Sleep -Seconds 1
  }
  $mark = if ($ok) { 'up  ' } else { 'DOWN' }
  $colour = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("  {0}  {1}" -f $mark, $port) -ForegroundColor $colour
}

Write-Host ""
Write-Host "  Front desk        http://localhost:3010"
Write-Host "  Stock and cost    http://localhost:3011"
Write-Host ""
Write-Host "  One login covers both. Stop everything with:  .\start-all.ps1 -Stop"
Write-Host ""
