@echo off
REM Scanner Map - Unified Installer Script (Windows)
REM Uses Node.js-based installer for cross-platform compatibility

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   Scanner Map - Windows Installer
echo ========================================
echo.

REM Check for Git
where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Git is not installed or not in PATH
    echo Please install Git from: https://git-scm.com/downloads
    pause
    exit /b 1
)

REM Check for Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo Please install Node.js from: https://nodejs.org/
    pause
    exit /b 1
)

REM Check for npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not installed or not in PATH
    echo npm should come with Node.js. Please reinstall Node.js.
    pause
    exit /b 1
)

REM Check Node.js version
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [INFO] Node.js version: !NODE_VERSION!
echo [OK] All prerequisites found
echo.

REM Clone repository if needed
if exist "Scanner-map" (
    echo Scanner-map directory already exists
    set /p OVERWRITE="Remove and clone fresh? (y/N): "
    if /i "!OVERWRITE!"=="y" (
        rmdir /s /q Scanner-map
    ) else (
        cd Scanner-map
        goto :install
    )
)

echo Cloning Scanner Map repository...
git clone https://github.com/poisonednumber/Scanner-map.git
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to clone repository
    pause
    exit /b 1
)

cd Scanner-map

:install
echo.
echo ========================================
echo   Installing Dependencies
echo ========================================
echo.

echo [INFO] Installing npm dependencies...
call npm install --no-audit --no-fund
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install npm dependencies
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Starting Interactive Installer
echo ========================================
echo.
echo [INFO] The installer will guide you through configuration...
echo.

node scripts\installer\installer-core.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Installation failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
pause
