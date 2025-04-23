#!/bin/bash

# Scanner Map Installation Script for Debian/Ubuntu-based Linux (e.g., Linux Mint)
# --- IMPORTANT ---
# 1. Run this script using: sudo bash install_scanner_map.sh
# 2. This script assumes you are running a Debian/Ubuntu-based distribution.
# 3. Read the prompts carefully, especially regarding NVIDIA/CUDA installation and .env creation.
# 4. Manual configuration (.env, config.js, apikeys.json) is still required after running this script,
#    especially for API keys and specific talk group mappings.
# 5. Make sure you have a stable internet connection.

# --- Configuration ---
INSTALL_DIR="$HOME/scanner-map" # Default installation directory
GIT_REPO_URL="https://github.com/poisonednumber/Scanner-map.git" # Repository URL
OLLAMA_MODEL="llama3.1:8b" # Ollama model to pull (check README for recommendations)
# Default .env values (from user template)
DEFAULT_BOT_PORT="3306"
DEFAULT_API_KEY_FILE="data/apikeys.json"
DEFAULT_WEBSERVER_PORT="80"
DEFAULT_PUBLIC_DOMAIN="localhost"
DEFAULT_GEO_CITY="City"
DEFAULT_GEO_STATE="ST"
DEFAULT_GEO_COUNTRY="US"
DEFAULT_GEO_COUNTIES="County1,County2"
DEFAULT_WHISPER_MODEL="large-v3"
DEFAULT_OLLAMA_URL="http://localhost:11434"
DEFAULT_OLLAMA_MODEL_ENV=$OLLAMA_MODEL # Use the same model pulled earlier
DEFAULT_MAPPED_TGS="1001,1002,2001,2002"
DEFAULT_TIMEZONE="US/Eastern"
DEFAULT_ENABLE_AUTH="false"
DEFAULT_TARGET_CITIES="City1,City2,City3,City4"

# --- Helper Functions ---
print_message() {
  echo "--------------------------------------------------"
  echo "$1"
  echo "--------------------------------------------------"
}

run_command() {
  echo "Executing: $@"
  "$@"
  local status=$?
  if [ $status -ne 0 ]; then
    echo "Error: Command failed with status $status: $@" >&2
    # Optionally exit on error: exit $status
    # For this script, we'll try to continue
  fi
  return $status
}

prompt_yes_no() {
  local prompt_message="$1"
  local default_value="${2:-n}" # Default to No if not specified
  local response

  while true; do
    # Use -r to prevent backslash interpretation, -p for prompt
    read -r -p "$prompt_message [Y/n]: " response
    response=${response:-$default_value} # Default value if user presses Enter
    case "$response" in
      [Yy]* ) return 0;; # Yes
      [Nn]* ) return 1;; # No
      * ) echo "Please answer yes (y) or no (n).";;
    esac
  done
}

prompt_input() {
    local prompt_message="$1"
    local default_value="$2"
    local variable_name="$3"
    local user_input

    # Display the prompt with the default value
    read -r -p "$prompt_message [$default_value]: " user_input

    # If the user input is empty, use the default value
    if [[ -z "$user_input" ]]; then
        eval "$variable_name=\"$default_value\""
    else
        eval "$variable_name=\"$user_input\""
    fi
}

# --- Installation Steps ---

install_prerequisites() {
  print_message "Updating package lists and installing prerequisites..."
  run_command apt update || { echo "Failed to update apt lists. Check internet connection and permissions."; exit 1; }
  # Added python3-venv here
  run_command apt install -y git build-essential python3 python3-pip python3-venv ffmpeg nodejs npm curl gpg wget || { echo "Failed to install base packages."; exit 1; }
  print_message "Base prerequisites installed."
}

install_ollama() {
  print_message "Installing Ollama..."
  if command -v ollama &> /dev/null; then
      echo "Ollama appears to be already installed."
  else
      run_command curl -fsSL https://ollama.com/install.sh | sh || { echo "Failed to install Ollama."; return 1; }
  fi

  echo "Pulling Ollama model: $OLLAMA_MODEL (this may take a while)..."
  run_command ollama pull "$OLLAMA_MODEL" || echo "Warning: Failed to pull Ollama model. You may need to run 'ollama pull $OLLAMA_MODEL' manually later."
  print_message "Ollama installation attempted."
}

# Updated function: Provides links and instructions for manual NVIDIA component installation
install_nvidia_components() {
  print_message "NVIDIA GPU Components Check (CUDA/cuDNN/cuBLAS)"
  if ! command -v nvidia-smi &> /dev/null; then
      echo "NVIDIA driver not detected (nvidia-smi command not found)."
      echo "Skipping CUDA/cuDNN/cuBLAS installation guidance. If you have an NVIDIA GPU, please install drivers first."
      # Set reminder variable for .env
      export T_DEVICE="cpu"
      return 1
  fi

  if prompt_yes_no "Do you intend to use an NVIDIA GPU for transcription (requires manual CUDA/cuDNN/cuBLAS installation)?"; then
    echo ""
    echo "--- Manual NVIDIA Installation Required ---"
    echo "Okay. Please ensure you have the correct NVIDIA drivers installed."
    echo "You will need to manually install the NVIDIA CUDA Toolkit, cuDNN, and cuBLAS libraries."
    echo "This script will NOT install them automatically."
    echo ""
    echo "Helpful Links (Login likely required):"
    echo "1. CUDA Toolkit: https://developer.nvidia.com/cuda-toolkit-archive"
    echo "   (Choose version matching your driver. Follow NVIDIA's Linux install guide for your distribution)."
    echo "2. cuDNN:        https://developer.nvidia.com/cudnn"
    echo "   (Download the Library for Linux matching your CUDA version. Follow NVIDIA's instructions to install)."
    echo "3. cuBLAS:       https://developer.nvidia.com/cublas"
    echo "   (Often included with CUDA Toolkit. Verify installation or download if needed)."
    echo ""
    echo "After manual installation, make sure to select the 'cuda' option when installing PyTorch below."
    echo "------------------------------------------"
    # Set reminder variable for .env
    export T_DEVICE="cuda"
    print_message "NVIDIA components require MANUAL installation."
  else
    echo "Skipping NVIDIA components. PyTorch will be installed for CPU."
    # Set reminder variable for .env
    export T_DEVICE="cpu"
  fi
}

clone_repo() {
  print_message "Cloning repository into $INSTALL_DIR..."
  if [ -d "$INSTALL_DIR" ]; then
    echo "Directory $INSTALL_DIR already exists."
    if prompt_yes_no "Do you want to remove the existing directory and re-clone?"; then
      run_command rm -rf "$INSTALL_DIR" || { echo "Failed to remove existing directory."; exit 1; }
    else
      echo "Skipping clone. Using existing directory."
      cd "$INSTALL_DIR" || exit 1
      return 0
    fi
  fi
  run_command mkdir -p "$INSTALL_DIR" || { echo "Failed to create directory $INSTALL_DIR."; exit 1; }
  cd "$INSTALL_DIR" || exit 1
  run_command git clone "$GIT_REPO_URL" . || { echo "Failed to clone repository."; exit 1; }
  print_message "Repository cloned."
}

# New function to create .env file interactively
create_env_file() {
    print_message "Creating .env configuration file..."
    cd "$INSTALL_DIR" || exit 1
    local env_file=".env"
    local needs_manual_edit=() # Array to track items needing manual input

    # Check if .env already exists
    if [ -f "$env_file" ]; then
        if ! prompt_yes_no "$env_file already exists. Overwrite it?"; then
            echo "Skipping .env creation. Please configure manually."
            return
        fi
        rm "$env_file"
    fi

    echo "Please provide the following configuration values. Press Enter to accept the default."

    # --- Discord ---
    echo "# Discord Bot Configuration" >> "$env_file"
    read -r -p "Enter DISCORD_TOKEN: " discord_token
    if [[ -z "$discord_token" ]]; then
        echo "DISCORD_TOKEN=your_discord_token_here # <<< MANUALLY EDIT REQUIRED" >> "$env_file"
        needs_manual_edit+=("DISCORD_TOKEN")
    else
        echo "DISCORD_TOKEN=$discord_token" >> "$env_file"
    fi
    read -r -p "Enter CLIENT_ID: " client_id
    if [[ -z "$client_id" ]]; then
        echo "CLIENT_ID=your_client_id_here # <<< MANUALLY EDIT REQUIRED" >> "$env_file"
        needs_manual_edit+=("CLIENT_ID")
    else
        echo "CLIENT_ID=$client_id" >> "$env_file"
    fi
    echo "" >> "$env_file"

    # --- Server Ports ---
    echo "# Server Ports" >> "$env_file"
    prompt_input "Enter BOT_PORT (for SDRTrunk/TR)" "$DEFAULT_BOT_PORT" bot_port
    echo "BOT_PORT=$bot_port" >> "$env_file"
    prompt_input "Enter API_KEY_FILE path" "$DEFAULT_API_KEY_FILE" api_key_file
    echo "API_KEY_FILE=$api_key_file" >> "$env_file"
    prompt_input "Enter WEBSERVER_PORT (e.g., 80, 8080)" "$DEFAULT_WEBSERVER_PORT" webserver_port
    echo "WEBSERVER_PORT=$webserver_port" >> "$env_file"
    prompt_input "Enter PUBLIC_DOMAIN (IP or domain name for audio links)" "$DEFAULT_PUBLIC_DOMAIN" public_domain
    echo "PUBLIC_DOMAIN=$public_domain" >> "$env_file"
    echo "" >> "$env_file"

    # --- Geocoding ---
    echo "# Geocoding Configuration" >> "$env_file"
    read -r -p "Enter GOOGLE_MAPS_API_KEY: " google_maps_key
     if [[ -z "$google_maps_key" ]]; then
        echo "GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here # <<< MANUALLY EDIT REQUIRED" >> "$env_file"
        needs_manual_edit+=("GOOGLE_MAPS_API_KEY")
    else
        echo "GOOGLE_MAPS_API_KEY=$google_maps_key" >> "$env_file"
    fi
    prompt_input "Enter GEOCODING_CITY (Default City)" "$DEFAULT_GEO_CITY" geo_city
    echo "GEOCODING_CITY=$geo_city" >> "$env_file"
    prompt_input "Enter GEOCODING_STATE (Default State Abbreviation, e.g., ST)" "$DEFAULT_GEO_STATE" geo_state
    echo "GEOCODING_STATE=$geo_state" >> "$env_file"
    prompt_input "Enter GEOCODING_COUNTRY (Default Country Abbreviation)" "$DEFAULT_GEO_COUNTRY" geo_country
    echo "GEOCODING_COUNTRY=$geo_country" >> "$env_file"
    prompt_input "Enter GEOCODING_TARGET_COUNTIES (Comma-separated)" "$DEFAULT_GEO_COUNTIES" geo_counties
    echo "GEOCODING_TARGET_COUNTIES=$geo_counties" >> "$env_file"
    echo "" >> "$env_file"

    # --- Transcription ---
    echo "# Transcription Configuration" >> "$env_file"
    prompt_input "Enter WHISPER_MODEL (e.g., tiny, base, small, medium, large-v3)" "$DEFAULT_WHISPER_MODEL" whisper_model
    echo "WHISPER_MODEL=$whisper_model" >> "$env_file"
    # Use the device determined earlier
    prompt_input "Enter TRANSCRIPTION_DEVICE ('cpu' or 'cuda')" "${T_DEVICE:-cpu}" transcription_device
    echo "TRANSCRIPTION_DEVICE=$transcription_device" >> "$env_file"
    echo "" >> "$env_file"

    # --- LLM ---
    echo "# Local LLM Configuration" >> "$env_file"
    prompt_input "Enter OLLAMA_URL" "$DEFAULT_OLLAMA_URL" ollama_url
    echo "OLLAMA_URL=$ollama_url" >> "$env_file"
    prompt_input "Enter OLLAMA_MODEL (e.g., llama3.1:8b)" "$DEFAULT_OLLAMA_MODEL_ENV" ollama_model_env
    echo "OLLAMA_MODEL=$ollama_model_env" >> "$env_file"
    echo "" >> "$env_file"

    # --- OpenAI (Optional) ---
    echo "# Optional: OpenAI Configuration (alternative to Ollama)" >> "$env_file"
    read -r -p "Enter OPENAI_API_KEY (leave blank if using Ollama): " openai_key
    if [[ -z "$openai_key" ]]; then
        echo "OPENAI_API_KEY= # <<< Optional: Add key here if using OpenAI" >> "$env_file"
    else
        echo "OPENAI_API_KEY=$openai_key" >> "$env_file"
        needs_manual_edit+=("OPENAI_API_KEY (if intended)")
    fi
    echo "" >> "$env_file"

    # --- Talk Groups ---
    echo "# Talk Groups" >> "$env_file"
    prompt_input "Enter MAPPED_TALK_GROUPS (Comma-separated IDs for address extraction)" "$DEFAULT_MAPPED_TGS" mapped_tgs
    echo "MAPPED_TALK_GROUPS=$mapped_tgs" >> "$env_file"
    echo "" >> "$env_file"

    # --- Timezone ---
    echo "# Timezone" >> "$env_file"
    prompt_input "Enter TIMEZONE (e.g., US/Eastern, America/Chicago, UTC)" "$DEFAULT_TIMEZONE" timezone
    echo "TIMEZONE=$timezone" >> "$env_file"
    echo "" >> "$env_file"

    # --- Authentication ---
    echo "# Authentication" >> "$env_file"
    prompt_input "Enable Webserver Authentication? (true/false)" "$DEFAULT_ENABLE_AUTH" enable_auth
    echo "ENABLE_AUTH=$enable_auth" >> "$env_file"
    # Only ask for password if auth is enabled
    if [[ "$enable_auth" == "true" ]]; then
        read -r -p "Enter WEBSERVER_PASSWORD (for web login): " webserver_password
        if [[ -z "$webserver_password" ]]; then
             echo "WEBSERVER_PASSWORD=your_password # <<< MANUALLY EDIT REQUIRED" >> "$env_file"
             needs_manual_edit+=("WEBSERVER_PASSWORD (since auth enabled)")
        else
             echo "WEBSERVER_PASSWORD=$webserver_password" >> "$env_file"
        fi
    else
         echo "WEBSERVER_PASSWORD= # Authentication disabled" >> "$env_file"
    fi
    echo "" >> "$env_file"

    # --- Talk Group Mappings (Manual Edit Required) ---
    echo "# Talk Groups mapping (format: ID=Location)" >> "$env_file"
    echo "# --- MANUALLY EDIT THE FOLLOWING SECTION ---" >> "$env_file"
    echo "# Add one line for EACH talk group ID listed in MAPPED_TALK_GROUPS above." >> "$env_file"
    echo "# Example format:" >> "$env_file"
    echo "# TALK_GROUP_1001=City1 or any town in County1 ST" >> "$env_file"
    echo "# TALK_GROUP_1002=City2 or any town in County1 ST" >> "$env_file"
    echo "# TALK_GROUP_2001=City3 or any town in County2 ST" >> "$env_file"
    echo "# TALK_GROUP_2002=City4 or any town in County2 ST" >> "$env_file"
    echo "# --- END MANUAL EDIT SECTION ---" >> "$env_file"
    needs_manual_edit+=("TALK_GROUP_XXXX mappings")
    echo "" >> "$env_file"

    # --- Target Cities ---
    echo "# Target Cities (comma-separated list of cities in your target areas)" >> "$env_file"
    prompt_input "Enter TARGET_CITIES_LIST (Comma-separated)" "$DEFAULT_TARGET_CITIES" target_cities_list
    echo "TARGET_CITIES_LIST=$target_cities_list" >> "$env_file"
    echo "" >> "$env_file"


    print_message ".env file created in $INSTALL_DIR"
    # Store the list of items needing manual edit for the final reminder
    export MANUAL_EDIT_LIST="${needs_manual_edit[*]}"

}


install_node_deps() {
  print_message "Installing Node.js dependencies..."
  # Navigate to install dir just in case
  cd "$INSTALL_DIR" || exit 1
  # Attempt npm install
  run_command npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser
  if [ $? -ne 0 ]; then
      echo "npm install failed. Trying again..."
      run_command npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser || echo "Warning: npm install failed again. Please check errors and try running 'npm install' manually in $INSTALL_DIR."
  fi
  print_message "Node.js dependency installation attempted."
}

setup_python_venv() {
  print_message "Setting up Python virtual environment and installing dependencies..."
  cd "$INSTALL_DIR" || exit 1

  echo "Creating Python virtual environment (.venv)..."
  run_command python3 -m venv .venv || { echo "Failed to create Python venv."; return 1; }

  echo "Activating virtual environment..."
  # Note: Activation is temporary for the script's context. User needs to activate manually later.
  source .venv/bin/activate || { echo "Failed to activate Python venv."; return 1; }

  echo "Upgrading pip..."
  run_command pip install --upgrade pip

  # Ask user about GPU/CPU for PyTorch based on previous NVIDIA choice
  local torch_install_cmd=""
  local use_cuda=false
  # Use the T_DEVICE variable exported from the nvidia function
  if [[ "$T_DEVICE" == "cuda" ]]; then
      if prompt_yes_no "Install PyTorch with CUDA support (based on your earlier choice)?"; then
          use_cuda=true
      fi
  fi

  if $use_cuda; then
      echo "Please specify your CUDA version for PyTorch (e.g., 11.8, 12.1). Check https://pytorch.org/get-started/locally/"
      read -r -p "Enter CUDA version (leave blank to attempt latest): " cuda_version
      if [[ -z "$cuda_version" ]]; then
           echo "Attempting PyTorch install for latest CUDA (usually 12.1)..."
           torch_install_cmd="pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
      elif [[ "$cuda_version" == "11.8" ]]; then
           echo "Installing PyTorch for CUDA 11.8..."
           torch_install_cmd="pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118"
      elif [[ "$cuda_version" == "12.1" ]]; then
           echo "Installing PyTorch for CUDA 12.1..."
           torch_install_cmd="pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
      else
           echo "Warning: Unsupported CUDA version specified. Attempting latest CUDA 12.1 install."
           torch_install_cmd="pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
      fi
  else
      echo "Installing CPU-only version of PyTorch..."
      torch_install_cmd="pip install torch torchvision torchaudio"
      # Ensure T_DEVICE is cpu if GPU wasn't chosen here
      export T_DEVICE="cpu"
  fi

  run_command $torch_install_cmd || { echo "Failed to install PyTorch."; deactivate; return 1; }

  echo "Installing faster-whisper and python-dotenv..."
  run_command pip install faster-whisper python-dotenv || { echo "Failed to install faster-whisper/python-dotenv."; deactivate; return 1; }

  # Optional: Install specific ctranslate2 version (add prompt if needed)
  # echo "Check README if a specific ctranslate2 version is needed for your CUDA setup."
  # run_command pip install --force-reinstall ctranslate2==<version>

  echo "Deactivating virtual environment."
  deactivate
  print_message "Python environment setup complete."
}

create_dirs() {
  print_message "Creating required directories..."
  cd "$INSTALL_DIR" || exit 1
  run_command mkdir -p audio
  run_command mkdir -p data
  run_command mkdir -p logs # Added logs directory based on webserver.js
  print_message "Directories created."
}

# Updated function to handle talk group import
import_talkgroups() {
    print_message "Import Talk Group Data (Required)"
    echo "This application requires talk group data exported from RadioReference.com."
    echo "1. Go to RadioReference.com and find your desired trunked radio system."
    echo "2. Look for an option to export talk groups (usually requires a Premium Subscription)."
    echo "3. Export the talk groups as a CSV file."
    echo "4. Save the file as 'talkgroups.csv' inside the '$INSTALL_DIR' directory."
    echo "5. (Optional) Export frequencies as 'frequencies.csv' and save it in the same directory."
    echo ""

    local talkgroups_file="$INSTALL_DIR/talkgroups.csv"

    while true; do
        read -r -p "Have you downloaded and saved 'talkgroups.csv' to '$INSTALL_DIR'? [y/n/skip]: " response
        case "$response" in
            [Yy]* )
                if [ -f "$talkgroups_file" ]; then
                    echo "Found '$talkgroups_file'. Running import script..."
                    cd "$INSTALL_DIR" || exit 1
                    run_command node import_csv.js || echo "Warning: Talk group import script encountered an error. Check output."
                    print_message "Talk group import attempted."
                    break
                else
                    echo "Error: '$talkgroups_file' not found in '$INSTALL_DIR'."
                    echo "Please make sure the file is correctly named and placed."
                fi
                ;;
            [Nn]* )
                echo "Please download the file and place it in the directory, then run this script again or run 'node import_csv.js' manually later."
                # Optionally pause here again if needed
                # read -r -p "Press Enter when ready to continue..."
                ;;
            [Ss][Kk][Ii][Pp]* )
                echo "Skipping talk group import. You MUST run 'node import_csv.js' manually later after placing the file."
                print_message "Talk group import skipped."
                break
                ;;
            * )
                echo "Please answer yes (y), no (n), or skip (s)."
                ;;
        esac
    done
}


manual_steps_reminder() {
  print_message "--- MANUAL CONFIGURATION REQUIRED ---"
  echo "The script has completed the automated steps and created a base .env file."
  echo "You MUST now manually review and potentially edit the following files in '$INSTALL_DIR':"
  echo ""
  echo "1.  '.env' file ('nano .env'):"
  echo "    - Verify all values are correct for your setup."
  echo "    - CRITICAL: Add your actual keys/tokens for:"
  # List items that definitely need manual input based on the env creation function
  local needs_edit_str=""
  for item in $MANUAL_EDIT_LIST; do
      needs_edit_str+="$item, "
  done
  # Remove trailing comma and space
  needs_edit_str=${needs_edit_str%, }
  echo "      -> $needs_edit_str"
  echo "    - CRITICAL: Add your specific 'TALK_GROUP_XXXX=Location Description' lines."
  echo ""
  echo "2.  'public/config.js' ('nano public/config.js'):"
  echo "    - Review map center, zoom, icons, etc."
  echo ""
  echo "3.  API Key for SDRTrunk/TrunkRecorder:"
  echo "    - Edit 'GenApiKey.js' ('nano GenApiKey.js') and set your desired secret key."
  echo "    - Run 'node GenApiKey.js' to get the HASHED key."
  echo "    - Create/edit 'data/apikeys.json' ('nano data/apikeys.json')."
  echo "    - Add the HASHED key in the format: [{\"key\":\"YOUR_HASHED_KEY_HERE\",\"disabled\":false}]"
  echo ""
  echo "4.  (If Skipped) Import Talk Groups:"
  echo "    - Place 'talkgroups.csv' / 'frequencies.csv' in '$INSTALL_DIR'."
  echo "    - Run 'node import_csv.js'."
  echo ""
  echo "5.  (Optional) Initialize Admin User (if ENABLE_AUTH=true in .env):"
  echo "    - Run 'node init-admin.js'."
  echo ""
  echo "--- HOW TO RUN ---"
  echo "1. Open Terminal 1: cd $INSTALL_DIR && source .venv/bin/activate && node bot.js"
  echo "2. Open Terminal 2: cd $INSTALL_DIR && sudo node webserver.js" # Added sudo
  echo "   (Note: 'sudo' might be needed for webserver if using a privileged port like 80 or 443)"
  echo "-------------------------------------"

}

# --- Main Script Execution ---
print_message "Starting Scanner Map Installation..."

install_prerequisites
install_ollama
install_nvidia_components # Will prompt user and provide links
clone_repo
create_env_file # New step
install_node_deps
setup_python_venv # Will use T_DEVICE set earlier
create_dirs
import_talkgroups # New interactive step
manual_steps_reminder

# --- PAUSE ---
print_message "Installation script finished. Please review the manual steps above."
read -r -p "Press Enter to exit the script..."

exit 0
