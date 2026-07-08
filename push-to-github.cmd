@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HomeGame - Push to GitHub
color 0A

set "REPO=D:\Project\Texas_Poker_App"
set "REMOTE=git@github.com:Yezeqi/Texas_Poker_App.git"
set "BRANCH=main"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "STAMP=%%i"
set "LOG=%USERPROFILE%\Desktop\HomeGame_push_%STAMP%.log"

call :main > "%LOG%" 2>&1
set "RESULT=%ERRORLEVEL%"

type "%LOG%"
echo.
echo ==========================================
if "%RESULT%"=="0" (
  echo [SUCCESS] Push to GitHub finished.
  echo Log file: %LOG%
) else (
  echo [FAILED] Push was not completed. Read the message above.
  echo Log file: %LOG%
)
echo ==========================================
echo.
echo Press any key to close this window...
pause >nul
exit /b %RESULT%

:main
echo ==========================================
echo HomeGame one-click GitHub push
echo Time   : %DATE% %TIME%
echo Project: %REPO%
echo Remote : %REMOTE%
echo Branch : %BRANCH%
echo Log    : %LOG%
echo ==========================================
echo.

cd /d "%REPO%" || (
  echo [ERROR] Project folder not found: %REPO%
  exit /b 1
)

git --version || (
  echo [ERROR] Git was not found. Please install Git for Windows first.
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul || (
  echo [ERROR] This folder is not a Git repository: %REPO%
  exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo [INFO] origin remote not found. Adding GitHub remote...
  git remote add origin "%REMOTE%" || exit /b 1
) else (
  git remote set-url origin "%REMOTE%" || exit /b 1
)

git branch -M "%BRANCH%" >nul 2>nul

echo [1/5] Checking GitHub for newer commits...
git fetch origin "%BRANCH%"
if errorlevel 1 (
  echo [ERROR] Could not connect to GitHub. Check network or SSH key.
  exit /b 1
)

git rev-parse --verify HEAD >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No local commit exists. Pull or clone the GitHub project first.
  exit /b 1
)

set "BEHIND=0"
for /f %%i in ('git rev-list --count HEAD..origin/%BRANCH% 2^>nul') do set "BEHIND=%%i"
if not "!BEHIND!"=="0" (
  echo [STOPPED] GitHub has !BEHIND! newer commits.
  echo Run the pull script first, resolve conflicts if any, then push again.
  exit /b 1
)

echo.
echo [2/5] Current local changes:
git status --short
echo.

echo [3/5] Staging changes...
git add -A

rem These files are often changed by local Capacitor builds or line endings.
rem They are skipped by default to avoid noisy cross-computer sync.
git restore --staged -- android/app/capacitor.build.gradle >nul 2>nul
git restore --staged -- android/capacitor.settings.gradle >nul 2>nul
git restore --staged -- public/vendor/socket.io.min.js >nul 2>nul

git diff --cached --quiet
if not errorlevel 1 (
  echo [INFO] No commit-worthy changes found.
  echo [4/5] Commit skipped.
  echo [5/5] Pushing current branch anyway...
  git push -u origin "%BRANCH%"
  if errorlevel 1 exit /b 1
  echo.
  echo [DONE] GitHub is already up to date.
  git status --short --branch
  exit /b 0
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "COMMIT_STAMP=%%i"
set "COMMIT_MSG=sync update %COMMIT_STAMP%"

echo [4/5] Committing:
echo !COMMIT_MSG!
git commit -m "!COMMIT_MSG!"
if errorlevel 1 exit /b 1

echo.
echo [5/5] Pushing to GitHub...
git push -u origin "%BRANCH%"
if errorlevel 1 exit /b 1

echo.
echo [DONE] Push finished successfully.
git status --short --branch
exit /b 0
