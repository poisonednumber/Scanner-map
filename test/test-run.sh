#!/bin/bash

# ============================================
# Scanner Map Test Runner
# Cleans up runtime files and runs the app
# ============================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

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

# Detect OS for browser opening
open_browser() {
    local url=$1
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        open "$url"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command_exists xdg-open; then
            xdg-open "$url"
        elif command_exists gnome-open; then
            gnome-open "$url"
        else
            print_warning "Could not open browser automatically. Please open: $url"
        fi
    else
        print_warning "Could not open browser automatically. Please open: $url"
    fi
}

# Check if webserver is ready
wait_for_webserver() {
    local port=$1
    local max_attempts=30
    local attempt=1
    
    print_info "Waiting for webserver..."
    
    while [ $attempt -le $max_attempts ]; do
        if command_exists curl; then
            if curl -s -f "http://localhost:$port" >/dev/null 2>&1; then
                return 0
            fi
        elif command_exists wget; then
            if wget -q --spider "http://localhost:$port" >/dev/null 2>&1; then
                return 0
            fi
        else
            # If neither curl nor wget is available, just wait and hope
            sleep 2
            if [ $attempt -eq $max_attempts ]; then
                return 1
            fi
        fi
        
        echo "   Waiting for webserver... (attempt $attempt/$max_attempts)"
        sleep 2
        attempt=$((attempt + 1))
    done
    
    return 1
}

# Get webserver port from .env or use default
get_webserver_port() {
    local port=3001
    if [[ -f ".env" ]]; then
        local env_port=$(grep -i "^WEBSERVER_PORT=" .env 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'" | xargs)
        if [[ -n "$env_port" ]]; then
            port=$env_port
        fi
    fi
    echo $port
}

# Initialize process tracking variables
LOGS_PID=""
TEST_GEN_PID=""
LIVE_RELOAD_PID=""
APP_PID=""

# Cleanup handler for background processes
cleanup_processes() {
    if [[ -n "$LOGS_PID" ]] && kill -0 "$LOGS_PID" 2>/dev/null; then
        kill "$LOGS_PID" 2>/dev/null || true
    fi
    if [[ -n "$TEST_GEN_PID" ]] && kill -0 "$TEST_GEN_PID" 2>/dev/null; then
        kill "$TEST_GEN_PID" 2>/dev/null || true
    fi
    if [[ -n "$LIVE_RELOAD_PID" ]] && kill -0 "$LIVE_RELOAD_PID" 2>/dev/null; then
        kill "$LIVE_RELOAD_PID" 2>/dev/null || true
    fi
    if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
        kill "$APP_PID" 2>/dev/null || true
    fi
}

# Set up trap to cleanup on exit
trap cleanup_processes EXIT INT TERM

# Cleanup function
cleanup_directories() {
    print_info "[1/6] Cleaning up runtime directories..."
    
    if [[ -d "data" ]]; then
        echo "   Removing data directory..."
        rm -rf data
        mkdir -p data
        if [[ -f "data/.gitkeep" ]]; then
            touch data/.gitkeep
        fi
    fi
    
    if [[ -d "audio" ]]; then
        echo "   Removing audio directory..."
        rm -rf audio
    fi
    
    if [[ -d "logs" ]]; then
        echo "   Removing logs directory..."
        rm -rf logs
    fi
    
    if [[ -d "recordings" ]]; then
        echo "   Removing recordings directory..."
        rm -rf recordings
    fi
    
    if [[ -d "appdata" ]]; then
        echo "   Removing appdata directory..."
        rm -rf appdata
    fi
    
    if [[ -d "docker-data" ]]; then
        echo "   Removing docker-data directory..."
        rm -rf docker-data
    fi
}

cleanup_databases() {
    print_info "[2/6] Cleaning up database files..."
    find . -maxdepth 1 -type f \( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" \) -delete 2>/dev/null || true
    find data -maxdepth 1 -type f \( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" \) -delete 2>/dev/null || true
}

cleanup_logs() {
    print_info "[3/6] Cleaning up log files..."
    find . -maxdepth 1 -type f -name "*.log" -delete 2>/dev/null || true
    find logs -type f -name "*.log" -delete 2>/dev/null || true
}

cleanup_api_keys() {
    print_info "[4/6] Cleaning up API keys..."
    if [[ -f "apikeys.json" ]]; then
        echo "   Removing apikeys.json..."
        rm -f apikeys.json
    fi
}

cleanup_temp_files() {
    print_info "[5/6] Cleaning up temporary files..."
    find . -maxdepth 1 -type f \( -name "*.tmp" -o -name "*.temp" -o -name "*.bak" -o -name "*.backup" \) -delete 2>/dev/null || true
}

# Docker mode
run_docker() {
    print_header "Selected: Docker Environment"
    
    # Check if Docker is available
    if ! command_exists docker; then
        print_error "Docker is not installed or not in PATH"
        echo "Please install Docker and try again."
        exit 1
    fi
    
    # Determine docker compose command
    DOCKER_COMPOSE_CMD=""
    if docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    elif command_exists docker-compose; then
        DOCKER_COMPOSE_CMD="docker-compose"
    else
        print_error "Neither 'docker compose' nor 'docker-compose' is available"
        exit 1
    fi
    
    # Check if docker-compose.yml exists
    if [[ ! -f "docker-compose.yml" ]]; then
        print_error "docker-compose.yml not found"
        echo "Please run this script from the Scanner Map project root directory."
        exit 1
    fi
    
    # Cleanup
    cleanup_directories
    cleanup_databases
    cleanup_logs
    cleanup_api_keys
    cleanup_temp_files
    
    print_success "[6/6] Cleanup complete!"
    echo ""
    
    # Stop any running Docker containers
    print_info "[7/7] Stopping existing Docker containers..."
    $DOCKER_COMPOSE_CMD down >/dev/null 2>&1 || true
    
    print_header "Starting Scanner Map with Docker..."
    
    echo "Using: $DOCKER_COMPOSE_CMD"
    echo "Starting services in background..."
    echo ""
    
    # Start services in detached mode
    if ! $DOCKER_COMPOSE_CMD up -d --build; then
        print_error "Failed to start Docker services"
        exit 1
    fi
    
    # Wait a moment for services to start
    sleep 3
    
    # Get webserver port
    WEBSERVER_PORT=$(get_webserver_port)
    
    print_header "Services started. Waiting for webserver..."
    
    # Wait for webserver to be ready
    if wait_for_webserver "$WEBSERVER_PORT"; then
        print_success "Webserver is ready!"
        echo "Opening Setup Wizard in browser..."
        open_browser "http://localhost:$WEBSERVER_PORT/?setup-wizard=1"
        sleep 1
    else
        print_warning "Webserver may not be ready yet. Opening browser anyway..."
        open_browser "http://localhost:$WEBSERVER_PORT/?setup-wizard=1"
    fi
    
    echo ""
    print_header "Showing logs..."
    echo ""
    echo "Press ENTER to stop services and cleanup"
    echo ""
    echo "[Logs from all services - Ctrl+C to stop viewing logs]"
    echo ""
    
    # Show logs in background
    ($DOCKER_COMPOSE_CMD logs -f) &
    LOGS_PID=$!
    
    # Start test event generator in background
    print_info "Starting test event generator..."
    (node scripts/test-event-generator.js) &
    TEST_GEN_PID=$!
    
    # Start live reload watcher (if script exists)
    if [[ -f "scripts/live-reload.sh" ]]; then
        print_info "Starting live reload watcher..."
        (bash scripts/live-reload.sh -m docker -p "$WEBSERVER_PORT" -c "$DOCKER_COMPOSE_CMD") &
        LIVE_RELOAD_PID=$!
        
        echo ""
        print_header "Live Reload Enabled"
        echo "Changes to files will automatically restart services and refresh the browser."
        echo ""
    fi
    
    # Wait for user to press Enter
    read -p "Press ENTER to stop services and cleanup: " cleanup
    
    echo ""
    print_info "Stopping Docker services..."
    $DOCKER_COMPOSE_CMD down
    
    # Kill background processes
    cleanup_processes
    
    print_success "Services stopped."
    final_cleanup
}

# Local mode
run_local() {
    print_header "Selected: Local Execution"
    
    # Cleanup
    cleanup_directories
    cleanup_databases
    cleanup_logs
    cleanup_api_keys
    cleanup_temp_files
    
    print_success "[6/6] Cleanup complete!"
    echo ""
    
    # Check if Node.js is available
    if ! command_exists node; then
        print_error "Node.js is not installed or not in PATH"
        echo "Please install Node.js and try again."
        exit 1
    fi
    
    # Check if bot.js exists
    if [[ ! -f "bot.js" ]]; then
        print_error "bot.js not found"
        echo "Please run this script from the Scanner Map project root directory."
        exit 1
    fi
    
    # Check if node_modules exists
    if [[ ! -d "node_modules" ]]; then
        print_warning "node_modules not found"
        echo "Installing dependencies..."
        if ! npm install; then
            print_error "Failed to install dependencies"
            exit 1
        fi
    fi
    
    print_header "Starting Scanner Map locally..."
    
    echo "Starting application in background..."
    
    # Start the application in background
    node bot.js &
    APP_PID=$!
    
    # Wait a moment for the app to start and create log files
    sleep 3
    
    # Check if logs directory exists, if not create it
    mkdir -p logs
    
    # Get webserver port
    WEBSERVER_PORT=$(get_webserver_port)
    
    print_header "Application started. Waiting for webserver..."
    
    # Wait for webserver to be ready
    if wait_for_webserver "$WEBSERVER_PORT"; then
        print_success "Webserver is ready!"
        echo "Opening Setup Wizard in browser..."
        open_browser "http://localhost:$WEBSERVER_PORT/?setup-wizard=1"
        sleep 1
    else
        print_warning "Webserver may not be ready yet. Opening browser anyway..."
        open_browser "http://localhost:$WEBSERVER_PORT/?setup-wizard=1"
    fi
    
    echo ""
    print_header "Showing logs..."
    echo ""
    echo "Application is running in the background (PID: $APP_PID)."
    echo ""
    
    # Try to show logs if log file exists
    if [[ -f "logs/combined.log" ]]; then
        print_info "Opening log viewer..."
        (tail -f logs/combined.log) &
        LOGS_PID=$!
    else
        # Wait a bit more and try again
        sleep 2
        if [[ -f "logs/combined.log" ]]; then
            print_info "Opening log viewer..."
            (tail -f logs/combined.log) &
            LOGS_PID=$!
        else
            print_info "Note: Log file not found yet. Check console output for messages."
        fi
    fi
    
    # Also check for error.log
    if [[ -f "logs/error.log" ]] && [[ -z "$LOGS_PID" ]]; then
        (tail -f logs/error.log) &
        LOGS_PID=$!
    fi
    
    echo ""
    echo "Press ENTER to stop application and cleanup"
    echo ""
    
    # Start test event generator in background
    print_info "Starting test event generator..."
    (node scripts/test-event-generator.js) &
    TEST_GEN_PID=$!
    
    # Start live reload watcher (if script exists)
    if [[ -f "scripts/live-reload.sh" ]]; then
        print_info "Starting live reload watcher..."
        (bash scripts/live-reload.sh -m local -p "$WEBSERVER_PORT" -a "$APP_PID") &
        LIVE_RELOAD_PID=$!
        
        echo ""
        print_header "Live Reload Enabled"
        echo "Changes to files will automatically restart the application and refresh the browser."
        echo ""
    fi
    
    # Wait for user to press Enter
    read -p "Press ENTER to stop application and cleanup: " cleanup
    
    echo ""
    print_info "Stopping application..."
    
    # Kill the application and background processes
    cleanup_processes
    
    # Also try to find and kill node processes running bot.js
    pkill -f "node.*bot.js" 2>/dev/null || true
    
    print_success "Application stopped."
    final_cleanup
}

# Final cleanup
final_cleanup() {
    echo ""
    print_header "Performing final cleanup..."
    echo ""
    
    print_info "Cleaning up runtime directories..."
    cleanup_directories
    
    print_info "Cleaning up database files..."
    cleanup_databases
    
    print_info "Cleaning up log files..."
    cleanup_logs
    
    print_info "Cleaning up API keys..."
    cleanup_api_keys
    
    print_info "Cleaning up temporary files..."
    cleanup_temp_files
    
    echo ""
    print_header "Cleanup complete!"
    echo ""
}

# Main menu
print_header "Scanner Map Test Runner"

echo "Please select an option:"
echo ""
echo "  1. Run with Docker (Dockerized environment)"
echo "  2. Run locally (Direct Node.js execution)"
echo ""

while true; do
    read -p "Enter your choice (1 or 2): " choice
    
    case $choice in
        1)
            run_docker
            exit 0
            ;;
        2)
            run_local
            exit 0
            ;;
        *)
            echo ""
            echo "Invalid choice. Please enter 1 or 2."
            echo ""
            ;;
    esac
done

