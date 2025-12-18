#!/bin/bash

# Scanner Map - Unified Installer Script
# Works on Linux, macOS, and Windows (via Git Bash/WSL)
# Easy-to-use installer for all optional services

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        OS="windows"
    else
        OS="unknown"
    fi
    echo "$OS"
}

# Print colored messages
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo ""
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Prompt for yes/no
prompt_yes_no() {
    local prompt="$1"
    local default="${2:-n}"
    local response
    
    if [[ "$default" == "y" ]]; then
        read -p "$prompt [Y/n]: " response
        response="${response:-y}"
    else
        read -p "$prompt [y/N]: " response
        response="${response:-n}"
    fi
    
    [[ "$response" =~ ^[Yy]$ ]]
}

# Prompt for input with default
prompt_input() {
    local prompt="$1"
    local default="$2"
    local result
    
    if [[ -n "$default" ]]; then
        read -p "$prompt [$default]: " result
        echo "${result:-$default}"
    else
        read -p "$prompt: " result
        echo "$result"
    fi
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    local missing=()
    
    if ! command_exists git; then
        missing+=("git")
    fi
    
    if ! command_exists docker; then
        missing+=("docker")
    fi
    
    if ! command_exists docker-compose && ! docker compose version >/dev/null 2>&1; then
        missing+=("docker-compose")
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        print_error "Missing required tools: ${missing[*]}"
        echo ""
        echo "Please install the missing tools:"
        for tool in "${missing[@]}"; do
            case "$tool" in
                git)
                    echo "  - Git: https://git-scm.com/downloads"
                    ;;
                docker)
                    echo "  - Docker: https://docs.docker.com/get-docker/"
                    ;;
                docker-compose)
                    echo "  - Docker Compose: https://docs.docker.com/compose/install/"
                    ;;
            esac
        done
        exit 1
    fi
    
    print_success "All prerequisites found"
}

# Clone repository
clone_repo() {
    print_header "Cloning Repository"
    
    if [[ -d "Scanner-map" ]]; then
        print_warning "Scanner-map directory already exists"
        if prompt_yes_no "Do you want to remove it and clone fresh?" "n"; then
            rm -rf Scanner-map
        else
            cd Scanner-map
            return
        fi
    fi
    
    print_info "Cloning Scanner Map repository..."
    git clone https://github.com/poisonednumber/Scanner-map.git
    cd Scanner-map
    print_success "Repository cloned"
}

# Configure geocoding service
configure_geocoding() {
    print_header "Geocoding Service Configuration"
    
    echo "Choose a geocoding service for address lookups:"
    echo ""
    echo "1. Nominatim (OpenStreetMap) - FREE, no API key required (Recommended)"
    echo "2. LocationIQ - FREE tier available (5,000 requests/day)"
    echo "3. Google Maps - Paid service (requires API key)"
    echo ""
    
    GEOCODING_PROVIDER=$(prompt_input "Select geocoding provider (nominatim/locationiq/google) [nominatim]" "nominatim")
    
    case "$GEOCODING_PROVIDER" in
        nominatim|n|1)
            GEOCODING_PROVIDER="nominatim"
            GOOGLE_MAPS_API_KEY=""
            LOCATIONIQ_API_KEY=""
            print_success "Using Nominatim (OpenStreetMap) - No API key required"
            ;;
        locationiq|l|2)
            GEOCODING_PROVIDER="locationiq"
            GOOGLE_MAPS_API_KEY=""
            echo ""
            print_info "LocationIQ offers a free tier: 5,000 requests/day"
            print_info "Get your free API key at: https://locationiq.com/"
            LOCATIONIQ_API_KEY=$(prompt_input "Enter LocationIQ API key (or press Enter to skip)" "")
            if [[ -z "$LOCATIONIQ_API_KEY" ]]; then
                print_warning "LocationIQ API key not provided. You can add it later in .env"
            fi
            ;;
        google|g|3)
            GEOCODING_PROVIDER="google"
            LOCATIONIQ_API_KEY=""
            echo ""
            print_info "Google Maps requires an API key with billing enabled"
            print_info "Get your API key at: https://console.cloud.google.com/"
            GOOGLE_MAPS_API_KEY=$(prompt_input "Enter Google Maps API key (or press Enter to skip)" "")
            if [[ -z "$GOOGLE_MAPS_API_KEY" ]]; then
                print_warning "Google Maps API key not provided. You can add it later in .env"
            fi
            ;;
        *)
            GEOCODING_PROVIDER="nominatim"
            GOOGLE_MAPS_API_KEY=""
            LOCATIONIQ_API_KEY=""
            print_info "Defaulting to Nominatim (free, no API key required)"
            ;;
    esac
    
    export GEOCODING_PROVIDER GOOGLE_MAPS_API_KEY LOCATIONIQ_API_KEY
}

# Configure AI provider
configure_ai_provider() {
    print_header "AI Provider Configuration (Optional)"
    
    echo "Choose an AI provider for summaries and address extraction:"
    echo "Press Enter to skip and use defaults (OpenAI)."
    echo ""
    echo "1. OpenAI (ChatGPT) - Paid API service"
    echo "2. Ollama - Free local AI service"
    echo ""
    
    AI_PROVIDER_CHOICE=$(prompt_input "Select AI provider (openai/ollama) [openai] or press Enter to skip" "openai")
    
    # If user just pressed Enter with no input, use default
    if [[ -z "$AI_PROVIDER_CHOICE" ]]; then
        AI_PROVIDER_CHOICE="openai"
    fi
    
    case "$AI_PROVIDER_CHOICE" in
        openai|o|1)
            AI_PROVIDER="openai"
            echo ""
            print_info "OpenAI API requires an API key"
            print_info "Get your API key at: https://platform.openai.com/api-keys"
            OPENAI_API_KEY=$(prompt_input "Enter OpenAI API key (or press Enter to skip)" "")
            if [[ -z "$OPENAI_API_KEY" ]]; then
                print_warning "OpenAI API key not provided. You can add it later in .env"
            fi
            OPENAI_MODEL=$(prompt_input "Enter OpenAI model (e.g., gpt-4o-mini, gpt-3.5-turbo) [gpt-4o-mini]" "gpt-4o-mini")
            OLLAMA_URL=""
            OLLAMA_MODEL=""
            ENABLE_OLLAMA=false
            ;;
        ollama|oll|2)
            AI_PROVIDER="ollama"
            ENABLE_OLLAMA=true
            if prompt_yes_no "Install Ollama via Docker? (Recommended)" "y"; then
                OLLAMA_URL="http://ollama:11434"  # Docker service name
                OLLAMA_INSTALL_MODE="docker"
            else
                OLLAMA_URL=$(prompt_input "Enter Ollama URL [http://localhost:11434]" "http://localhost:11434")
                OLLAMA_INSTALL_MODE="manual"
                print_warning "Ollama must be installed separately. See: https://ollama.com"
            fi
            OLLAMA_MODEL=$(prompt_input "Enter Ollama model (e.g., llama3.1:8b) [llama3.1:8b]" "llama3.1:8b")
            OPENAI_API_KEY=""
            OPENAI_MODEL=""
            ;;
        *)
            AI_PROVIDER="openai"
            OPENAI_API_KEY=""
            OPENAI_MODEL="gpt-4o-mini"
            OLLAMA_URL=""
            OLLAMA_MODEL=""
            ENABLE_OLLAMA=false
            print_info "Defaulting to OpenAI"
            ;;
    esac
    
    export AI_PROVIDER OPENAI_API_KEY OPENAI_MODEL OLLAMA_URL OLLAMA_MODEL ENABLE_OLLAMA OLLAMA_INSTALL_MODE
}

# Configure Discord bot
configure_discord() {
    print_header "Discord Bot Configuration (Optional)"
    
    echo "Discord bot integration is optional. Press Enter to skip."
    echo ""
    print_info "To set up a Discord bot:"
    echo "  1. Visit: https://discord.com/developers/applications"
    echo "  2. Click 'New Application' and give it a name"
    echo "  3. Go to 'Bot' section and click 'Add Bot'"
    echo "  4. Under 'Token', click 'Reset Token' or 'Copy' to get your bot token"
    echo "  5. Enable 'Message Content Intent' under 'Privileged Gateway Intents'"
    echo "  6. Go to 'OAuth2' > 'URL Generator'"
    echo "     - Select 'bot' scope"
    echo "     - Select permissions: 'Send Messages', 'Read Message History', 'Use Slash Commands'"
    echo "     - Copy the generated URL and open it to invite bot to your server"
    echo ""
    echo "Quick links:"
    echo "  - Developer Portal: https://discord.com/developers/applications"
    echo "  - Bot Setup Guide: https://discord.com/developers/docs/getting-started"
    echo ""
    
    DISCORD_TOKEN=$(prompt_input "Enter Discord bot token (or press Enter to skip)" "")
    if [[ -z "$DISCORD_TOKEN" ]]; then
        print_warning "Discord token not provided. Discord bot will be disabled."
        ENABLE_DISCORD=false
        DISCORD_TOKEN=""
    else
        ENABLE_DISCORD=true
    fi
    
    CLIENT_ID=$(prompt_input "Enter Discord Client ID (optional, press Enter to skip)" "")
    if [[ -z "$CLIENT_ID" ]]; then
        CLIENT_ID=""
    fi
    
    export ENABLE_DISCORD DISCORD_TOKEN CLIENT_ID
}

# Configure optional services
configure_optional_services() {
    print_header "Optional Services Configuration"
    
    echo "Scanner Map supports several optional services:"
    echo ""
    echo "1. iCAD Transcribe - Advanced radio-optimized transcription service"
    echo "2. TrunkRecorder - Record calls from trunked radio systems"
    echo ""
    
    # iCAD Transcribe
    ENABLE_ICAD=false
    if prompt_yes_no "Do you want to configure iCAD Transcribe? (Advanced transcription)" "n"; then
        ENABLE_ICAD=true
        ICAD_URL=$(prompt_input "Enter iCAD Transcribe URL" "http://localhost:9912")
        ICAD_PROFILE=$(prompt_input "Enter iCAD profile/model" "whisper-1")
        ICAD_API_KEY=$(prompt_input "Enter iCAD API key (optional, press Enter to skip)" "")
    fi
    
    # TrunkRecorder
    ENABLE_TRUNKRECORDER=false
    if prompt_yes_no "Do you want to configure TrunkRecorder? (GPL-3.0 licensed)" "n"; then
        ENABLE_TRUNKRECORDER=true
        print_info "TrunkRecorder will be added to docker-compose.yml"
        print_warning "TrunkRecorder is licensed under GPL-3.0"
        print_info "See LICENSE_NOTICE.md for details"
    fi
    
    export ENABLE_OLLAMA OLLAMA_URL OLLAMA_MODEL OLLAMA_INSTALL_MODE
    export ENABLE_ICAD ICAD_URL ICAD_PROFILE ICAD_API_KEY
    export ENABLE_TRUNKRECORDER
}

# Create .env file
create_env_file() {
    print_header "Creating .env Configuration File"
    
    if [[ -f ".env" ]]; then
        print_warning ".env file already exists"
        if ! prompt_yes_no "Do you want to overwrite it?" "n"; then
            return
        fi
    fi
    
    print_info "Creating .env file..."
    
    # Basic configuration
    cat > .env << EOF
# Scanner Map Configuration
# Generated by installer on $(date)

# --- Core Settings ---
WEBSERVER_PORT=3001
BOT_PORT=3306
PUBLIC_DOMAIN=localhost
TIMEZONE=America/New_York

# --- Discord Bot (Optional) ---
ENABLE_DISCORD=$ENABLE_DISCORD
DISCORD_TOKEN=$DISCORD_TOKEN
CLIENT_ID=$CLIENT_ID

# --- Transcription Mode ---
# Options: local, remote, openai, icad
TRANSCRIPTION_MODE=local
TRANSCRIPTION_DEVICE=cpu

EOF

    # Add AI Provider config
    cat >> .env << EOF

# --- AI Provider ---
AI_PROVIDER=$AI_PROVIDER
EOF
    
    if [[ "$AI_PROVIDER" == "openai" ]]; then
        cat >> .env << EOF
OPENAI_API_KEY=$OPENAI_API_KEY
OPENAI_MODEL=$OPENAI_MODEL
EOF
        if [[ "$ENABLE_OLLAMA" == "true" ]]; then
            cat >> .env << EOF
# Ollama settings (not used with OpenAI)
# OLLAMA_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.1:8b
EOF
        fi
    elif [[ "$AI_PROVIDER" == "ollama" ]]; then
        if [[ "$ENABLE_OLLAMA" == "true" ]]; then
            cat >> .env << EOF
OLLAMA_URL=$OLLAMA_URL
OLLAMA_MODEL=$OLLAMA_MODEL
EOF
        fi
        cat >> .env << EOF
# OpenAI settings (not used with Ollama)
# OPENAI_API_KEY=
# OPENAI_MODEL=gpt-4o-mini
EOF
    fi
    
    # Add iCAD config if enabled
    if [[ "$ENABLE_ICAD" == "true" ]]; then
        # Use Docker service name for internal communication
        ICAD_DOCKER_URL="http://icad-transcribe:9912"
        cat >> .env << EOF

# --- iCAD Transcribe Settings (if TRANSCRIPTION_MODE=icad) ---
# Pre-configured to use Docker service name for internal communication
ICAD_URL=$ICAD_DOCKER_URL
ICAD_PROFILE=$ICAD_PROFILE
# API key will be auto-generated on first Scanner Map startup
ICAD_API_KEY=AUTO_GENERATE_ON_STARTUP
EOF
        print_success "iCAD URL pre-configured: $ICAD_DOCKER_URL (Docker service name)"
        print_info "API key will be auto-generated on first Scanner Map startup"
    else
        cat >> .env << EOF

# --- iCAD Transcribe Settings (not configured) ---
# ICAD_URL=http://localhost:9912
# ICAD_PROFILE=whisper-1
# ICAD_API_KEY=
EOF
    fi
    
    # Add geocoding config
    cat >> .env << EOF

# --- Geocoding ---
# Provider: nominatim (free, no API key), locationiq (free tier), or google (paid)
GEOCODING_PROVIDER=$GEOCODING_PROVIDER
GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY
LOCATIONIQ_API_KEY=$LOCATIONIQ_API_KEY
GEOCODING_STATE=MD
GEOCODING_COUNTRY=us
GEOCODING_CITY=Baltimore
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City,Anne Arundel

# --- Storage ---
STORAGE_MODE=local
# S3 settings (if STORAGE_MODE=s3)
# S3_ENDPOINT=
# S3_BUCKET_NAME=
# S3_ACCESS_KEY_ID=
# S3_SECRET_ACCESS_KEY=

# --- Authentication ---
ENABLE_AUTH=false
WEBSERVER_PASSWORD=
SESSION_DURATION_DAYS=7
MAX_SESSIONS_PER_USER=5

# --- Talk Groups ---
MAPPED_TALK_GROUPS=
ENABLE_MAPPED_TALK_GROUPS=true
EOF
    
    print_success ".env file created"
    print_warning "Please edit .env to add your API keys and configure settings"
}

# Update docker-compose.yml
update_docker_compose() {
    print_header "Updating Docker Compose Configuration"
    
    # Backup original
    if [[ -f "docker-compose.yml" ]]; then
        cp docker-compose.yml docker-compose.yml.backup
    fi
    
    # Read current docker-compose.yml
    local compose_file="docker-compose.yml"
    
    # Add Ollama service if enabled via Docker
    if [[ "$ENABLE_OLLAMA" == "true" && "$OLLAMA_INSTALL_MODE" == "docker" ]]; then
        print_info "Adding Ollama service to docker-compose.yml"
        
        # Check if Ollama service already exists
        if ! grep -q "ollama:" "$compose_file"; then
            # Add Ollama service before TrunkRecorder section
            sed -i.bak '/^  # TrunkRecorder (OPTIONAL)/i\
  # Ollama (OPTIONAL) - Local AI Service\
  ollama:\
    image: ollama/ollama:latest\
    container_name: ollama\
    restart: unless-stopped\
    volumes:\
      - ./appdata/ollama:/root/.ollama\
    ports:\
      - "11434:11434"\
    networks:\
      - scanner-network\
    # For GPU support, add deploy section (see docker-compose.yml comments)\
    # After starting, pull a model: docker exec -it ollama ollama pull '"$OLLAMA_MODEL"'\
\
' "$compose_file"
            
            # Create Ollama directory
            mkdir -p appdata/ollama
            chmod 755 appdata/ollama
            
            # Update scanner-map depends_on
            if ! grep -q "depends_on:" "$compose_file" | grep -v "^#"; then
                sed -i.bak 's/# depends_on:/depends_on:/' "$compose_file"
            fi
            if ! grep -q "ollama" "$compose_file" | grep -A5 "depends_on:" | grep -v "^#"; then
                sed -i.bak '/depends_on:/a\
      - ollama' "$compose_file"
            fi
        fi
        
        print_success "Ollama service added to docker-compose.yml"
        print_info "After starting, pull the model: docker exec -it ollama ollama pull $OLLAMA_MODEL"
    fi
    
    # Add iCAD service if enabled
    if [[ "$ENABLE_ICAD" == "true" ]]; then
        print_info "Adding iCAD Transcribe service to docker-compose.yml"
        
        # Check if iCAD service already exists
        if ! grep -q "icad-transcribe:" "$compose_file"; then
            # Add iCAD service before networks section
            sed -i.bak '/^networks:/i\
  # iCAD Transcribe (OPTIONAL) - Apache-2.0 Licensed\
  # Advanced radio-optimized transcription service\
  icad-transcribe:\
    image: thegreatcodeholio/icad_transcribe:1.0\
    container_name: icad-transcribe\
    restart: unless-stopped\
    user: "9911:9911"\
    ports:\
      - "9912:9912"\
    volumes:\
      - ./appdata/icad-transcribe/log:/app/log\
      - ./appdata/icad-transcribe/var:/app/var\
      - ./appdata/icad-transcribe/.env:/app/.env\
    networks:\
      - scanner-network\
    environment:\
      - TZ=${TIMEZONE:-UTC}\
    # Official Repository: https://github.com/TheGreatCodeholio/icad_transcribe\
    # License: Apache-2.0\
\
' "$compose_file"
            
            # Update scanner-map depends_on
            if [[ "$ENABLE_TRUNKRECORDER" == "true" ]]; then
                sed -i.bak 's/# depends_on:/depends_on:/' "$compose_file"
                sed -i.bak '/depends_on:/a\
      - icad-transcribe' "$compose_file"
            else
                sed -i.bak 's/# depends_on:/depends_on:/' "$compose_file"
                sed -i.bak '/depends_on:/a\
      - icad-transcribe' "$compose_file"
            fi
        fi
        
        # Create iCAD directories in appdata
        mkdir -p appdata/icad-transcribe/log appdata/icad-transcribe/var
        chmod 755 appdata/icad-transcribe appdata/icad-transcribe/log appdata/icad-transcribe/var
        
        # Create iCAD .env file
        if [[ ! -f "appdata/icad-transcribe/.env" ]]; then
            cat > appdata/icad-transcribe/.env << EOF
# iCAD Transcribe Configuration
LOG_LEVEL=2
DEBUG=False
BASE_URL=http://localhost:9912
SESSION_COOKIE_SECURE=False
SESSION_COOKIE_DOMAIN=localhost
SESSION_COOKIE_NAME=icad_transcribe
SESSION_COOKIE_PATH=/
SQLITE_DATABASE_PATH=var/icad_transcribe.db
ROOT_USERNAME=admin
ROOT_PASSWORD=changeme123
# API key will be auto-generated and shared with Scanner Map
API_KEY=AUTO_GENERATE_ON_STARTUP
EOF
            print_warning "iCAD Transcribe .env created with default password - CHANGE IT!"
            print_info "API key will be auto-generated on first Scanner Map startup"
        fi
    fi
    
    # Enable TrunkRecorder if requested
    if [[ "$ENABLE_TRUNKRECORDER" == "true" ]]; then
        print_info "Enabling TrunkRecorder service in docker-compose.yml"
        # Uncomment TrunkRecorder service
        sed -i.bak 's/^  # trunk-recorder:/  trunk-recorder:/' "$compose_file"
        sed -i.bak 's/^  #   image:/    image:/' "$compose_file"
        sed -i.bak 's/^  #   container_name:/    container_name:/' "$compose_file"
        sed -i.bak 's/^  #   restart:/    restart:/' "$compose_file"
        sed -i.bak 's/^  #   privileged:/    privileged:/' "$compose_file"
        sed -i.bak 's/^  #   devices:/    devices:/' "$compose_file"
        sed -i.bak 's/^  #     - \/dev\/bus\/usb:/    - \/dev\/bus\/usb:/' "$compose_file"
            sed -i.bak 's/^  #   volumes:/    volumes:/' "$compose_file"
            sed -i.bak 's|^  #     - \./trunk-recorder/|    - ./appdata/trunk-recorder/|' "$compose_file"
        sed -i.bak 's/^  #   environment:/    environment:/' "$compose_file"
        sed -i.bak 's/^  #     - TZ=/    - TZ=/' "$compose_file"
        sed -i.bak 's/^  #   networks:/    networks:/' "$compose_file"
        sed -i.bak 's/^  #     - scanner-network/    - scanner-network/' "$compose_file"
        
        # Update depends_on
        if ! grep -q "trunk-recorder" "$compose_file" | grep -v "^#"; then
            sed -i.bak 's/# depends_on:/depends_on:/' "$compose_file"
            sed -i.bak '/depends_on:/a\
      - trunk-recorder' "$compose_file"
        fi
        
        # Create TrunkRecorder directories in appdata
        mkdir -p appdata/trunk-recorder/config appdata/trunk-recorder/recordings
        
        # Create pre-configured TrunkRecorder config.json
        if [[ ! -f "appdata/trunk-recorder/config/config.json" ]]; then
            print_info "Creating pre-configured TrunkRecorder config.json"
            cat > appdata/trunk-recorder/config/config.json << 'TRUNKEOF'
{
  "sources": [
    {
      "type": "rtl_sdr",
      "device": 0,
      "center": 850000000,
      "rate": 2048000
    }
  ],
  "systems": [
    {
      "id": 1,
      "name": "Your System",
      "control_channels": [851.0125, 851.5125],
      "type": "p25"
    }
  ],
  "uploadServer": {
    "type": "rdio-scanner",
    "url": "http://scanner-map:3306/api/call-upload",
    "apiKey": "AUTO_GENERATE_ON_STARTUP"
  }
}
TRUNKEOF
            print_success "TrunkRecorder config.json created with pre-configured upload URL"
            print_info "API key will be auto-generated on first Scanner Map startup"
        else
            print_warning "TrunkRecorder config.json already exists - not overwriting"
        fi
    fi
    
    # Create Scanner Map directories in appdata
    mkdir -p appdata/scanner-map/data appdata/scanner-map/audio appdata/scanner-map/logs
    chmod 755 appdata/scanner-map appdata/scanner-map/data appdata/scanner-map/audio appdata/scanner-map/logs
    
    # Update docker-compose.yml to use appdata structure (if not already updated)
    if grep -q "./data:/app/data" "$compose_file"; then
        sed -i.bak 's|./data:/app/data|./appdata/scanner-map/data:/app/data|' "$compose_file"
        sed -i.bak 's|./audio:/app/audio|./appdata/scanner-map/audio:/app/audio|' "$compose_file"
        sed -i.bak 's|./logs:/app/logs|./appdata/scanner-map/logs:/app/logs|' "$compose_file"
    fi
    
    # Clean up backup files
    rm -f docker-compose.yml.bak
    
    print_success "Docker Compose configuration updated"
    print_info "All data will be stored in ./appdata/ directory"
}

# Main installation
main() {
    print_header "Scanner Map Installer"
    
    echo "This installer will:"
    echo "  1. Check prerequisites (Git, Docker, Docker Compose)"
    echo "  2. Clone the Scanner Map repository"
    echo "  3. Configure geocoding service (Nominatim/LocationIQ/Google Maps)"
    echo "  4. Configure AI provider (OpenAI/Ollama)"
    echo "  5. Configure Discord bot (optional)"
    echo "  6. Configure optional services (iCAD, TrunkRecorder)"
    echo "  7. Create .env configuration file"
    echo "  8. Update docker-compose.yml"
    echo ""
    
    if ! prompt_yes_no "Continue with installation?" "y"; then
        print_info "Installation cancelled"
        exit 0
    fi
    
    # Detect OS
    OS=$(detect_os)
    print_info "Detected OS: $OS"
    
    # Check prerequisites
    check_prerequisites
    
    # Clone repository
    if [[ ! -d "Scanner-map" ]] || prompt_yes_no "Clone/update repository?" "y"; then
        clone_repo
    else
        cd Scanner-map 2>/dev/null || {
            print_error "Scanner-map directory not found"
            exit 1
        }
    fi
    
    # Configure optional services
    # Configure services in order
    configure_geocoding
    configure_ai_provider
    configure_discord
    configure_optional_services
    
    # Create .env
    create_env_file
    
    # Update docker-compose
    update_docker_compose
    
    # Final instructions
    print_header "Installation Complete!"
    
    echo "Next steps:"
    echo ""
    echo "1. Edit .env file and add your API keys:"
    echo "   - Google Maps or LocationIQ API key"
    echo "   - OpenAI API key (if using OpenAI)"
    echo "   - Discord token (optional)"
    echo ""
    
    if [[ "$ENABLE_ICAD" == "true" ]]; then
        echo "2. Configure iCAD Transcribe:"
        echo "   - Edit appdata/icad-transcribe/.env"
        echo "   - Change the default password!"
        echo "   - API key will be AUTO-GENERATED on first Scanner Map startup"
        echo "   - Install models via web interface: http://localhost:9912"
        echo "   - See SERVICE_SETUP_GUIDES.md for detailed instructions"
        echo ""
    fi
    
    if [[ "$ENABLE_OLLAMA" == "true" ]]; then
        if [[ "$OLLAMA_INSTALL_MODE" == "docker" ]]; then
            echo "3. Ollama (Docker):"
            echo "   - Ollama service added to docker-compose.yml"
            echo "   - After starting, pull model: docker exec -it ollama ollama pull $OLLAMA_MODEL"
            echo "   - OLLAMA_URL is pre-configured: $OLLAMA_URL"
            echo "   - See SERVICE_SETUP_GUIDES.md for model installation guide"
            echo ""
        else
            echo "3. Install Ollama:"
            echo "   - Visit: https://ollama.com"
            echo "   - Install and start Ollama service"
            echo "   - Pull model: ollama pull $OLLAMA_MODEL"
            echo ""
        fi
    fi
    
    if [[ "$ENABLE_TRUNKRECORDER" == "true" ]]; then
        echo "4. Configure TrunkRecorder:"
        echo "   - Edit appdata/trunk-recorder/config/config.json"
        echo "   - Configure your radio system (sources, control_channels, etc.)"
        echo "   - API key will be AUTO-GENERATED on first Scanner Map startup"
        echo "   - Upload URL is pre-configured: http://scanner-map:3306/api/call-upload"
        echo "   - See SERVICE_SETUP_GUIDES.md for hardware requirements and setup"
        echo ""
    fi
    
    echo "5. Start Scanner Map:"
    echo "   docker-compose up -d"
    echo ""
    echo "6. View logs:"
    echo "   docker-compose logs -f scanner-map"
    echo ""
    echo "7. Access web interface:"
    echo "   http://localhost:3001"
    echo ""
    echo "📁 All data is stored in: ./appdata/"
    echo "   To remove everything: rm -rf ./appdata"
    echo ""
    echo "📚 For detailed setup guides, see:"
    echo "   - SERVICE_SETUP_GUIDES.md (Quick setup guides for each service)"
    echo "   - docker-compose.README.md"
    echo "   - LICENSE_NOTICE.md"
    echo ""
    
    # Ask if user wants to start services
    echo ""
    if prompt_yes_no "Start Scanner Map now?" "y"; then
        print_info "Starting Scanner Map and all enabled services..."
        echo ""
        if docker-compose up -d 2>/dev/null || docker compose up -d 2>/dev/null; then
            print_success "Services started successfully!"
            echo ""
            echo "View logs with: docker-compose logs -f scanner-map"
            echo "Stop services with: docker-compose down"
            echo ""
            sleep 2
            print_info "Opening web interface..."
            # Try to open browser (works on macOS and most Linux)
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open http://localhost:3001 2>/dev/null &
            elif command -v open >/dev/null 2>&1; then
                open http://localhost:3001 2>/dev/null &
            fi
        else
            print_error "Failed to start services. Check the error messages above."
            echo "You can try manually: docker-compose up -d"
        fi
    else
        print_info "Skipping auto-start. Start manually with: docker-compose up -d"
    fi
    echo ""
    
    print_success "Installation complete! Happy scanning!"
}

# Run main function
main "$@"

