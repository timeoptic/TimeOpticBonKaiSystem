@echo off
REM BonKai API :8099 in a loop — php -S sometimes exits silently after a few hours
set PHP=%LOCALAPPDATA%\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe
cd /d %~dp0
:loop
"%PHP%" -S 0.0.0.0:8099 -t api api\router.php
timeout /t 2 >nul
goto loop
