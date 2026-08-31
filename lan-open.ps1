<#
.SYNOPSIS
  Lets other machines on the shop network reach this app. Run once, as
  Administrator.

.DESCRIPTION
  Windows Firewall blocks incoming connections by default, so the app answers
  this PC and nothing else until ports 3000 (web) and 8080 (API) are allowed.

  The rules created here are deliberately narrow:

    - inbound TCP only, on those two ports and no others
    - RemoteAddress limited to this machine's own subnet, so the rule cannot
      let anything in from outside the shop even if the PC is later plugged
      into a different network
    - all firewall profiles, because Windows has classified this Ethernet
      connection as "Public" and a shop LAN often stays that way

  Undo everything with:  .\lan-open.ps1 -Remove

.EXAMPLE
  .\lan-open.ps1              open the ports
  .\lan-open.ps1 -Remove      close them again
#>

[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host ''
  Write-Host '  ต้องรันด้วยสิทธิ์ Administrator' -ForegroundColor Yellow
  Write-Host '  คลิกขวาที่ PowerShell -> Run as administrator แล้วรันคำสั่งนี้อีกครั้ง:'
  Write-Host ("    cd '{0}'; .\lan-open.ps1{1}" -f $PSScriptRoot, $(if ($Remove) { ' -Remove' } else { '' }))
  Write-Host ''
  exit 1
}

$rules = @(
  @{ Name = 'timeoptic-web'; Port = 3000; Desc = 'TimeOptic stock app (Next.js)' },
  @{ Name = 'timeoptic-api'; Port = 8080; Desc = 'TimeOptic stock app (PHP API)' }
)

if ($Remove) {
  foreach ($r in $rules) {
    if (Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue) {
      Remove-NetFirewallRule -DisplayName $r.Name
      Write-Host ("  ลบกฎแล้ว: {0} (พอร์ต {1})" -f $r.Name, $r.Port) -ForegroundColor Green
    } else {
      Write-Host ("  ไม่มีกฎ {0} อยู่แล้ว" -f $r.Name)
    }
  }
  Write-Host ''
  Write-Host '  ปิดการเข้าถึงจากเครื่องอื่นแล้ว — เหลือเปิดได้จากเครื่องนี้เท่านั้น'
  exit 0
}

# This PC's address and the subnet it sits on, so the rule is scoped to the
# actual shop network rather than to "anywhere".
$net = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -First 1

if (-not $net) {
  Write-Host '  หาที่อยู่ไอพีของเครื่องนี้ไม่เจอ — เสียบสายแลนหรือต่อ Wi-Fi ก่อน' -ForegroundColor Yellow
  exit 1
}

$subnet = '{0}/{1}' -f ($net.IPAddress -replace '\.\d+$', '.0'), $net.PrefixLength

foreach ($r in $rules) {
  if (Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $r.Name
  }
  New-NetFirewallRule `
    -DisplayName $r.Name `
    -Description $r.Desc `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $r.Port `
    -RemoteAddress $subnet `
    -Profile Any | Out-Null

  Write-Host ("  เปิดพอร์ต {0} ให้เฉพาะเครื่องในวง {1}" -f $r.Port, $subnet) -ForegroundColor Green
}

Write-Host ''
Write-Host ('  เปิดเรียบร้อย — เครื่องอื่นในร้านเข้าที่  http://{0}:3000' -f $net.IPAddress) -ForegroundColor Green
Write-Host '  ปิดกลับเมื่อไหร่ก็ได้ด้วย:  .\lan-open.ps1 -Remove'
Write-Host ''
