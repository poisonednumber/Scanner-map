#!/bin/bash

# Scanner Map - Linux/macOS Installer
# Run this script from the repository root or from a parent directory

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Print helpers
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

# Detect operating system
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

# Check all prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    local missing=()
    
    # Check Git
    if command_exists git; then
        print_success "Git found"
    else
        missing+=("git")
        print_error "Git not found"
    fi
    
    # Check Node.js
    if command_exists node; then
        local node_version=$(node --version | sed 's/v//' | cut -d. -f1)
        if [[ $node_version -ge 18 ]]; then
            # Warn about very new Node.js versions
            if [[ $node_version -ge 23 ]]; then
                print_warning "Node.js v$node_version detected. This is a very new version."
                echo "        Some native modules may not have prebuilt binaries yet."
                echo "        If you encounter build errors, consider using Node.js LTS (v22 or v20)."
                echo ""
            fi
            print_success "Node.js $(node --version)"
        else
            print_error "Node.js version 18+ required (found $(node --version))"
            missing+=("node")
        fi
    else
        missing+=("node")
        print_error "Node.js not found"
    fi
    
    # Check npm
    if command_exists npm; then
        print_success "npm found"
    else
        missing+=("npm")
        print_error "npm not found"
    fi
    
    # Report missing tools
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo ""
        print_error "Missing required tools: ${missing[*]}"
        echo ""
        echo "Please install the missing tools:"
        for tool in "${missing[@]}"; do
            case "$tool" in
                git)
                    echo "  - Git: https://git-scm.com/downloads"
                    ;;
                node|npm)
                    echo "  - Node.js (includes npm): https://nodejs.org/"
                    ;;
            esac
        done
        exit 1
    fi
    
    print_success "All prerequisites met"
}

# Navigate to repository directory
find_repository() {
    # Already in the repository?
    if [[ -f "package.json" && -f "scripts/installer/installer-core.js" ]]; then
        print_success "Running from Scanner Map repository"
        return 0
    fi
    
    # Check for Scanner-map subdirectory
    if [[ -d "Scanner-map" && -f "Scanner-map/package.json" ]]; then
        print_success "Found Scanner-map directory"
        cd Scanner-map
        return 0
    fi
    
    # Repository not found - offer to clone
    print_warning "Scanner Map repository not found"
    echo ""
    read -p "Would you like to clone it now? [Y/n]: " response
    response=${response:-Y}
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        print_info "Cloning Scanner Map repository..."
        git clone https://github.com/poisonednumber/Scanner-map.git
        cd Scanner-map
        print_success "Repository cloned successfully"
        return 0
    else
        echo ""
        echo "To install manually:"
        echo "  git clone https://github.com/poisonednumber/Scanner-map.git"
        echo "  cd Scanner-map"
        echo "  ./install.sh"
        exit 1
    fi
}

# Install npm dependencies
install_dependencies() {
    print_header "Installing Dependencies"
    
    if [[ -d "node_modules" ]]; then
        print_success "Dependencies already installed"
    else
        print_info "Installing npm dependencies..."
        
        # Check if npm is available
        if ! command_exists npm; then
            print_warning "npm not found in PATH"
            print_info "Node.js may have been just installed."
            echo ""
            print_info "The installer needs to be restarted for PATH to update."
            echo ""
            read -p "Restart installer now? [Y/n]: " restart
            restart=${restart:-Y}
            
            if [[ "$restart" =~ ^[Yy]$ ]]; then
                update_and_restart "$@"
            else
                echo ""
                echo "Please restart the installer manually after Node.js is available in PATH."
                echo "Run: bash install.sh"
                exit 1
            fi
        fi
        
        # Use --ignore-optional to skip native modules that fail to build
        # Use --no-audit --no-fund to speed up installation
        if ! npm install --ignore-optional --no-audit --no-fund 2>&1; then
            print_error "Failed to install npm dependencies"
            echo ""
            
            # Check if npm is still available (might have been a PATH issue)
            if ! command_exists npm; then
                print_warning "npm not found in PATH"
                print_info "Node.js may have been just installed."
                echo ""
                print_info "The installer needs to be restarted for PATH to update."
                echo ""
                read -p "Restart installer now? [Y/n]: " restart
                restart=${restart:-Y}
                
                if [[ "$restart" =~ ^[Yy]$ ]]; then
                    update_and_restart "$@"
                else
                    echo ""
                    echo "Please restart the installer manually after Node.js is available in PATH."
                    echo "Run: bash install.sh"
                    exit 1
                fi
            else
                echo "Common fixes:"
                echo "  1. Delete node_modules folder and try again"
                echo "  2. Run: npm cache clean --force"
                echo "  3. Check your internet connection"
                echo "  4. If using Node.js v23+, try Node.js v22 LTS instead"
                exit 1
            fi
        fi
        
        print_success "Dependencies installed successfully"
    fi
}

# Main function
main() {
    print_header "Scanner Map Installer"
    
    local os=$(detect_os)
    print_info "Detected OS: $os"
    
    echo ""
    echo "This installer will:"
    echo "  1. Check prerequisites (Git, Node.js, npm)"
    echo "  2. Clone the repository if needed"
    echo "  3. Install npm dependencies"
    echo "  4. Run interactive setup"
    echo ""
    
    # Step 1: Check prerequisites
    check_prerequisites
    
    # Step 2: Find or clone repository
    find_repository
    
    # Step 3: Install dependencies
    install_dependencies
    
    # Step 4: Run interactive installer
    print_header "Starting Interactive Setup"
    print_info "The installer will guide you through configuration..."
    echo ""
    
    node scripts/installer/installer-core.js
    
    print_success "Setup complete!"
}

# Update and restart function
update_and_restart() {
    # Check if we're in a git repository
    if git rev-parse --git-dir >/dev/null 2>&1; then
        print_info "Checking for project updates..."
        
        # Fetch latest changes without merging
        if git fetch origin >/dev/null 2>&1; then
            # Check if there are updates available
            if ! git diff HEAD origin/HEAD --quiet >/dev/null 2>&1; then
                print_info "Updates available. Pulling latest changes..."
                # Store the commit before pull to check what changed
                local before_pull=$(git rev-parse HEAD 2>/dev/null)
                
                if git pull origin; then
                    print_success "Project updated successfully"
                    
                    # Check if package.json changed in the pull (need to rebuild dependencies)
                    if [[ -n "$before_pull" ]] && git diff "$before_pull" HEAD --name-only 2>/dev/null | grep -q "package.json"; then
                        print_info "package.json changed. Rebuilding dependencies..."
                        if [[ -d "node_modules" ]]; then
                            rm -rf node_modules
                        fi
                        if npm install --ignore-optional --no-audit --no-fund; then
                            print_success "Dependencies rebuilt successfully"
                        else
                            print_warning "Dependency rebuild had issues, but continuing..."
                        fi
                    fi
                else
                    print_warning "Failed to pull updates, but continuing with restart..."
                fi
            else
                print_info "Project is up to date"
            fi
        else
            print_warning "Could not check for updates (not a git repo or no network)"
        fi
    else
        print_info "Not a git repository, skipping update check"
    fi
    
    echo ""
    print_info "Waiting 3 seconds for PATH to update..."
    sleep 3
    print_info "Restarting installer..."
    echo ""
    exec "$0" "$@"
}

# Run main function
main "$@"




