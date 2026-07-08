@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO=D:\Project\Texas_Poker_App"
set "REMOTE=git@github.com:Yezeqi/Texas_Poker_App.git"
set "BRANCH=main"

cd /d "%REPO%" || (
  echo Project folder not found: %REPO%
  pause
  exit /b 1
)

git --version >nul 2>nul || (
  echo Git was not found. Please install Git for Windows first.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul || (
  echo This folder is not a Git repository: %REPO%
  pause
  exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REMOTE%"
) else (
  git remote set-url origin "%REMOTE%"
)

git branch -M "%BRANCH%" >nul 2>nul

echo.
echo ==========================================
echo HomeGame - One-click push to GitHub
echo Project: %REPO%
echo Remote : %REMOTE%
echo Branch : %BRANCH%
echo ==========================================
echo.

git fetch origin "%BRANCH%" >nul 2>nul
if errorlevel 1 (
  echo Could not fetch GitHub status. Check network or SSH key.
  pause
  exit /b 1
)

git rev-parse --verify HEAD >nul 2>nul
if errorlevel 1 (
  echo No local commit exists. Please pull/clone the GitHub project first.
  pause
  exit /b 1
)

for /f %%i in ('git rev-list --count HEAD..origin/%BRANCH% 2^>nul') do set "BEHIND=%%i"
if not "%BEHIND%"=="0" (
  echo GitHub has %BEHIND% newer commit(s).
  echo Run the pull script first, then push again.
  pause
  exit /b 1
)

echo Current changes:
git status --short
echo.

git add -A

rem These files are often rewritten by Capacitor or line endings during local builds.
rem Remove the next 3 lines if you intentionally want to commit them.
git restore --staged -- android/app/capacitor.build.gradle >nul 2>nul
git restore --staged -- android/capacitor.settings.gradle >nul 2>nul
git restore --staged -- public/vendor/socket.io.min.js >nul 2>nul

git diff --cached --quiet
if not errorlevel 1 (
  echo No commit-worthy changes found.
  echo Pushing current branch anyway...
  git push -u origin "%BRANCH%"
  if errorlevel 1 goto fail
  echo.
  echo Push finished successfully.
  pause
  exit /b 0
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "STAMP=%%i"
set "COMMIT_MSG=sync update %STAMP%"

echo Commit message: %COMMIT_MSG%
git commit -m "%COMMIT_MSG%"
if errorlevel 1 goto fail

git push -u origin "%BRANCH%"
if errorlevel 1 goto fail

echo.
echo Push finished successfully.
git status --short --branch
pause
exit /b 0

:fail
echo.
echo Push failed.
echo If GitHub has newer changes, run the pull script first.
git status --short --branch
pause
exit /b 1
