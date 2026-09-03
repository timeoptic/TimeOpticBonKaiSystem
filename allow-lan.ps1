<#
.SYNOPSIS
  Let other machines on the shop LAN reach TimeOptic. Must be run as Administrator.

.DESCRIPTION
  The problem this fixes: when the API was first started, Windows asked whether to
  let php.exe use the network and somebody clicked Cancel. Windows then wrote a
  *Block* rule for php.exe and kept it. In Windows Firewall a Block rule always
  beats an Allow rule, so opening the port afterwards changes nothing. The result
  is that other machines load the web page fine (node.exe is allowed) but every
  API call to :8095 is dropped, and every screen shows "connection error".
  The give-away in the browser console is ERR_CONNECTION_TIMED_OUT rather than
  ERR_CONNECTION_REFUSED: a Block rule drops packets silently, it does not reject.

  This script deletes that Block rule, then opens TCP 3010 (web) and 8095 (API)
  with -RemoteAddress LocalSubnet, i.e. only to machines on the same LAN. It does
  not expose anything to the internet, even though Windows has classified this
  network as Public.

  Kept ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI
  unless they carry a UTF-8 BOM, so Thai text in a script file arrives mangled
  and breaks parsing. Same reason start-all.ps1 is ASCII-only.

.EXAMPLE
  From any PowerShell window (a UAC prompt will appear, click Yes):
    Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy','Bypass','-NoExit','-File','C:\TimeOpticDigitalSystem\allow-lan.ps1'

  Or right-click the file -> Run with PowerShell, from an elevated shell.

  To close LAN access again:
    powershell -ExecutionPolicy Bypass -File C:\TimeOpticDigitalSystem\allow-lan.ps1 -Undo
#>

[CmdletBinding()]
param([switch]$Undo)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host ""
  Write-Host "  X This script must run as Administrator." -ForegroundColor Red
  Write-Host "    Right-click PowerShell -> Run as administrator, then run it again."
  Write-Host ""
  exit 1
}

$WEB = 3010
$API = 8095

if ($Undo) {
  Write-Host ""
  Write-Host "Closing LAN access" -ForegroundColor Cyan
  foreach ($n in 'TimeOptic LAN web', 'TimeOptic LAN api') {
    $found = Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue
    if ($found) {
      foreach ($r in $found) { Remove-NetFirewallRule -Name $r.Name }
      Write-Host ("  removed rule: " + $n)
    }
  }
  Write-Host "  done - other machines can no longer connect" -ForegroundColor Green
  Write-Host ""
  return
}

Write-Host ""
Write-Host "1. Removing the stale php.exe Block rule" -ForegroundColor Cyan
$blocked = Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue |
           Where-Object { $_.DisplayName -eq 'php.exe' }
if ($blocked) {
  foreach ($r in $blocked) {
    $prog = '(unknown path)'
    try { $prog = ($r | Get-NetFirewallApplicationFilter).Program } catch { }
    Remove-NetFirewallRule -Name $r.Name
    Write-Host ("  removed: " + $prog) -ForegroundColor Yellow
  }
} else {
  Write-Host "  none found, skipping"
}

Write-Host ""
Write-Host "2. Opening the ports to the local subnet only" -ForegroundColor Cyan
$rules = @(
  @{ Name = 'TimeOptic LAN web'; Port = $WEB },
  @{ Name = 'TimeOptic LAN api'; Port = $API }
)
foreach ($p in $rules) {
  $old = Get-NetFirewallRule -DisplayName $p.Name -ErrorAction SilentlyContinue
  if ($old) { foreach ($r in $old) { Remove-NetFirewallRule -Name $r.Name } }
  New-NetFirewallRule -DisplayName $p.Name -Direction Inbound -Protocol TCP -LocalPort $p.Port -Action Allow -Profile Any -RemoteAddress LocalSubnet | Out-Null
  Write-Host ("  opened TCP " + $p.Port + " (LocalSubnet only)") -ForegroundColor Green
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
       Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ("  Staff machines open:  http://" + $ip + ":" + $WEB)
Write-Host  "  This machine must use the SAME url, not localhost."
Write-Host  "  (the login cookie is SameSite=Lax - a different host name counts as a"
Write-Host  "   different site, and login will bounce back to the login page forever)"
Write-Host ""
