@echo off
setlocal
cd /d "%~dp0"

set "BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do set "PORT_PID=%%P"
if defined PORT_PID (
  echo Port 3000 is already in use by process %PORT_PID%.
  echo The poker server may already be running.
  echo Open http://localhost:3000 in your browser, or close the old server window and try again.
  exit /b 1
)

if exist "%BUNDLED_NODE%" (
  "%BUNDLED_NODE%" server.js
  exit /b %ERRORLEVEL%
)

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  node server.js
  exit /b %ERRORLEVEL%
)

echo Cannot find Node.js.
echo Please install Node.js LTS from https://nodejs.org/ and run this file again.
exit /b 1
