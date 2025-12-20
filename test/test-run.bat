@echo off
setlocal enabledelayedexpansion
REM ============================================
REM Scanner Map Test Runner
REM Cleans up runtime files and runs the app
REM ============================================

echo.
echo ========================================
echo Scanner Map Test Runner
echo ========================================
echo.

REM Show menu
:MENU
echo Please select an option:
echo.
echo   1. Run with Docker (Dockerized environment)
echo   2. Run locally (Direct Node.js execution)
echo.
set /p choice="Enter your choice (1 or 2): "

if "%choice%"=="1" goto DOCKER
if "%choice%"=="2" goto LOCAL
echo.
echo Invalid choice. Please enter 1 or 2.
echo.
goto MENU

:DOCKER
echo.
echo ========================================
echo Selected: Docker Environment
echo ========================================
echo.

REM Check if Docker is available
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not installed or not in PATH
    echo Please install Docker and try again.
    pause
    exit /b 1
)

REM Check if docker-compose.yml exists
if not exist "docker-compose.yml" (
    echo ERROR: docker-compose.yml not found
    echo Please run this script from the Scanner Map project root directory.
    pause
    exit /b 1
)

REM Clean up runtime directories
echo [1/6] Cleaning up runtime directories...
if exist "data" (
    echo   Removing data directory...
    rmdir /s /q "data" 2>nul
    if not exist "data" mkdir "data"
    if exist "data\.gitkeep" (
        echo .gitkeep > "data\.gitkeep"
    )
)

if exist "audio" (
    echo   Removing audio directory...
    rmdir /s /q "audio" 2>nul
)

if exist "logs" (
    echo   Removing logs directory...
    rmdir /s /q "logs" 2>nul
)

if exist "recordings" (
    echo   Removing recordings directory...
    rmdir /s /q "recordings" 2>nul
)

if exist "appdata" (
    echo   Removing appdata directory...
    rmdir /s /q "appdata" 2>nul
)

if exist "docker-data" (
    echo   Removing docker-data directory...
    rmdir /s /q "docker-data" 2>nul
)

REM Clean up database files
echo [2/6] Cleaning up database files...
del /q "*.db" 2>nul
del /q "*.sqlite" 2>nul
del /q "*.sqlite3" 2>nul
del /q "data\*.db" 2>nul
del /q "data\*.sqlite" 2>nul
del /q "data\*.sqlite3" 2>nul

REM Clean up log files
echo [3/6] Cleaning up log files...
del /q "*.log" 2>nul
del /q "combined.log" 2>nul
del /q "error.log" 2>nul
del /q "logs\*.log" 2>nul

REM Clean up API keys file
echo [4/6] Cleaning up API keys...
if exist "apikeys.json" (
    echo   Removing apikeys.json...
    del /q "apikeys.json" 2>nul
)

REM Clean up temporary files
echo [5/6] Cleaning up temporary files...
del /q "*.tmp" 2>nul
del /q "*.temp" 2>nul
del /q "*.bak" 2>nul
del /q "*.backup" 2>nul

REM Optional: Clean up .env file (uncomment if you want fresh .env each run)
REM echo [6/7] Cleaning up .env file...
REM if exist ".env" (
REM     echo   Removing .env file...
REM     del /q ".env" 2>nul
REM )

echo [6/6] Cleanup complete!
echo.

REM Stop any running Docker containers
echo [7/7] Stopping existing Docker containers...
docker-compose down >nul 2>&1
docker compose down >nul 2>&1

echo.
echo ========================================
echo Starting Scanner Map with Docker...
echo ========================================
echo.

REM Determine which docker compose command to use
set DOCKER_COMPOSE_CMD=
docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    set DOCKER_COMPOSE_CMD=docker compose
) else (
    where docker-compose >nul 2>&1
    if %errorlevel% equ 0 (
        set DOCKER_COMPOSE_CMD=docker-compose
    ) else (
        echo ERROR: Neither 'docker compose' nor 'docker-compose' is available
        pause
        exit /b 1
    )
)

echo Using: %DOCKER_COMPOSE_CMD%
echo Starting services in background...
echo.

REM Start services in detached mode
%DOCKER_COMPOSE_CMD% up -d --build
if %errorlevel% neq 0 (
    echo ERROR: Failed to start Docker services
    pause
    exit /b 1
)

REM Wait a moment for services to start
timeout /t 3 /nobreak >nul

REM Get webserver port from .env or use default
set WEBSERVER_PORT=3001
if exist ".env" (
    for /f "tokens=2 delims==" %%a in ('findstr /I "WEBSERVER_PORT" .env 2^>nul') do (
        set WEBSERVER_PORT=%%a
        REM Remove any quotes
        set WEBSERVER_PORT=!WEBSERVER_PORT:"=!
        REM Remove any whitespace
        for /f "tokens=*" %%b in ("!WEBSERVER_PORT!") do set WEBSERVER_PORT=%%b
    )
)

echo.
echo ========================================
echo Services started. Waiting for webserver...
echo ========================================
echo.

REM Wait for webserver to be ready (check if port is responding)
set WEBSERVER_READY=0
for /L %%i in (1,1,30) do (
    timeout /t 2 /nobreak >nul
    powershell -Command "$port = %WEBSERVER_PORT%; try { $response = Invoke-WebRequest -Uri \"http://localhost:$port\" -TimeoutSec 2 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
    if !errorlevel! equ 0 (
        set WEBSERVER_READY=1
        goto WEBSERVER_READY
    )
    echo   Waiting for webserver... (attempt %%i/30)
)

:WEBSERVER_READY
if %WEBSERVER_READY% equ 1 (
    echo Webserver is ready!
    echo Opening Setup Wizard in browser...
    start http://localhost:%WEBSERVER_PORT%/?setup-wizard=1
    timeout /t 1 /nobreak >nul
) else (
    echo WARNING: Webserver may not be ready yet. Opening browser anyway...
    start http://localhost:%WEBSERVER_PORT%/?setup-wizard=1
)

echo.
echo ========================================
echo Showing logs...
echo ========================================
echo.
echo Press ENTER to stop services and cleanup
echo.
echo [Logs from all services - Ctrl+C to stop viewing logs]
echo.

REM Show logs from all services in a separate window, then wait for Enter
start "Scanner Map Logs" cmd /k "%DOCKER_COMPOSE_CMD% logs -f"

REM Start test event generator in background
echo Starting test event generator...
start "Test Event Generator" cmd /k "node scripts\test-event-generator.js"

REM Start live reload watcher
echo Starting live reload watcher...
start "Live Reload" powershell -ExecutionPolicy Bypass -File "scripts\live-reload.ps1" -Mode "docker" -WebserverPort %WEBSERVER_PORT% -DockerComposeCmd "%DOCKER_COMPOSE_CMD%"

echo.
echo ========================================
echo Live Reload Enabled
echo ========================================
echo Changes to files will automatically restart services and refresh the browser.
echo.

REM Wait for user to press Enter
set /p cleanup="Press ENTER to stop services and cleanup: "

echo.
echo Stopping Docker services...
%DOCKER_COMPOSE_CMD% down

REM Close the logs window, test event generator, and live reload
taskkill /FI "WindowTitle eq Scanner Map Logs*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Test Event Generator*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Live Reload*" /T /F >nul 2>&1

echo Services stopped.
goto CLEANUP_AFTER

:LOCAL
echo.
echo ========================================
echo Selected: Local Execution
echo ========================================
echo.

REM Clean up runtime directories
echo [1/6] Cleaning up runtime directories...
if exist "data" (
    echo   Removing data directory...
    rmdir /s /q "data" 2>nul
    if not exist "data" mkdir "data"
    if exist "data\.gitkeep" (
        echo .gitkeep > "data\.gitkeep"
    )
)

if exist "audio" (
    echo   Removing audio directory...
    rmdir /s /q "audio" 2>nul
)

if exist "logs" (
    echo   Removing logs directory...
    rmdir /s /q "logs" 2>nul
)

if exist "recordings" (
    echo   Removing recordings directory...
    rmdir /s /q "recordings" 2>nul
)

if exist "appdata" (
    echo   Removing appdata directory...
    rmdir /s /q "appdata" 2>nul
)

if exist "docker-data" (
    echo   Removing docker-data directory...
    rmdir /s /q "docker-data" 2>nul
)

REM Clean up database files
echo [2/6] Cleaning up database files...
del /q "*.db" 2>nul
del /q "*.sqlite" 2>nul
del /q "*.sqlite3" 2>nul
del /q "data\*.db" 2>nul
del /q "data\*.sqlite" 2>nul
del /q "data\*.sqlite3" 2>nul

REM Clean up log files
echo [3/6] Cleaning up log files...
del /q "*.log" 2>nul
del /q "combined.log" 2>nul
del /q "error.log" 2>nul
del /q "logs\*.log" 2>nul

REM Clean up API keys file
echo [4/6] Cleaning up API keys...
if exist "apikeys.json" (
    echo   Removing apikeys.json...
    del /q "apikeys.json" 2>nul
)

REM Clean up temporary files
echo [5/6] Cleaning up temporary files...
del /q "*.tmp" 2>nul
del /q "*.temp" 2>nul
del /q "*.bak" 2>nul
del /q "*.backup" 2>nul

echo [6/6] Cleanup complete!
echo.

REM Check if Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js and try again.
    pause
    exit /b 1
)

REM Check if bot.js exists
if not exist "bot.js" (
    echo ERROR: bot.js not found
    echo Please run this script from the Scanner Map project root directory.
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo WARNING: node_modules not found
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

echo ========================================
echo Starting Scanner Map locally...
echo ========================================
echo.

REM Start the application in a separate window
echo Starting application in background...
start "Scanner Map" cmd /k "node bot.js"

REM Wait a moment for the app to start and create log files
timeout /t 3 /nobreak >nul

REM Check if logs directory exists, if not create it
if not exist "logs" mkdir "logs"

REM Get webserver port from .env or use default
set WEBSERVER_PORT=3001
if exist ".env" (
    for /f "tokens=2 delims==" %%a in ('findstr /I "WEBSERVER_PORT" .env 2^>nul') do (
        set WEBSERVER_PORT=%%a
        REM Remove any quotes
        set WEBSERVER_PORT=!WEBSERVER_PORT:"=!
        REM Remove any whitespace
        for /f "tokens=*" %%b in ("!WEBSERVER_PORT!") do set WEBSERVER_PORT=%%b
    )
)

echo.
echo ========================================
echo Application started. Waiting for webserver...
echo ========================================
echo.

REM Wait for webserver to be ready (check if port is responding)
set WEBSERVER_READY=0
for /L %%i in (1,1,30) do (
    timeout /t 2 /nobreak >nul
    powershell -Command "$port = %WEBSERVER_PORT%; try { $response = Invoke-WebRequest -Uri \"http://localhost:$port\" -TimeoutSec 2 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
    if !errorlevel! equ 0 (
        set WEBSERVER_READY=1
        goto WEBSERVER_READY_LOCAL
    )
    echo   Waiting for webserver... (attempt %%i/30)
)

:WEBSERVER_READY_LOCAL
if %WEBSERVER_READY% equ 1 (
    echo Webserver is ready!
    echo Opening Setup Wizard in browser...
    start http://localhost:%WEBSERVER_PORT%/?setup-wizard=1
    timeout /t 1 /nobreak >nul
) else (
    echo WARNING: Webserver may not be ready yet. Opening browser anyway...
    start http://localhost:%WEBSERVER_PORT%/?setup-wizard=1
)

echo.
echo ========================================
echo Showing logs...
echo ========================================
echo.
echo Application is running in the 'Scanner Map' window.
echo.

REM Try to show logs in a separate window if log file exists
set LOG_WINDOW_STARTED=0
if exist "logs\combined.log" (
    echo Opening log viewer...
    start "Scanner Map Logs" cmd /k "powershell -Command Get-Content logs\combined.log -Wait -Tail 50"
    set LOG_WINDOW_STARTED=1
) else (
    REM Wait a bit more and try again
    timeout /t 2 /nobreak >nul
    if exist "logs\combined.log" (
        echo Opening log viewer...
        start "Scanner Map Logs" cmd /k "powershell -Command Get-Content logs\combined.log -Wait -Tail 50"
        set LOG_WINDOW_STARTED=1
    ) else (
        echo Note: Log file not found yet. Check the 'Scanner Map' window for output.
    )
)

REM Also check for error.log
if exist "logs\error.log" (
    if %LOG_WINDOW_STARTED%==0 (
        start "Scanner Map Error Logs" cmd /k "powershell -Command Get-Content logs\error.log -Wait -Tail 50"
    )
)

echo.
echo Press ENTER to stop application and cleanup
echo.

REM Start test event generator in background
echo Starting test event generator...
start "Test Event Generator" cmd /k "node scripts\test-event-generator.js"

REM Start live reload watcher
echo Starting live reload watcher...
start "Live Reload" powershell -ExecutionPolicy Bypass -File "scripts\live-reload.ps1" -Mode "local" -WebserverPort %WEBSERVER_PORT%

echo.
echo ========================================
echo Live Reload Enabled
echo ========================================
echo Changes to files will automatically restart the application and refresh the browser.
echo.

REM Wait for user to press Enter
set /p cleanup="Press ENTER to stop application and cleanup: "

echo.
echo Stopping application...

REM Close windows by title
taskkill /FI "WindowTitle eq Scanner Map*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Scanner Map Logs*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Scanner Map Error Logs*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Test Event Generator*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Live Reload*" /T /F >nul 2>&1

REM Also try to find node.exe processes that might be running bot.js
REM Use wmic to find processes with bot.js in command line
for /f "tokens=2 delims==" %%a in ('wmic process where "name='node.exe'" get ProcessId /format:list 2^>nul ^| findstr "ProcessId"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | findstr /I "bot.js" >nul
    if not errorlevel 1 (
        taskkill /PID %%a /T /F >nul 2>&1
    )
)

echo Application stopped.

:CLEANUP_AFTER
echo.
echo ========================================
echo Performing final cleanup...
echo ========================================
echo.

REM Clean up runtime directories
echo Cleaning up runtime directories...
if exist "data" (
    rmdir /s /q "data" 2>nul
    if not exist "data" mkdir "data"
    if exist "data\.gitkeep" (
        echo .gitkeep > "data\.gitkeep"
    )
)

if exist "audio" (
    rmdir /s /q "audio" 2>nul
)

if exist "logs" (
    rmdir /s /q "logs" 2>nul
)

if exist "recordings" (
    rmdir /s /q "recordings" 2>nul
)

if exist "appdata" (
    rmdir /s /q "appdata" 2>nul
)

if exist "docker-data" (
    rmdir /s /q "docker-data" 2>nul
)

REM Clean up database files
echo Cleaning up database files...
del /q "*.db" 2>nul
del /q "*.sqlite" 2>nul
del /q "*.sqlite3" 2>nul
del /q "data\*.db" 2>nul
del /q "data\*.sqlite" 2>nul
del /q "data\*.sqlite3" 2>nul

REM Clean up log files
echo Cleaning up log files...
del /q "*.log" 2>nul
del /q "combined.log" 2>nul
del /q "error.log" 2>nul
del /q "logs\*.log" 2>nul

REM Clean up API keys file
echo Cleaning up API keys...
if exist "apikeys.json" (
    del /q "apikeys.json" 2>nul
)

REM Clean up temporary files
echo Cleaning up temporary files...
del /q "*.tmp" 2>nul
del /q "*.temp" 2>nul
del /q "*.bak" 2>nul
del /q "*.backup" 2>nul

echo.
echo ========================================
echo Cleanup complete!
echo ========================================
echo.

:END

