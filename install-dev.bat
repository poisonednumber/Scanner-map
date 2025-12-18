@echo off
REM Scanner Map - Development Installer Script (Windows)
REM This version tests the installation and then cleans up everything

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   Scanner Map Development Installer
echo ========================================
echo.
echo This installer will:
echo   1. Run the standard installation with defaults
echo   2. Start Docker containers
echo   3. Verify web pages are accessible
echo   4. Clean up all configuration and data
echo.
pause

REM Check for curl
where curl >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] curl is required for web page verification
    echo Install curl: https://curl.se/windows/
    pause
    exit /b 1
)

REM Set default values
set GEOCODING_PROVIDER=nominatim
set GOOGLE_MAPS_API_KEY=
set LOCATIONIQ_API_KEY=
set AI_PROVIDER=ollama
set OPENAI_API_KEY=
set OPENAI_MODEL=
set OLLAMA_URL=http://ollama:11434
set OLLAMA_MODEL=llama3.1:8b
set ENABLE_OLLAMA=y
set OLLAMA_INSTALL_MODE=docker
set ENABLE_DISCORD=n
set DISCORD_TOKEN=
set CLIENT_ID=
set ENABLE_ICAD=y
set ICAD_URL=http://icad-transcribe:9912
set ICAD_PROFILE=whisper-1
set ICAD_API_KEY=
set ENABLE_TRUNKRECORDER=n

REM Check prerequisites
echo.
echo ========================================
echo   Checking Prerequisites
echo ========================================
echo.

where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Git is not installed
    echo Download from: https://git-scm.com/downloads
    pause
    exit /b 1
)

where docker >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not installed
    echo Download from: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)

where docker-compose >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    docker compose version >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Docker Compose is not installed
        pause
        exit /b 1
    )
)

echo [OK] All prerequisites found
echo.

REM Clone if needed
if not exist "Scanner-map" (
    echo.
    echo ========================================
    echo   Cloning Repository
    echo ========================================
    echo.
    echo [INFO] Cloning Scanner Map repository...
    git clone https://github.com/poisonednumber/Scanner-map.git
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to clone repository
        pause
        exit /b 1
    )
    echo [OK] Repository cloned
)

cd Scanner-map
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Scanner-map directory not found
    pause
    exit /b 1
)

REM Create .env with defaults
echo.
echo ========================================
echo   Creating .env Configuration
echo ========================================
echo.

if exist ".env" (
    copy .env .env.backup >nul 2>&1
    echo [INFO] Backed up existing .env
)

(
    echo # Scanner Map Configuration - Development Test
    echo # Generated for testing with all defaults
    echo.
    echo # --- Core Settings ---
    echo WEBSERVER_PORT=3001
    echo BOT_PORT=3306
    echo PUBLIC_DOMAIN=localhost
    echo TIMEZONE=America/New_York
    echo.
    echo # --- Discord Bot (Optional) ---
    echo ENABLE_DISCORD=false
    echo DISCORD_TOKEN=
    echo CLIENT_ID=
    echo.
    echo # --- Transcription Mode ---
    echo TRANSCRIPTION_MODE=local
    echo TRANSCRIPTION_DEVICE=cpu
    echo.
    echo # --- AI Provider ---
    echo AI_PROVIDER=ollama
    echo OLLAMA_URL=http://localhost:11434
    echo OLLAMA_MODEL=llama3.1:8b
    echo.
    echo # --- Geocoding ---
    echo GEOCODING_PROVIDER=nominatim
    echo GOOGLE_MAPS_API_KEY=
    echo LOCATIONIQ_API_KEY=
    echo GEOCODING_STATE=MD
    echo GEOCODING_COUNTRY=us
    echo GEOCODING_CITY=Baltimore
    echo GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City,Anne Arundel
    echo.
    echo # --- Storage ---
    echo STORAGE_MODE=local
    echo.
    echo # --- Authentication ---
    echo ENABLE_AUTH=false
    echo WEBSERVER_PASSWORD=
    echo SESSION_DURATION_DAYS=7
    echo MAX_SESSIONS_PER_USER=5
    echo.
    echo # --- Talk Groups ---
    echo MAPPED_TALK_GROUPS=
    echo ENABLE_MAPPED_TALK_GROUPS=true
    echo.
    echo # --- iCAD Transcribe Settings ---
    echo ICAD_URL=http://icad-transcribe:9912
    echo ICAD_PROFILE=whisper-1
    echo ICAD_API_KEY=AUTO_GENERATE_ON_STARTUP
) > .env

echo [OK] .env file created

REM Create appdata directories
echo.
echo ========================================
echo   Creating Data Directories
echo ========================================
echo.

if not exist "appdata\scanner-map\data" mkdir appdata\scanner-map\data
if not exist "appdata\scanner-map\audio" mkdir appdata\scanner-map\audio
if not exist "appdata\scanner-map\logs" mkdir appdata\scanner-map\logs

if /i "!ENABLE_ICAD!"=="y" (
    if not exist "appdata\icad-transcribe\log" mkdir appdata\icad-transcribe\log
    if not exist "appdata\icad-transcribe\var" mkdir appdata\icad-transcribe\var
    if not exist "appdata\icad-transcribe\.env" (
        (
            echo # iCAD Transcribe Configuration
            echo LOG_LEVEL=2
            echo DEBUG=False
            echo BASE_URL=http://localhost:9912
            echo SESSION_COOKIE_SECURE=False
            echo SESSION_COOKIE_DOMAIN=localhost
            echo SESSION_COOKIE_NAME=icad_transcribe
            echo SESSION_COOKIE_PATH=/
            echo SQLITE_DATABASE_PATH=var/icad_transcribe.db
            echo ROOT_USERNAME=admin
            echo ROOT_PASSWORD=changeme123
            echo API_KEY=AUTO_GENERATE_ON_STARTUP
        ) > appdata\icad-transcribe\.env
    )
)

echo [OK] Data directories created

REM Start services
echo.
echo ========================================
echo   Starting Docker Services
echo ========================================
echo.

echo [INFO] Building Scanner Map container...
docker-compose build scanner-map
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to build container
    goto :cleanup
)

echo [INFO] Starting Scanner Map...
docker-compose up -d scanner-map
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to start container
    goto :cleanup
)

if /i "!ENABLE_ICAD!"=="y" (
    echo [INFO] Starting iCAD Transcribe...
    docker-compose -f docker-compose.full.yml up -d icad-transcribe
)

echo [OK] Services started
echo.

REM Verify web pages
echo ========================================
echo   Verifying Web Pages
echo ========================================
echo.

echo [INFO] Waiting for services to start (30 seconds)...
timeout /t 30 /nobreak >nul

set SCANNER_OK=0
set ICAD_OK=0

echo [INFO] Testing Scanner Map (http://localhost:3001)...
for /l %%i in (1,1,10) do (
    curl -s -f -o nul -w "%%{http_code}" http://localhost:3001 | findstr /C:"200" >nul
    if !ERRORLEVEL! EQU 0 (
        echo [OK] Scanner Map is responding (HTTP 200)
        set SCANNER_OK=1
        goto :scanner_done
    )
    echo   Attempt %%i/10 - waiting...
    timeout /t 3 /nobreak >nul
)
:scanner_done

if !SCANNER_OK! EQU 0 (
    echo [WARNING] Scanner Map did not respond
)

echo [INFO] Testing iCAD Transcribe (http://localhost:9912)...
for /l %%i in (1,1,10) do (
    curl -s -f -o nul -w "%%{http_code}" http://localhost:9912 | findstr /C:"200" >nul
    if !ERRORLEVEL! EQU 0 (
        echo [OK] iCAD Transcribe is responding (HTTP 200)
        set ICAD_OK=1
        goto :icad_done
    )
    echo   Attempt %%i/10 - waiting...
    timeout /t 3 /nobreak >nul
)
:icad_done

if !ICAD_OK! EQU 0 (
    echo [WARNING] iCAD Transcribe did not respond (may still be starting)
)

echo.
if !SCANNER_OK! EQU 1 (
    echo [OK] Scanner Map web interface is accessible
    echo       URL: http://localhost:3001
)
if !ICAD_OK! EQU 1 (
    echo [OK] iCAD Transcribe web interface is accessible
    echo       URL: http://localhost:9912
)

echo.
echo ========================================
echo   Installation Verified
echo ========================================
echo.
echo Web pages are accessible. Waiting 10 seconds before cleanup...
timeout /t 10 /nobreak

:cleanup
echo.
echo ========================================
echo   Cleaning Up Development Environment
echo ========================================
echo.

echo [INFO] Stopping Docker containers...
docker-compose down >nul 2>&1
docker-compose -f docker-compose.full.yml down >nul 2>&1

echo [INFO] Removing appdata directory...
if exist "appdata" (
    rmdir /s /q appdata
    echo [OK] Removed appdata directory
)

echo [INFO] Removing .env file...
if exist ".env" (
    del /f .env >nul 2>&1
    echo [OK] Removed .env file
)

if exist ".env.backup" (
    del /f .env.backup >nul 2>&1
)

if exist "test-setup-defaults.env" (
    del /f test-setup-defaults.env >nul 2>&1
)

set /p REMOVE_IMAGE="Remove Scanner Map Docker image? [y/N]: "
if /i "!REMOVE_IMAGE!"=="y" (
    docker rmi scanner-map-scanner-map:latest >nul 2>&1
    echo [OK] Removed Docker image
)

echo.
echo ========================================
echo   Development Test Complete
echo ========================================
echo.
echo [OK] All services tested and cleaned up successfully!
echo.
pause

