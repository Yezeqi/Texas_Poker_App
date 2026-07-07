@echo off
setlocal
cd /d "%~dp0"

where java >nul 2>nul
if not %ERRORLEVEL% EQU 0 (
  echo Java was not found.
  echo Install Android Studio first, then open a new terminal and run this file again.
  exit /b 1
)

if "%ANDROID_HOME%"=="" if "%ANDROID_SDK_ROOT%"=="" (
  echo Android SDK environment variables were not found.
  echo Install Android Studio and the Android SDK, then open a new terminal and run this file again.
  exit /b 1
)

call sync-android.cmd
if not %ERRORLEVEL% EQU 0 exit /b %ERRORLEVEL%

cd android
call gradlew.bat assembleDebug
if not %ERRORLEVEL% EQU 0 exit /b %ERRORLEVEL%

echo.
echo APK created:
echo %CD%\app\build\outputs\apk\debug\app-debug.apk
