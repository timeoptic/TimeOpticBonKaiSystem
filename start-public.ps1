<#
.SYNOPSIS
  Puts the whole app on the public internet through one ngrok URL.

.DESCRIPTION
  Three processes, chained:

    php  :8095   the API (and the stock module mounted under /stock-api)
    node :8099   gateway.mjs - static web + proxy, so both halves share ONE origin
    ngrok        public https URL -> :8099

  The gateway is the point of the whole thing. Web and API normally sit on
  different ports, which the browser treats as different sites once a tunnel
  gives them different hostnames - it then drops the optic_session cookie
  (SameSite=Lax) and login bounces back to /login forever. One origin, one
  cookie, no bounce.

  The gateway serves the STATIC EXPORT, not next dev, because Next 16 blocks
  /_next/* from any origin outside allowedDevOrigins in next.config.js and the
  ngrok hostname cannot be known ahead of time. So the web must be built first;
  this script builds it for you unless -NoBuild is given.

  Kept ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI
  unless they carry a UTF-8 BOM, so Thai text in a script file arrives mangled.

.EXAMPLE
  .\start-public.ps1            # build, start everything, print the public URL
  .\start-public.ps1 -NoBuild   # skip the build (nothing in the web changed)
  .\start-public.ps1 -Stop      # stop all three
#>

[CmdletBinding()]
param(
  [switch]$Stop,
  [switch]$NoBuild,
  # Both by default, because the two have opposite weaknesses and running both
  # costs nothing - they are just two pipes onto the same gateway port.
  #
  #   ngrok       this account has a reserved name, so the link is STABLE and
  #               keeps working for whoever it was already sent to. But on the
  #               free plan every real browser meets a "You are about to visit"
  #               warning page first, and it cannot be switched off from this
  #               side: the documented removals are a request header a visitor's
  #               browser will not send, or a paid plan. curl never sees it (it
  #               is keyed on the browser User-Agent), so a smoke test misses it.
  #   cloudflare  no warning page at all, but a quick tunnel is handed a new
  #               random name every start, so old links die.
  #
  # Dropping either one breaks somebody: turning ngrok off killed a link that
  # had already been handed out. Start both, print both, let the reader choose.
  [ValidateSet('both', 'cloudflare', 'ngrok')][string]$Tunnel = 'both',
  [int]$Port = 8099,
  [int]$ApiPort = 8095
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Anything holding one of our ports, plus anything launched from this folder.
#
# Matching on the folder path alone is not enough: `php -S 127.0.0.1:8099 -t api
# api/router.php` names no absolute path, so it does not contain the folder name
# and survived a -Stop. It then kept 127.0.0.1:8099 while the gateway bound
# 0.0.0.0:8099, Windows handed every localhost connection to the more specific
# binding, and the stale API answered the public site - /login/ came back 401,
# /stock/ came back "No route for GET /api/stock/". The port is what we actually
# own, so claim it by port.
#
# (start-all.ps1 has the same blind spot from the other direction: it matches
# "timeoptic-merged", a name this checkout no longer has, so its -Stop is a
# no-op. Left alone here - it belongs to the LAN workflow, not this one.)
function Stop-Ours {
  $byPort = @()
  foreach ($p in $ApiPort, $Port, 4040) {
    try {
      $byPort += (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction Stop).OwningProcess
    } catch { }
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='php.exe' OR Name='ngrok.exe' OR Name='cloudflared.exe'" |
    Where-Object {
      $byPort -contains $_.ProcessId -or
      ($_.CommandLine -and ($_.CommandLine -like "*TimeOpticDigitalSystem*" -or
                            $_.CommandLine -like "*ngrok*http*" -or
                            $_.CommandLine -like "*cloudflared*tunnel*"))
    } |
    ForEach-Object {
      Write-Host ("  stopping {0} pid {1}" -f $_.Name, $_.ProcessId)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  Start-Sleep -Milliseconds 400
}

if ($Stop) {
  Write-Host "`nTaking the site off the internet" -ForegroundColor Cyan
  Stop-Ours
  Write-Host "  done - the public URL is dead for good, a restart gets a new one`n"
  return
}

Write-Host "`nStopping anything already running from this folder" -ForegroundColor Cyan
Stop-Ours

# The database. Every page errors without it, so say so before opening ports.
$dbHost = '127.0.0.1'
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^DB_HOST=' | Select-Object -First 1
  if ($line) { $dbHost = $line.Line.Split('=')[1].Trim() }
}
$dbUp = Test-NetConnection -ComputerName $dbHost -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue
Write-Host "`nDatabase $dbHost : " -NoNewline -ForegroundColor Cyan
if ($dbUp) { Write-Host "up" -ForegroundColor Green }
else { Write-Host "DOWN - start XAMPP MySQL or every page will error" -ForegroundColor Yellow }

# The build. NEXT_PUBLIC_API_ORIGIN must be EMPTY so both API clients fall back
# to relative paths that come back to the gateway = same origin.
#
# That value lives in frontend-next\.env.production.local, NOT here. Setting an
# environment variable to '' in PowerShell DELETES it - the child then sees it
# as unset, Next reads .env.local instead, and the LAN IP gets baked into the
# bundle. The build still succeeds and every page still loads; only a browser
# outside the shop LAN fails, and only once it tries to fetch. This script did
# exactly that once, which is why check-build-origin.mjs runs below.
if (-not $NoBuild) {
  Write-Host "`nBuilding the web (static export)" -ForegroundColor Cyan
  Push-Location (Join-Path $root 'frontend-next')
  & npx next build 2>&1 | Select-Object -Last 3
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Write-Host "  build failed - not starting anything" -ForegroundColor Red; return }
}
if (-not (Test-Path (Join-Path $root 'frontend-next\out\index.html'))) {
  Write-Host "`n  No frontend-next\out - run without -NoBuild first`n" -ForegroundColor Red
  return
}

# Refuse to publish a build that talks to an address only this LAN can reach.
Write-Host "`nChecking the build is same-origin" -ForegroundColor Cyan
& node (Join-Path $root 'check-build-origin.mjs')
if ($LASTEXITCODE -ne 0) {
  Write-Host "  not starting anything - rebuild without -NoBuild" -ForegroundColor Red
  return
}

Write-Host "`nStarting" -ForegroundColor Cyan
Start-Process php -ArgumentList '-S', "0.0.0.0:$ApiPort", '-t', "$root\api", "$root\api\router.php" `
  -WorkingDirectory $root -WindowStyle Minimized
Start-Process node -ArgumentList "$root\gateway.mjs", $Port `
  -WorkingDirectory $root -WindowStyle Minimized
$cfLog = Join-Path $root 'cloudflared.log'
$wantNgrok = $Tunnel -in 'both', 'ngrok'
$wantCf    = $Tunnel -in 'both', 'cloudflare'
if ($wantNgrok) {
  Start-Process ngrok -ArgumentList 'http', $Port -WindowStyle Minimized
}
if ($wantCf) {
  if (Test-Path $cfLog) { Remove-Item $cfLog -Force -ErrorAction SilentlyContinue }
  Start-Process cloudflared -ArgumentList 'tunnel', '--url', "http://127.0.0.1:$Port", '--logfile', $cfLog `
    -WindowStyle Minimized
}

foreach ($p in $ApiPort, $Port) {
  $ok = $false
  foreach ($try in 1..30) {
    if (Test-NetConnection 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue) { $ok = $true; break }
    Start-Sleep -Seconds 1
  }
  $mark = if ($ok) { 'up  ' } else { 'DOWN' }
  Write-Host ("  {0}  {1}" -f $mark, $p) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
}

# ngrok publishes the URL on its own local API; cloudflared prints it to its log.
$ngrokUrl = $null
$cfUrl    = $null
foreach ($try in 1..30) {
  if ($wantNgrok -and -not $ngrokUrl) {
    try {
      $t = Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3
      $ngrokUrl = ($t.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1).public_url
    } catch { }
  }
  if ($wantCf -and -not $cfUrl -and (Test-Path $cfLog)) {
    $m = Select-String -Path $cfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1
    if ($m) { $cfUrl = $m.Matches[0].Value }
  }
  if ((-not $wantNgrok -or $ngrokUrl) -and (-not $wantCf -or $cfUrl)) { break }
  Start-Sleep -Seconds 1
}
$url = if ($cfUrl) { $cfUrl } else { $ngrokUrl }

Write-Host ""
if ($url) {
  if ($cfUrl)    { Write-Host "  PUBLIC   $cfUrl" -ForegroundColor Green
                   Write-Host "             cloudflare - no warning page, but this name changes every start" }
  if ($ngrokUrl) { Write-Host "  PUBLIC   $ngrokUrl" -ForegroundColor Green
                   Write-Host "             ngrok - same name every time, but shows a warning page once" }
  Write-Host "  local    http://127.0.0.1:$Port"
  Write-Host ""
  Write-Host "  Both links reach the same site. Anyone holding one is at the shop's login page." -ForegroundColor Yellow
} else {
  Write-Host "  $Tunnel did not report a URL - check its window or $cfLog" -ForegroundColor Red
}
if ($wantNgrok -and -not $ngrokUrl) { Write-Host "  (ngrok did not come up)" -ForegroundColor Red }
if ($wantCf -and -not $cfUrl)       { Write-Host "  (cloudflared did not come up)" -ForegroundColor Red }
Write-Host ""
Write-Host "  Changed the web? Re-run this script (it rebuilds). Stop:  .\start-public.ps1 -Stop"
Write-Host ""
