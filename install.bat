@echo off
REM Scanner Map - Windows Installer
REM Run this script from the repository root or from a parent directory

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   Scanner Map - Windows Installer
echo ========================================
echo.

REM Check for Git
where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Git is not installed or not in PATH.
    echo         Please install Git from: https://git-scm.com/downloads
    echo.
    pause
    exit /b 1
)
echo [OK] Git found

REM Check for Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check Node.js version (require v18+)
for /f "tokens=2 delims=v." %%i in ('node --version') do set NODE_MAJOR=%%i

REM Convert to number and compare
set /a NODE_MAJOR_NUM=%NODE_MAJOR%
if %NODE_MAJOR_NUM% LSS 18 (
    echo [ERROR] Node.js version 18 or higher is required.
    echo         Current version: 
    node --version
    echo         Please update Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js %NODE_VERSION%

REM Check for npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not installed or not in PATH.
    echo         npm should come with Node.js. Please reinstall Node.js.
    echo.
    pause
    exit /b 1
)
echo [OK] npm found

REM Determine if we're in the Scanner Map repository
if exist "package.json" (
    if exist "scripts\installer\installer-core.js" (
        echo [OK] Running from Scanner Map repository
        goto :install
    )
)

REM Check if Scanner-map subdirectory exists
if exist "Scanner-map\package.json" (
    echo [OK] Found Scanner-map directory
    cd Scanner-map
    goto :install
)

REM Repository not found - provide instructions
echo.
echo [ERROR] Scanner Map repository not found.
echo.
echo To install Scanner Map, you have two options:
echo.
echo   Option 1: Clone the repository first
echo     git clone https://github.com/poisonednumber/Scanner-map.git
echo     cd Scanner-map
echo     install.bat
echo.
echo   Option 2: Run this script from within the cloned repository
echo.
pause
exit /b 1

:install
echo.
echo ========================================
echo   Installing Dependencies
echo ========================================
echo.

REM Install npm dependencies if needed
if not exist "node_modules" (
    echo [INFO] Installing npm dependencies...
    call npm install --no-audit --no-fund
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [ERROR] Failed to install npm dependencies.
        echo         Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed successfully
) else (
    echo [OK] Dependencies already installed
)

echo.
echo ========================================
echo   Starting Interactive Setup
echo ========================================
echo.
echo The installer will guide you through configuration...
echo.

node scripts\installer\installer-core.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Setup failed. Check the error messages above.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Setup Complete!
echo ========================================
echo.
pause

