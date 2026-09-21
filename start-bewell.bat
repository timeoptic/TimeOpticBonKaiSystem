@echo off
REM Bewell local: web http://localhost:3020  ·  API :8096  ·  DB bewell
REM Separate ports from TimeOptic (3010/8095) so both can run at the same time
start "Bewell API :8096" cmd /k call "%~dp0api-forever-8096.bat"
start "Bewell web :3020" /d "%~dp0frontend-next" cmd /k npm run dev -- -p 3020 --hostname 0.0.0.0
echo Bewell: http://localhost:3020
