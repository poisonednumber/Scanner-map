@echo off
REM Scanner Map - Windows Installer Script
REM Easy-to-use installer for Windows users

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

REM Check for Docker
where docker >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not installed or not in PATH
    echo Please install Docker Desktop from: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)

REM Check for Docker Compose
docker compose version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    docker-compose version >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Docker Compose is not installed
        echo Please install Docker Compose
        pause
        exit /b 1
    )
)

echo [OK] All prerequisites found
echo.

REM Clone repository
if exist "Scanner-map" (
    echo Scanner-map directory already exists
    set /p OVERWRITE="Remove and clone fresh? (y/N): "
    if /i "!OVERWRITE!"=="y" (
        rmdir /s /q Scanner-map
    ) else (
        cd Scanner-map
        goto :configure
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

:configure
echo.
echo ========================================
echo   Optional Services Configuration
echo ========================================
echo.
echo Scanner Map supports several optional services:
echo.
echo 1. Ollama - Local AI for summaries and address extraction
echo 2. iCAD Transcribe - Advanced radio-optimized transcription service
echo 3. TrunkRecorder - Record calls from trunked radio systems
echo.

set ENABLE_OLLAMA=n
set ENABLE_ICAD=n
set ENABLE_TRUNKRECORDER=n

set /p ENABLE_OLLAMA="Configure Ollama? (y/N): "
echo.
if /i "!ENABLE_OLLAMA!"=="" set ENABLE_OLLAMA=n
if /i "!ENABLE_OLLAMA!"=="y" (
    set /p OLLAMA_DOCKER="Install Ollama via Docker? (Y/n): "
    if /i "!OLLAMA_DOCKER!"=="" set OLLAMA_DOCKER=y
    if /i "!OLLAMA_DOCKER!"=="n" (
        set /p OLLAMA_URL="Enter Ollama URL [http://localhost:11434]: "
        if "!OLLAMA_URL!"=="" set OLLAMA_URL=http://localhost:11434
        set OLLAMA_INSTALL_MODE=manual
        echo [INFO] Ollama must be installed separately. See: https://ollama.com
    ) else (
        set OLLAMA_URL=http://ollama:11434
        set OLLAMA_INSTALL_MODE=docker
        echo [INFO] Ollama will be installed via Docker
    )
    set /p OLLAMA_MODEL="Enter Ollama model [llama3.1:8b]: "
    if "!OLLAMA_MODEL!"=="" set OLLAMA_MODEL=llama3.1:8b
)

set /p ENABLE_ICAD="Configure iCAD Transcribe? (y/N): "
echo.
if /i "!ENABLE_ICAD!"=="y" (
    REM Use Docker service name for internal communication
    set ICAD_URL=http://icad-transcribe:9912
    set /p ICAD_PROFILE="Enter iCAD profile/model [whisper-1]: "
    if "!ICAD_PROFILE!"=="" set ICAD_PROFILE=whisper-1
    REM Auto-generate API key (UUID v4 format)
    REM Generate a simple UUID-like string for Windows batch
    set ICAD_API_KEY=
    for /f "tokens=2 delims==" %%a in ('wmic path win32_computersystemproduct get uuid') do set ICAD_API_KEY=%%a
    REM Fallback to PowerShell if wmic doesn't work
    if "!ICAD_API_KEY!"=="" (
        for /f "delims=" %%a in ('powershell -Command "[guid]::NewGuid().ToString()"') do set ICAD_API_KEY=%%a
    )
    echo [INFO] iCAD URL pre-configured: !ICAD_URL! (Docker service name)
    echo [INFO] iCAD API key will be auto-generated on first startup
)

set /p ENABLE_TRUNKRECORDER="Configure TrunkRecorder? (y/N): "
echo.
if /i "!ENABLE_TRUNKRECORDER!"=="" set ENABLE_TRUNKRECORDER=n
if /i "!ENABLE_TRUNKRECORDER!"=="y" (
    echo [INFO] TrunkRecorder will be added to docker-compose.yml
    echo [WARNING] TrunkRecorder is licensed under GPL-3.0
    echo [INFO] See LICENSE_NOTICE.md for details
    echo [INFO] TrunkRecorder config.json will be pre-configured with upload URL
)

REM Configure Discord Bot
echo.
echo ========================================
echo   Discord Bot Configuration (Optional)
echo ========================================
echo.
echo Discord bot integration is optional. Press Enter to skip.
echo.
echo To set up a Discord bot:
echo   1. Visit: https://discord.com/developers/applications
echo   2. Click 'New Application' and give it a name
echo   3. Go to 'Bot' section and click 'Add Bot'
echo   4. Under 'Token', click 'Reset Token' or 'Copy' to get your bot token
echo   5. Enable 'Message Content Intent' under 'Privileged Gateway Intents'
echo   6. Go to 'OAuth2' ^> 'URL Generator'
echo      - Select 'bot' scope
echo      - Select permissions: 'Send Messages', 'Read Message History', 'Use Slash Commands'
echo      - Copy the generated URL and open it to invite bot to your server
echo.
echo Quick links:
echo   - Developer Portal: https://discord.com/developers/applications
echo   - Bot Setup Guide: https://discord.com/developers/docs/getting-started
echo.
set DISCORD_TOKEN=
set CLIENT_ID=
set ENABLE_DISCORD=false
set /p DISCORD_TOKEN="Enter Discord bot token (or press Enter to skip): "
echo.
if not "!DISCORD_TOKEN!"=="" (
    set ENABLE_DISCORD=true
    set /p CLIENT_ID="Enter Discord Client ID (optional, press Enter to skip): "
    echo.
) else (
    echo [INFO] Discord bot will be disabled
    echo.
)

REM Configure AI Provider
echo ========================================
echo   AI Provider Configuration (Optional)
echo ========================================
echo.
echo Choose an AI provider for summaries and address extraction:

REM Check if Ollama is enabled - if so, default to Ollama
set DEFAULT_AI_PROVIDER=openai
set DEFAULT_PROMPT=[openai]
if /i "!ENABLE_OLLAMA!"=="y" (
    set DEFAULT_AI_PROVIDER=ollama
    set DEFAULT_PROMPT=[ollama]
    echo Ollama is enabled - will default to Ollama.
) else (
    echo Press Enter to skip and use defaults (OpenAI).
)
echo.
echo 1. OpenAI (ChatGPT) - Paid API service
echo 2. Ollama - Free local AI service
echo.
set AI_PROVIDER=!DEFAULT_AI_PROVIDER!
set OPENAI_API_KEY=
set OPENAI_MODEL=gpt-4o-mini
set /p AI_PROVIDER_CHOICE="Select AI provider (openai/ollama) !DEFAULT_PROMPT! or press Enter to skip: "
echo.
if "!AI_PROVIDER_CHOICE!"=="" set AI_PROVIDER_CHOICE=!DEFAULT_AI_PROVIDER!
if /i "!AI_PROVIDER_CHOICE!"=="openai" (
    set AI_PROVIDER=openai
    echo [INFO] OpenAI API requires an API key
    echo [INFO] Get your API key at: https://platform.openai.com/api-keys
    set /p OPENAI_API_KEY="Enter OpenAI API key (or press Enter to skip): "
    echo.
    if "!OPENAI_API_KEY!"=="" (
        echo [WARNING] OpenAI API key not provided. You can add it later in .env
    )
    set /p OPENAI_MODEL="Enter OpenAI model (e.g., gpt-4o-mini, gpt-3.5-turbo) [gpt-4o-mini]: "
    if "!OPENAI_MODEL!"=="" set OPENAI_MODEL=gpt-4o-mini
    echo.
) else if /i "!AI_PROVIDER_CHOICE!"=="ollama" (
    set AI_PROVIDER=ollama
    if /i "!ENABLE_OLLAMA!"=="y" (
        REM Already configured above
    ) else (
        set ENABLE_OLLAMA=y
set /p OLLAMA_DOCKER="Install Ollama via Docker? (Y/n): "
    if /i "!OLLAMA_DOCKER!"=="" set OLLAMA_DOCKER=y
    if /i "!OLLAMA_DOCKER!"=="n" (
            set /p OLLAMA_URL="Enter Ollama URL [http://localhost:11434]: "
            if "!OLLAMA_URL!"=="" set OLLAMA_URL=http://localhost:11434
            set OLLAMA_INSTALL_MODE=manual
            echo [INFO] Ollama must be installed separately. See: https://ollama.com
        ) else (
            set OLLAMA_URL=http://ollama:11434
            set OLLAMA_INSTALL_MODE=docker
            echo [INFO] Ollama will be installed via Docker
        )
        set /p OLLAMA_MODEL="Enter Ollama model [llama3.1:8b]: "
        if "!OLLAMA_MODEL!"=="" set OLLAMA_MODEL=llama3.1:8b
    )
    set OPENAI_API_KEY=
    set OPENAI_MODEL=
    echo.
) else (
    REM Use default based on Ollama status
    if /i "!ENABLE_OLLAMA!"=="y" (
        set AI_PROVIDER=ollama
        set ENABLE_OLLAMA=y
        if "!OLLAMA_URL!"=="" set OLLAMA_URL=http://ollama:11434
        if "!OLLAMA_INSTALL_MODE!"=="" set OLLAMA_INSTALL_MODE=docker
        if "!OLLAMA_MODEL!"=="" set OLLAMA_MODEL=llama3.1:8b
        set OPENAI_API_KEY=
        set OPENAI_MODEL=
        echo [INFO] Defaulting to Ollama (since Ollama is enabled)
    ) else (
        set AI_PROVIDER=openai
        set OPENAI_API_KEY=
        set OPENAI_MODEL=gpt-4o-mini
        echo [INFO] Defaulting to OpenAI
    )
    echo.
)

REM Create .env file
echo.
echo ========================================
echo   Creating .env Configuration
echo ========================================
echo.

if exist ".env" (
    set /p OVERWRITE=".env file exists. Overwrite? (y/N): "
    if /i not "!OVERWRITE!"=="y" goto :docker
)

(
    echo # Scanner Map Configuration
    echo # Generated by installer on %DATE% %TIME%
    echo.
    echo # --- Core Settings ---
    echo WEBSERVER_PORT=3001
    echo BOT_PORT=3306
    echo PUBLIC_DOMAIN=localhost
    echo TIMEZONE=America/New_York
    echo.
    echo # --- Discord Bot ^(Optional^) ---
    echo ENABLE_DISCORD=!ENABLE_DISCORD!
    echo DISCORD_TOKEN=!DISCORD_TOKEN!
    echo CLIENT_ID=!CLIENT_ID!
    echo.
    echo # --- Transcription Mode ---
    echo # Options: local, remote, openai, icad
    echo TRANSCRIPTION_MODE=local
    echo TRANSCRIPTION_DEVICE=cpu
    echo.
    echo # --- AI Provider ---
    echo # Options: openai, ollama
    echo AI_PROVIDER=!AI_PROVIDER!
    echo OPENAI_API_KEY=!OPENAI_API_KEY!
    echo OPENAI_MODEL=!OPENAI_MODEL!
    echo.
) > .env

if /i "!ENABLE_OLLAMA!"=="y" (
    (
        echo # --- Ollama Settings ^(if AI_PROVIDER=ollama^) ---
        echo # Pre-configured to use Docker service name for internal communication
        echo OLLAMA_URL=!OLLAMA_URL!
        echo OLLAMA_MODEL=!OLLAMA_MODEL!
        echo.
    ) >> .env
    if /i "!OLLAMA_INSTALL_MODE!"=="docker" (
        echo [OK] Ollama URL pre-configured: !OLLAMA_URL! (Docker service name)
    )
) else (
    (
        echo # --- Ollama Settings ^(not configured^) ---
        echo # OLLAMA_URL=http://localhost:11434
        echo # OLLAMA_MODEL=llama3.1:8b
        echo.
    ) >> .env
)

if /i "!ENABLE_ICAD!"=="y" (
    (
        echo # --- iCAD Transcribe Settings ^(if TRANSCRIPTION_MODE=icad^) ---
        echo # Pre-configured to use Docker service name for internal communication
        echo ICAD_URL=!ICAD_URL!
        echo ICAD_PROFILE=!ICAD_PROFILE!
        echo # API key will be auto-generated on first Scanner Map startup
        echo ICAD_API_KEY=AUTO_GENERATE_ON_STARTUP
    ) >> .env
    echo. >> .env
) else (
    (
        echo # --- iCAD Transcribe Settings ^(not configured^) ---
        echo # ICAD_URL=http://localhost:9912
        echo # ICAD_PROFILE=whisper-1
        echo # ICAD_API_KEY=
        echo.
    ) >> .env
)

(
    echo # --- Geocoding ---
    echo # At least one API key is required
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
) >> .env

echo [OK] .env file created
echo [WARNING] Please edit .env to add your API keys

REM Create appdata directory structure
if not exist "appdata\scanner-map\data" mkdir appdata\scanner-map\data
if not exist "appdata\scanner-map\audio" mkdir appdata\scanner-map\audio
if not exist "appdata\scanner-map\logs" mkdir appdata\scanner-map\logs

REM Create TrunkRecorder config if enabled
if /i "!ENABLE_TRUNKRECORDER!"=="y" (
    if not exist "appdata\trunk-recorder\config" mkdir appdata\trunk-recorder\config
    if not exist "appdata\trunk-recorder\recordings" mkdir appdata\trunk-recorder\recordings
    if not exist "appdata\trunk-recorder\config\config.json" (
        echo [INFO] Creating pre-configured TrunkRecorder config.json
        (
            echo {
            echo   "sources": [
            echo     {
            echo       "type": "rtl_sdr",
            echo       "device": 0,
            echo       "center": 850000000,
            echo       "rate": 2048000
            echo     }
            echo   ],
            echo   "systems": [
            echo     {
            echo       "id": 1,
            echo       "name": "Your System",
            echo       "control_channels": [851.0125, 851.5125],
            echo       "type": "p25"
            echo     }
            echo   ],
            echo   "uploadServer": {
            echo     "type": "rdio-scanner",
            echo     "url": "http://scanner-map:3306/api/call-upload",
            echo     "apiKey": "YOUR_API_KEY_HERE"
            echo   }
            echo }
        ) > appdata\trunk-recorder\config\config.json
        echo [OK] TrunkRecorder config.json created with pre-configured upload URL
        echo [WARNING] IMPORTANT: Edit appdata\trunk-recorder\config\config.json and:
        echo   1. Configure your radio system (sources, control_channels, etc.)
        echo   2. Replace 'YOUR_API_KEY_HERE' with an API key from Scanner Map
    ) else (
        echo [WARNING] TrunkRecorder config.json already exists - not overwriting
    )
)

REM Create iCAD directories if enabled
if /i "!ENABLE_ICAD!"=="y" (
    if not exist "appdata\icad-transcribe\log" mkdir appdata\icad-transcribe\log
    if not exist "appdata\icad-transcribe\var" mkdir appdata\icad-transcribe\var
    if not exist "appdata\icad-transcribe\.env" (
        echo [INFO] Creating iCAD Transcribe .env file
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
            echo # API key will be auto-generated and shared with Scanner Map
            echo API_KEY=AUTO_GENERATE_ON_STARTUP
        ) > appdata\icad-transcribe\.env
        echo [WARNING] iCAD Transcribe .env created with default password - CHANGE IT!
        echo [INFO] API key will be auto-generated on first Scanner Map startup
    )
)

REM Create Ollama directory if enabled via Docker
if /i "!ENABLE_OLLAMA!"=="y" (
    if /i "!OLLAMA_INSTALL_MODE!"=="docker" (
        if not exist "appdata\ollama" mkdir appdata\ollama
    )
)

:docker
echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo Next steps:
echo.
set STEP_NUM=1
echo !STEP_NUM!. Edit .env file and add your API keys
set /a STEP_NUM+=1
if /i "!ENABLE_OLLAMA!"=="y" (
    if /i "!OLLAMA_INSTALL_MODE!"=="docker" (
        echo !STEP_NUM!. Ollama (Docker)
        echo    - Ollama service will be added to docker-compose.yml
        echo    - After starting, pull model: docker exec -it ollama ollama pull !OLLAMA_MODEL!
        echo    - OLLAMA_URL is pre-configured: !OLLAMA_URL!
        echo    - See SERVICE_SETUP_GUIDES.md for model installation guide
        echo.
    ) else (
        echo !STEP_NUM!. Install Ollama
        echo    - Visit: https://ollama.com
        echo    - Install and start Ollama service
        echo    - Pull model: ollama pull !OLLAMA_MODEL!
        echo.
    )
    set /a STEP_NUM+=1
)
if /i "!ENABLE_ICAD!"=="y" (
    echo !STEP_NUM!. Configure iCAD Transcribe
    echo    - Edit appdata\icad-transcribe\.env
    echo    - Change the default password!
    echo    - ICAD_URL is pre-configured in .env to use Docker service name
    echo    - API key will be AUTO-GENERATED on first Scanner Map startup
    echo    - Install models via web interface: http://localhost:9912
    echo    - See SERVICE_SETUP_GUIDES.md for detailed instructions
    echo.
    set /a STEP_NUM+=1
)
if /i "!ENABLE_TRUNKRECORDER!"=="y" (
    echo !STEP_NUM!. Configure TrunkRecorder
    echo    - Edit appdata\trunk-recorder\config\config.json
    echo    - Configure your radio system (sources, control_channels, etc.)
    echo    - API key will be AUTO-GENERATED on first Scanner Map startup
    echo    - Upload URL is pre-configured: http://scanner-map:3306/api/call-upload
    echo    - See SERVICE_SETUP_GUIDES.md for hardware requirements and setup
    echo.
    set /a STEP_NUM+=1
)
echo !STEP_NUM!. Start Scanner Map: docker-compose up -d
set /a STEP_NUM+=1
echo !STEP_NUM!. View logs: docker-compose logs -f scanner-map
set /a STEP_NUM+=1
echo !STEP_NUM!. Access web interface: http://localhost:3001
echo.
echo All data is stored in: appdata\
echo    To remove everything: rmdir /s /q appdata
echo.
echo For optional services configuration, see:
echo - SERVICE_SETUP_GUIDES.md (Quick setup guides for each service)
echo - docker-compose.README.md
echo - LICENSE_NOTICE.md
echo - APPDATA_STRUCTURE.md
echo.
echo ========================================
echo   Auto-Start Services?
echo ========================================
echo.
set /p AUTO_START="Start Scanner Map now? (Y/n): "
if /i not "!AUTO_START!"=="n" (
    echo.
    echo [INFO] Starting Scanner Map and all enabled services...
    echo.
    REM Make sure we're in the Scanner-map directory
    REM We should already be there after cd Scanner-map, but verify
    if not exist "docker-compose.yml" (
        if exist "..\docker-compose.yml" (
            cd ..
        ) else if exist "Scanner-map\docker-compose.yml" (
            if not exist "Scanner-map" (
                echo [ERROR] Scanner-map directory not found
                goto :end
            )
            cd Scanner-map
        ) else (
            echo [ERROR] docker-compose.yml not found.
            echo Current directory: %CD%
            echo Please ensure you're in the Scanner-map directory.
            goto :end
        )
    )
    echo [INFO] Running docker-compose from: %CD%
    docker-compose up -d
    if !ERRORLEVEL! EQU 0 (
        echo.
        echo [OK] Services started successfully!
        echo.
        echo View logs with: docker-compose logs -f scanner-map
        echo Stop services with: docker-compose down
        echo.
        timeout /t 3 >nul
        echo Opening web interface in 3 seconds...
        start http://localhost:3001
    ) else (
        echo.
        echo [ERROR] Failed to start services. Check the error messages above.
        echo You can try manually: docker-compose up -d
    )
) else (
    echo.
    echo [INFO] Skipping auto-start. Start manually with: docker-compose up -d
)
echo.
:end
pause

