#!/bin/bash

# Scanner Map - Development Installer Script
# This version tests the installation and then cleans up everything

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Cleanup function
cleanup() {
    # Only cleanup if we're in Scanner-map directory
    if [[ ! -f "docker-compose.yml" ]]; then
        return
    fi
    
    print_header "Cleaning Up Development Environment"
    
    print_info "Stopping Docker containers..."
    docker-compose down 2>/dev/null || true
    docker-compose -f docker-compose.full.yml down 2>/dev/null || true
    
    print_info "Removing appdata directory..."
    if [[ -d "appdata" ]]; then
        rm -rf appdata
        print_success "Removed appdata directory"
    fi
    
    print_info "Removing .env file..."
    if [[ -f ".env" ]]; then
        rm -f .env
        print_success "Removed .env file"
    fi
    
    print_info "Removing test .env backup..."
    if [[ -f ".env.backup" ]]; then
        rm -f .env.backup
    fi
    
    print_info "Removing test-setup-defaults.env..."
    if [[ -f "test-setup-defaults.env" ]]; then
        rm -f test-setup-defaults.env
    fi
    
    print_info "Removing Docker images (optional)..."
    read -p "Remove Scanner Map Docker image? [y/N]: " remove_image
    if [[ "$remove_image" =~ ^[Yy]$ ]]; then
        docker rmi scanner-map-scanner-map:latest 2>/dev/null || true
        print_success "Removed Docker image"
    fi
    
    print_success "Cleanup complete!"
}

# Verify web pages
verify_web_pages() {
    print_header "Verifying Web Pages"
    
    local scanner_ok=false
    local icad_ok=false
    
    print_info "Waiting for services to start (30 seconds)..."
    sleep 30
    
    print_info "Testing Scanner Map (http://localhost:3001)..."
    for i in {1..10}; do
        if curl -s -f -o /dev/null -w "%{http_code}" http://localhost:3001 | grep -q "200"; then
            print_success "Scanner Map is responding (HTTP 200)"
            scanner_ok=true
            break
        fi
        echo "  Attempt $i/10 - waiting..."
        sleep 3
    done
    
    if [[ "$scanner_ok" == "false" ]]; then
        print_error "Scanner Map did not respond"
    fi
    
    print_info "Testing iCAD Transcribe (http://localhost:9912)..."
    for i in {1..10}; do
        if curl -s -f -o /dev/null -w "%{http_code}" http://localhost:9912 | grep -q "200"; then
            print_success "iCAD Transcribe is responding (HTTP 200)"
            icad_ok=true
            break
        fi
        echo "  Attempt $i/10 - waiting..."
        sleep 3
    done
    
    if [[ "$icad_ok" == "false" ]]; then
        print_warning "iCAD Transcribe did not respond (may still be starting)"
    fi
    
    if [[ "$scanner_ok" == "true" ]]; then
        print_success "✓ Scanner Map web interface is accessible"
        print_info "  URL: http://localhost:3001"
    fi
    
    if [[ "$icad_ok" == "true" ]]; then
        print_success "✓ iCAD Transcribe web interface is accessible"
        print_info "  URL: http://localhost:9912"
    fi
    
    return 0
}

# Main function
main() {
    print_header "Scanner Map Development Installer"
    
    echo "This installer will:"
    echo "  1. Run the standard installation with defaults"
    echo "  2. Start Docker containers"
    echo "  3. Verify web pages are accessible"
    echo "  4. Clean up all configuration and data"
    echo ""
    
    if ! command -v curl >/dev/null 2>&1; then
        print_error "curl is required for web page verification"
        print_info "Install curl: sudo apt-get install curl (Linux) or brew install curl (macOS)"
        exit 1
    fi
    
    # Run installation with defaults (non-interactive simulation)
    print_header "Running Installation with Defaults"
    
    # Check prerequisites
    print_header "Checking Prerequisites"
    
    local missing=()
    if ! command -v git >/dev/null 2>&1; then missing+=("git"); fi
    if ! command -v docker >/dev/null 2>&1; then missing+=("docker"); fi
    if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then missing+=("docker-compose"); fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        print_error "Missing required tools: ${missing[*]}"
        exit 1
    fi
    print_success "All prerequisites found"
    
    # Clone if needed
    if [[ ! -d "Scanner-map" ]]; then
        print_header "Cloning Repository"
        print_info "Cloning Scanner Map repository..."
        git clone https://github.com/poisonednumber/Scanner-map.git
        cd Scanner-map
        print_success "Repository cloned"
    else
        cd Scanner-map 2>/dev/null || {
            print_error "Scanner-map directory not found"
            exit 1
        }
    fi
    
    # Create .env with defaults
    print_header "Creating .env Configuration"
    if [[ -f ".env" ]]; then
        cp .env .env.backup
        print_info "Backed up existing .env"
    fi
    
    cat > .env << 'EOF'
# Scanner Map Configuration - Development Test
# Generated for testing with all defaults

# --- Core Settings ---
WEBSERVER_PORT=3001
BOT_PORT=3306
PUBLIC_DOMAIN=localhost
TIMEZONE=America/New_York

# --- Discord Bot (Optional) ---
ENABLE_DISCORD=false
DISCORD_TOKEN=
CLIENT_ID=

# --- Transcription Mode ---
TRANSCRIPTION_MODE=local
TRANSCRIPTION_DEVICE=cpu

# --- AI Provider ---
AI_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# --- Geocoding ---
GEOCODING_PROVIDER=nominatim
GOOGLE_MAPS_API_KEY=
LOCATIONIQ_API_KEY=
GEOCODING_STATE=MD
GEOCODING_COUNTRY=us
GEOCODING_CITY=Baltimore
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City,Anne Arundel

# --- Storage ---
STORAGE_MODE=local

# --- Authentication ---
ENABLE_AUTH=false
WEBSERVER_PASSWORD=
SESSION_DURATION_DAYS=7
MAX_SESSIONS_PER_USER=5

# --- Talk Groups ---
MAPPED_TALK_GROUPS=
ENABLE_MAPPED_TALK_GROUPS=true

# --- iCAD Transcribe Settings ---
ICAD_URL=http://icad-transcribe:9912
ICAD_PROFILE=whisper-1
ICAD_API_KEY=AUTO_GENERATE_ON_STARTUP
EOF
    print_success ".env file created"
    
    # Create appdata directories
    print_header "Creating Data Directories"
    mkdir -p appdata/scanner-map/{data,audio,logs}
    mkdir -p appdata/icad-transcribe/{log,var}
    
    # Create iCAD .env
    if [[ ! -f "appdata/icad-transcribe/.env" ]]; then
        cat > appdata/icad-transcribe/.env << 'EOF'
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
API_KEY=AUTO_GENERATE_ON_STARTUP
EOF
    fi
    print_success "Data directories created"
    
    # Ensure talkgroups.csv exists (as file, not directory)
    if [[ ! -f "talkgroups.csv" ]]; then
        touch talkgroups.csv
        print_info "Created empty talkgroups.csv file"
    fi
    
    # Start services
    print_header "Starting Docker Services"
    print_info "Building Scanner Map container..."
    if ! docker-compose build scanner-map; then
        print_error "Failed to build container"
        cleanup
        exit 1
    fi
    
    print_info "Starting Scanner Map..."
    if ! docker-compose up -d scanner-map; then
        print_error "Failed to start container"
        cleanup
        exit 1
    fi
    
    print_info "Starting iCAD Transcribe..."
    docker-compose -f docker-compose.full.yml up -d icad-transcribe 2>/dev/null || true
    
    print_success "Services started"
    
    # Verify web pages
    verify_web_pages
    
    # Wait a bit for user to see
    print_header "Installation Verified"
    echo "Web pages are accessible. Waiting 10 seconds before cleanup..."
    sleep 10
    
    # Cleanup
    cleanup
    
    print_header "Development Test Complete"
    print_success "All services tested and cleaned up successfully!"
}

# Run main
main

