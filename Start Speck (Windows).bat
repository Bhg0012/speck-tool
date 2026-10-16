@echo off
rem Double-click to start Speck on Windows.
rem Updates Speck to the latest version on GitHub, installs what's needed, then starts it.
rem All the logic is in scripts\start.js (shared with Mac). The node line also exits on the
rem same line, so an update that replaces this file while it runs can't confuse Windows.
title Speck
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode
node scripts\start.js %* & exit /b

:nonode
echo   Speck needs Node.js (free).
where winget >nul 2>nul
if errorlevel 1 goto manualnode
echo   Installing it with winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo   Node.js installed. Close this window and double-click "Start Speck (Windows)" again.
pause
exit /b 0

:manualnode
echo   Download the LTS installer from https://nodejs.org, install it, then run this again.
start "" "https://nodejs.org/en/download"
pause
exit /b 1
