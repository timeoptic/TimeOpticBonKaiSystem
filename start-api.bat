@echo off
REM TimeOptic — PHP REST API on http://127.0.0.1:8080
REM Needs XAMPP's MySQL running (XAMPP Control Panel -> MySQL -> Start).
cd /d "%~dp0"

set PHP=C:\xampp\php\php.exe
if not exist "%PHP%" (
  echo.
  echo   X hai mai phop PHP thi %PHP%
  echo     kae path PHP nai fai ni, rue tid tang XAMPP
  echo.
  pause
  exit /b 1
)

REM connection check + create the queue-booking tables if they are missing
"%PHP%" api\cli\serve.php
if errorlevel 1 (
  pause
  exit /b 1
)

echo   API  http://127.0.0.1:8080
echo   (Ctrl+C to stop)
echo.
"%PHP%" -S 127.0.0.1:8080 -t api api\router.php
pause
