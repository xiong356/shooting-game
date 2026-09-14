@echo off
setlocal

cd /d "%~dp0"

title King Canyon PvE - Monster Chase

echo ============================================
echo   King Canyon PvE - Monster Chase
echo   Starting game server...
echo   Browser will open automatically.
echo   Close this window to stop the game.
echo ============================================

where node >nul 2>&1
if %errorlevel%==0 (
    node server.js
    goto end
)

where python >nul 2>&1
if %errorlevel%==0 (
    python -m http.server 3000 --bind 127.0.0.1
    goto end
)

echo ERROR: node or python not found. Please install Node.js.
echo Download: https://nodejs.org
pause

:end
endlocal
