@echo off
setlocal
cd /d "%~dp0"

if "%JAVA_HOME%"=="" if exist "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\java.exe" (
  set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
)

if "%ANDROID_HOME%"=="" if exist "D:\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" (
  set "ANDROID_HOME=D:\Android\Sdk"
)

if "%ANDROID_SDK_ROOT%"=="" if defined ANDROID_HOME (
  set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
)

if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"
if defined ANDROID_HOME set "PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"

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
