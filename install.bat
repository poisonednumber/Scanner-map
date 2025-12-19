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
    echo         Please install Node.js LTS from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Get Node.js version
for /f "tokens=1 delims=." %%i in ('node --version') do set NODE_MAJOR=%%i
set NODE_MAJOR=%NODE_MAJOR:v=%
set /a NODE_MAJOR_NUM=%NODE_MAJOR%

REM Check minimum version
if %NODE_MAJOR_NUM% LSS 18 (
    echo [ERROR] Node.js version 18 or higher is required.
    echo         Current version: 
    node --version
    echo         Please install Node.js LTS from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Warn about very new Node.js versions
if %NODE_MAJOR_NUM% GEQ 23 (
    echo [WARN] Node.js v%NODE_MAJOR_NUM% detected. This is a very new version.
    echo        Some native modules may not have prebuilt binaries yet.
    echo        If you encounter build errors, consider using Node.js LTS ^(v22 or v20^).
    echo.
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
if not exist "node_modules\inquirer" (
    echo [INFO] Installing npm dependencies...
    echo        This may take a few minutes...
    echo.
    
    REM Check if npm is available before trying to use it
    where npm >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [WARN] npm not found in PATH.
        echo        Node.js may have been just installed.
        echo.
        echo [INFO] The installer needs to be restarted for PATH to update.
        echo.
        set /p RESTART="Restart installer now? (Y/n): "
        if /i "%RESTART%"=="" set RESTART=Y
        if /i "%RESTART%"=="Y" (
            echo.
            call :update_and_restart
            exit /b 0
        ) else (
            echo.
            echo Please restart the installer manually after Node.js is available in PATH.
            echo Run: install.bat
            echo.
            pause
            exit /b 1
        )
    )
    
    REM Use --ignore-optional to skip native modules that fail to build
    REM Use --no-audit --no-fund to speed up installation
    npm install --ignore-optional --no-audit --no-fund 2>&1
    set NPM_INSTALL_ERROR=%ERRORLEVEL%
    
    REM Check if critical modules are installed
    if not exist "node_modules\inquirer" (
        echo.
        echo [ERROR] Failed to install npm dependencies.
        echo.
        
        REM Check if npm command itself failed (PATH issue)
        where npm >nul 2>&1
        if %ERRORLEVEL% NEQ 0 (
            echo [WARN] npm not found in PATH.
            echo        Node.js may have been just installed.
            echo.
            echo [INFO] The installer needs to be restarted for PATH to update.
            echo.
            set /p RESTART="Restart installer now? (Y/n): "
            if /i "%RESTART%"=="" set RESTART=Y
            if /i "%RESTART%"=="Y" (
                echo.
                call :update_and_restart
                exit /b 0
            ) else (
                echo.
                echo Please restart the installer manually after Node.js is available in PATH.
                echo Run: install.bat
                echo.
                pause
                exit /b 1
            )
        ) else (
            echo Common fixes:
            echo   1. Delete node_modules folder and try again
            echo   2. Run: npm cache clean --force
            echo   3. Check your internet connection
            echo   4. If using Node.js v23+, try Node.js v22 LTS instead
            echo.
            pause
            exit /b 1
        )
    )
    
    echo.
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
goto :eof

:update_and_restart
REM Check if we're in a git repository
git rev-parse --git-dir >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Checking for project updates...
    
    REM Fetch latest changes without merging
    git fetch origin >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        REM Check if there are updates available
        git diff HEAD origin/HEAD --quiet >nul 2>&1
        if %ERRORLEVEL% NEQ 0 (
            echo [INFO] Updates available. Pulling latest changes...
            
            REM Store the commit before pull to check what changed
            for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set BEFORE_PULL=%%i
            
            git pull origin
            if %ERRORLEVEL% EQU 0 (
                echo [OK] Project updated successfully
                
                REM Check if package.json changed in the pull (need to rebuild dependencies)
                if defined BEFORE_PULL (
                    git diff %BEFORE_PULL% HEAD --name-only | findstr /C:"package.json" >nul 2>&1
                    if %ERRORLEVEL% EQU 0 (
                        echo [INFO] package.json changed. Rebuilding dependencies...
                        if exist "node_modules" (
                            rmdir /s /q "node_modules" 2>nul
                        )
                        npm install --ignore-optional --no-audit --no-fund
                        if %ERRORLEVEL% EQU 0 (
                            echo [OK] Dependencies rebuilt successfully
                        ) else (
                            echo [WARN] Dependency rebuild had issues, but continuing...
                        )
                    )
                )
            ) else (
                echo [WARN] Failed to pull updates, but continuing with restart...
            )
        ) else (
            echo [INFO] Project is up to date
        )
    ) else (
        echo [WARN] Could not check for updates (not a git repo or no network)
    )
) else (
    echo [INFO] Not a git repository, skipping update check
)

echo.
echo [INFO] Waiting 3 seconds for PATH to update...
timeout /t 3 /nobreak >nul
echo [INFO] Restarting installer...
echo.
call "%~f0"
exit /b 0
