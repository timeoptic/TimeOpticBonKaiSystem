<#
.SYNOPSIS
  Runs the project's PHP commands without needing php on PATH.

.DESCRIPTION
  winget adds PHP to PATH when it installs, but a terminal opened before that
  still has the old value. This script locates php.exe itself.

  Kept ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI
  unless they carry a UTF-8 BOM, so Thai text in a script file arrives mangled
  and the file fails to parse. Messages to the user belong in the PHP output,
  which has no such problem.

.EXAMPLE
  .\run.ps1 test              # run every test
  .\run.ps1 test stock        # only test files whose name contains "stock"
  .\run.ps1 migrate --dry     # show pending migrations
  .\run.ps1 migrate           # apply them
  .\run.ps1 doctor            # check this machine can run the project
  .\run.ps1 serve             # start the API on http://localhost:8080
  .\run.ps1 php -v            # call php directly
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('test', 'migrate', 'serve', 'doctor', 'php')]
  [string]$Command = 'test',

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

function Find-Php {
  $c = Get-Command php -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }

  $paths = @(
    [System.Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [System.Environment]::GetEnvironmentVariable('Path', 'User')
  ) -join ';'
  foreach ($dir in $paths.Split(';')) {
    if ([string]::IsNullOrWhiteSpace($dir)) { continue }
    $candidate = Join-Path $dir 'php.exe'
    if (Test-Path $candidate) { return $candidate }
  }

  $winget = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path $winget) {
    $found = Get-ChildItem $winget -Filter 'php.exe' -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }

  throw 'php.exe not found. Install it with: winget install --id PHP.PHP.8.4'
}

$php = Find-Php
$root = $PSScriptRoot

switch ($Command) {
  'test'    { & $php (Join-Path $root 'api\tests\run.php')  @Rest }
  'migrate' { & $php (Join-Path $root 'api\bin\migrate.php') @Rest }
  'doctor'  { & $php (Join-Path $root 'api\bin\doctor.php') }
  'serve' {
    # 'lan' binds every interface so other machines on the shop network can
    # reach the API. Without it the server answers this PC only, which stays the
    # default: a laptop that leaves the shop should not keep listening.
    $lan = $Rest -contains 'lan'
    $rest = @($Rest | Where-Object { $_ -ne 'lan' })
    $port = if ($rest.Count -gt 0 -and $rest[0]) { $rest[0] } else { '8080' }
    $bind = if ($lan) { "0.0.0.0:$port" } else { "localhost:$port" }

    if ($lan) {
      $ip = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -First 1 -ExpandProperty IPAddress)
      Write-Host "API on http://localhost:$port and http://${ip}:$port  (Ctrl+C to stop)"
    } else {
      Write-Host "API on http://localhost:$port  (Ctrl+C to stop)"
    }

    & $php '-S' $bind '-t' (Join-Path $root 'api\public')
  }
  'php'     { & $php @Rest }
}

exit $LASTEXITCODE
