<#
.SYNOPSIS
  Registers the notification sweep with Windows Task Scheduler.

.DESCRIPTION
  Everything time-based in this project rides one sweep: api/cli/reminder.php.
  It sends the per-booking reminders that are due right now, and once a day it
  sends the delivery-queue digest (see api/services/DeliveryDigest.php).

  PHP has no long-lived process to hold a timer, so the sweep has to be woken
  from outside. Without this task nothing ever fires on its own - the code is
  all there and reachable from the Settings screen buttons, which is exactly
  how a silent notification system hides: everything "works" when a human
  presses the button, and never runs when nobody does.

  Runs every minute. One run is a couple of small queries against a queue that
  is normally empty, so the cost is noise; the digest decides for itself
  whether its turn has come (DeliveryDigest::isDue).

  Runs as the current user, and ONLY while that user is logged on. The shop PC
  stays logged in all day, and this avoids storing a password. If the machine
  is off at the digest hour, no digest goes out that evening - by design, so
  nobody gets yesterday's list at nine the next morning.

  Kept ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI
  unless they carry a UTF-8 BOM, so Thai text in a script file arrives mangled.

.EXAMPLE
  .\install-reminder-task.ps1           # create or replace the task
  .\install-reminder-task.ps1 -Remove   # delete it
  .\install-reminder-task.ps1 -Status   # show it and its last result
#>

[CmdletBinding()]
param(
  [switch]$Remove,
  [switch]$Status,
  [string]$PhpPath
)

$ErrorActionPreference = 'Stop'

$taskName = 'TimeOptic notification sweep'
$script   = Join-Path $PSScriptRoot 'api\cli\reminder.php'
$launcher = Join-Path $PSScriptRoot 'api\cli\reminder-hidden.vbs'
$logFile  = Join-Path $PSScriptRoot 'reminder.log'

if ($Status) {
  $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Host "Task '$taskName' is not registered." -ForegroundColor Yellow; return }
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  Write-Host "`nTask   : $taskName"
  Write-Host "State  : $($t.State)"
  Write-Host "Last   : $($info.LastRunTime)  result=$($info.LastTaskResult)"
  Write-Host "Next   : $($info.NextRunTime)"
  Write-Host "Log    : $logFile`n"
  return
}

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed '$taskName'." -ForegroundColor Cyan
  return
}

# The sweep must find the same PHP the API runs on - a second install without
# the pdo_mysql extension fails on every run and leaves an empty-looking log.
if (-not $PhpPath) {
  $candidates = @(
    (Get-Command php.exe -ErrorAction SilentlyContinue).Source,
    'C:\xampp\php\php.exe',
    'C:\php\php.exe'
  ) | Where-Object { $_ -and (Test-Path $_) }
  $PhpPath = $candidates | Select-Object -First 1
}
if (-not $PhpPath) {
  throw "php.exe not found. Pass one: .\install-reminder-task.ps1 -PhpPath C:\path\to\php.exe"
}
if (-not (Test-Path $script))   { throw "Not found: $script" }
if (-not (Test-Path $launcher)) { throw "Not found: $launcher" }

Write-Host "`nPHP    : $PhpPath"
Write-Host "Script : $script"

# Prove it runs before handing it to the scheduler, so a broken PHP shows up
# here and not as a silent result=1 in a task nobody opens.
Write-Host "`nTest run..." -ForegroundColor Cyan
& $PhpPath $script
if ($LASTEXITCODE -ne 0) { throw "The sweep exited with code $LASTEXITCODE - fix that before scheduling it." }

# Through wscript.exe, not php.exe directly: a bare php.exe action pops a
# console window on the counter's screen every minute. See reminder-hidden.vbs.
#
# Registered with schtasks.exe rather than Register-ScheduledTask because the
# cmdlet has no way to spell "repeat forever" that this Windows accepts:
# -RepetitionDuration ([TimeSpan]::MaxValue) becomes P99999999DT23H59M59S and
# comes back as "The task XML contains a value which is incorrectly formatted
# or out of range." /SC MINUTE is open-ended by definition, so the problem
# does not arise.
$run = '"{0}" "{1}" "{2}"' -f (Join-Path $env:SystemRoot 'System32\wscript.exe'), $launcher, $PhpPath

# Ask before deleting rather than deleting and swallowing the error: in
# Windows PowerShell 5.1, redirecting a native command's stderr turns each line
# into an ErrorRecord and sets $? to $false, so "schtasks /Delete 2>$null" on a
# task that was never there aborts this script under -ErrorActionPreference Stop.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
schtasks.exe /Create /TN $taskName /TR $run /SC MINUTE /MO 1 /F | Out-Null

# schtasks reports failure through the exit code, and Register-ScheduledTask
# reports it through a non-terminating error that sails past
# $ErrorActionPreference. Either way an unchecked call prints "Registered" for
# a task that does not exist - which is the worst outcome here, because the
# whole point of this file is a job nobody watches. Ask Windows instead.
if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
  throw "Registration failed - '$taskName' is not in Task Scheduler."
}

Write-Host "`nRegistered '$taskName' - every minute, while you are logged on." -ForegroundColor Green
Write-Host "Log: $logFile   (written only on rounds that did something)"
Write-Host "Check it with: .\install-reminder-task.ps1 -Status`n"
