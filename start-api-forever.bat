@echo off
REM TimeOptic API on :8082 - restarts itself if the process dies.
REM Close this window to stop it. Log: api-forever.log
REM (ASCII only on purpose: .bat is read in the OEM codepage, not UTF-8)
title TimeOptic API 8082
cd /d "%~dp0"
set "PHPEXE=C:\xampp\php\php.exe"
set "LOG=%~dp0api-forever.log"

if not exist "%PHPEXE%" (
  echo [%date% %time%] php not found at %PHPEXE% >> "%LOG%"
  exit /b 1
)

:loop
echo [%date% %time%] starting API on 0.0.0.0:8082 >> "%LOG%"
"%PHPEXE%" -S 0.0.0.0:8082 -t api api\router.php >> "%LOG%" 2>&1
echo [%date% %time%] API exited - restarting in 3s >> "%LOG%"
ping -n 4 127.0.0.1 >nul
goto loop
