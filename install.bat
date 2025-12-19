@echo off
REM Scanner Map - Unified Installer Script (Windows)
REM Works whether run from inside or outside the repository

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   Scanner Map - Windows Installer
echo ========================================
echo.

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

REM Check if we're already in the Scanner Map repository
if exist "package.json" (
    if exist "scripts\installer\installer-core.js" (
        echo [OK] Already in Scanner Map repository
        goto :install
    )
)

REM Check if Scanner-map subdirectory exists
if exist "Scanner-map\package.json" (
    echo [OK] Found Scanner-map directory
    cd Scanner-map
    goto :install
)

REM If we get here, we need to clone the repository
echo [INFO] Scanner Map repository not found
echo [INFO] This script requires the Scanner Map repository to be cloned
echo.
echo You can either:
echo   1. Clone the repo first: git clone https://github.com/poisonednumber/Scanner-map.git
echo   2. Run this script from within the cloned repository
echo   3. Or use the full installer that clones automatically
echo.
pause
exit /b 1

:install
echo.
echo ========================================
echo   Installing Dependencies
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo [INFO] Installing npm dependencies...
    call npm install --no-audit --no-fund
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install npm dependencies
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
) else (
    echo [OK] Dependencies already installed
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
