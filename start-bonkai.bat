@echo off
REM BonKai local: web http://localhost:3050  ·  API :8099  ·  DB bonkai
REM Separate ports from Bewell (3030/8097) and TimeOptic (3010/8095) so all can run at the same time
start "BonKai API :8099" cmd /k call "%~dp0api-forever-8099.bat"
start "BonKai web :3050" /d "%~dp0frontend-next" cmd /k npm run dev -- -p 3050 --hostname 0.0.0.0
echo BonKai: http://localhost:3050