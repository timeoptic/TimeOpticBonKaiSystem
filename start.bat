@echo off
setlocal
rem Starts both halves of the project and opens the app.
rem
rem Both servers bind every network interface, not just this machine, so anyone
rem on the shop LAN can reach them by this PC's address. Windows Firewall still
rem has to allow ports 3000 and 8080 inbound - run lan-open.ps1 once, as
rem Administrator, if other devices cannot connect.
rem
rem ASCII only on purpose: cmd.exe reads .bat files as the system ANSI codepage,
rem so Thai text here would arrive mangled. Messages in Thai belong in the PHP
rem and Next output, which handle UTF-8 fine.
rem
rem Close either window (or Ctrl+C in it) to stop that half.

rem Close anything this script started before, servers and their windows alike.
rem Without this, running start.bat twice leaves the first pair of windows open
rem with dead servers inside them, and they pile up until someone notices.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" -Quiet

rem This PC-s address on the shop network, found rather than hard-coded so a new
rem lease from the router does not silently break the printed link.
for /f %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress)"') do set LANIP=%%i
if "%LANIP%"=="" set LANIP=localhost

start "timeoptic api" powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0run.ps1" serve lan
start "timeoptic web" /d "%~dp0web" cmd /k npm run dev -- --hostname 0.0.0.0

echo.
echo   Open on this PC:        http://localhost:3000
echo   Open on the shop LAN:   http://%LANIP%:3000
echo.

rem ping, not timeout: timeout aborts when stdin is redirected, which is what
rem happens when this file is launched from a tool instead of double-clicked.
ping -n 7 127.0.0.1 >nul
start http://localhost:3000
endlocal
