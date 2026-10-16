@echo off
rem Double-click to start Speck on Windows.
rem It updates Speck from GitHub, installs what's needed, then starts it in the background.
title Speck
cd /d "%~dp0"

rem 1. Update from GitHub
where git >nul 2>nul
if errorlevel 1 goto node
if not exist ".git" goto node
echo   Checking for updates...
git pull --ff-only --quiet 2>nul
if errorlevel 1 echo   Couldn't update right now. Starting the current version.

:node
rem 2. Node.js
where node >nul 2>nul
if not errorlevel 1 goto run
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

:run
rem 3. Everything else (dependencies, Ollama, model, launch)
node scripts\start.js
if errorlevel 1 (
  pause
  exit /b 1
)
exit /b 0
