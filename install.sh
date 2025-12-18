#!/bin/bash

# Scanner Map - Unified Installer Script
# Works on Linux, macOS, and Windows (via Git Bash/WSL)
# Uses Node.js-based installer for cross-platform compatibility

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

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    local missing=()
    
    if ! command_exists git; then
        missing+=("git")
    fi
    
    if ! command_exists node; then
        missing+=("node")
    fi
    
    if ! command_exists npm; then
        missing+=("npm")
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
                node|npm)
                    echo "  - Node.js: https://nodejs.org/ (includes npm)"
                    ;;
            esac
        done
        exit 1
    fi
    
    # Check Node.js version
    local node_version=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ $node_version -lt 18 ]]; then
        print_error "Node.js version 18 or higher is required. Current version: $(node --version)"
        exit 1
    fi
    
    print_success "All prerequisites found"
}

# Clone repository
clone_repo() {
    print_header "Cloning Repository"
    
    if [[ -d "Scanner-map" ]]; then
        print_warning "Scanner-map directory already exists"
        read -p "Do you want to remove it and clone fresh? [y/N]: " response
        if [[ "$response" =~ ^[Yy]$ ]]; then
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

# Install npm dependencies for installer
install_installer_deps() {
    print_header "Installing Installer Dependencies"
    
    print_info "Installing npm dependencies..."
    npm install --no-audit --no-fund
    print_success "Dependencies installed"
}

# Main installation
main() {
    print_header "Scanner Map Installer"
    
    echo "This installer will:"
    echo "  1. Check prerequisites (Git, Node.js, npm)"
    echo "  2. Clone the Scanner Map repository (if needed)"
    echo "  3. Install npm dependencies"
    echo "  4. Run interactive installer to configure services"
    echo ""
    
    # Detect OS
    OS="unknown"
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        OS="windows"
    fi
    print_info "Detected OS: $OS"
    
    # Check prerequisites
    check_prerequisites
    
    # Clone repository if needed
    if [[ ! -d "Scanner-map" ]] || [[ ! -f "Scanner-map/package.json" ]]; then
        clone_repo
    else
        if [[ -f "Scanner-map/package.json" ]]; then
            cd Scanner-map 2>/dev/null || {
                print_error "Scanner-map directory not found"
                exit 1
            }
        else
            clone_repo
        fi
    fi
    
    # Install npm dependencies
    install_installer_deps
    
    # Run Node.js installer
    print_header "Starting Interactive Installer"
    print_info "The installer will guide you through configuration..."
    echo ""
    
    node scripts/installer/installer-core.js
    
    print_success "Installation complete!"
}

# Run main function
main "$@"
