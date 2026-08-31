@echo off
REM TimeOptic web (Next.js dev) on :3000 - restarts itself if the process dies.
REM Close this window to stop it. Log: web-forever.log
title TimeOptic Web 3000
set "LOG=%~dp0web-forever.log"
cd /d "%~dp0frontend-next"

:loop
echo [%date% %time%] starting Next dev on 0.0.0.0:3000 >> "%LOG%"
call npm run dev -- -H 0.0.0.0 >> "%LOG%" 2>&1
echo [%date% %time%] web exited - restarting in 3s >> "%LOG%"
ping -n 4 127.0.0.1 >nul
goto loop
