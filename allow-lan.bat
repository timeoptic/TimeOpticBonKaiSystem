@echo off
REM ---------------------------------------------------------------------------
REM  TimeOptic - open the shop LAN so other machines can use the system.
REM
REM  JUST DOUBLE-CLICK THIS FILE. A Windows UAC box will appear, click Yes.
REM
REM  It re-launches itself elevated, then runs allow-lan.ps1, which deletes the
REM  stale php.exe Block firewall rule and opens TCP 3010 + 8095 to the local
REM  subnet only. Nothing is exposed to the internet.
REM
REM  ASCII-only on purpose - cmd.exe and PowerShell 5.1 both mangle non-ASCII
REM  in script files that have no BOM.
REM ---------------------------------------------------------------------------

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   Asking Windows for administrator rights - click Yes on the UAC box...
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo   Running as administrator. Applying firewall rules...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow-lan.ps1"

echo.
echo   Press any key to close this window.
pause >nul
