@echo off
REM TimeOptic — React dev server on http://localhost:5173
REM Start start-api.bat first; this proxies /api to it.
cd /d "%~dp0frontend"

if not exist node_modules (
  echo   Installing dependencies...
  call npm install
)

start "" http://localhost:5173
call npm run dev
pause
