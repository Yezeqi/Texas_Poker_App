@echo off
setlocal
cd /d "%~dp0"

set "BUNDLED_NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "BUNDLED_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"

if exist "%BUNDLED_NODE_DIR%\node.exe" set "PATH=%BUNDLED_NODE_DIR%;%PATH%"

if not exist "%BUNDLED_PNPM%" (
  echo Cannot find bundled pnpm.
  echo Install Node.js LTS, then run: corepack enable
  exit /b 1
)

"%BUNDLED_NODE_DIR%\node.exe" scripts\prepare_mobile.mjs
"%BUNDLED_PNPM%" exec cap sync android
