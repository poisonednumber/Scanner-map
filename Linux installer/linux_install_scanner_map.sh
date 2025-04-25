#!/bin/bash

# Scanner Map Installation Script for Debian/Ubuntu-based Linux (e.g., Linux Mint)
# --- IMPORTANT ---
# 1. Run this script using: sudo bash linux_install_scanner_map.sh
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
DEFAULT_TRANSCRIPTION_MODE="local" # Default to local mode
DEFAULT_WHISPER_SERVER_URL="http://localhost:8000" # Default remote server URL
DEFAULT_OLLAMA_URL="http://localhost:11434"
DEFAULT_OLLAMA_MODEL_ENV=$OLLAMA_MODEL # Use the same model pulled earlier
DEFAULT_MAPPED_TGS="1001,1002,2001,2002"
DEFAULT_TIMEZONE="US/Eastern"
DEFAULT_ENABLE_AUTH="false"
DEFAULT_TARGET_CITIES="City1,City2,City3,City4"
DEFAULT_SUMMARY_LOOKBACK_HOURS="1" # Added default summary hours


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
  fi
  return $status
}

prompt_yes_no() {
  local prompt_message="$1"
  local default_value="${2:-n}"
  local response
  while true; do
    read -r -p "$prompt_message [Y/n]: " response
    response=${response:-$default_value}
    case "$response" in
      [Yy]* ) return 0;;
      [Nn]* ) return 1;;
      * ) echo "Please answer yes (y) or no (n).";;
    esac
  done
}

prompt_input() {
    local prompt_message="$1"
    local default_value="$2"
    local variable_name="$3"
    local user_input
    read -r -p "$prompt_message [$default_value]: " user_input
    if [[ -z "$user_input" ]]; then
        eval "$variable_name=\"$default_value\""
    else
        user_input=$(echo "$user_input" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
        eval "$variable_name=\"$user_input\""
    fi
}

# --- Installation Steps ---

install_prerequisites() {
  print_message "Updating package lists and installing prerequisites..."
  run_command apt-get update -y || { echo "Failed to update apt lists. Check internet connection and permissions."; exit 1; }
  run_command apt-get install -y git build-essential python3 python3-pip python3-venv ffmpeg nodejs npm curl gpg wget || { echo "Failed to install base packages."; exit 1; }
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

install_nvidia_components() {
  print_message "NVIDIA GPU Components Check (CUDA/cuDNN/cuBLAS)"
  if ! command -v nvidia-smi &> /dev/null; then
      echo "NVIDIA driver not detected (nvidia-smi command not found)."
      echo "Skipping CUDA/cuDNN/cuBLAS installation guidance. If you have an NVIDIA GPU, please install drivers first."
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
    export T_DEVICE="cuda"
    print_message "NVIDIA components require MANUAL installation."
  else
    echo "Skipping NVIDIA components. PyTorch will be installed for CPU."
    export T_DEVICE="cpu"
  fi
}

clone_repo() {
  print_message "Cloning repository into $INSTALL_DIR..."
  if [ -d "$INSTALL_DIR" ]; then
    echo "Directory $INSTALL_DIR already exists."
    if prompt_yes_no "Do you want to remove the existing directory and re-clone?"; then
      rm -rf "$INSTALL_DIR" || sudo rm -rf "$INSTALL_DIR" || { echo "Failed to remove existing directory."; exit 1; }
    else
      echo "Skipping clone. Using existing directory."
      cd "$INSTALL_DIR" || { echo "Failed to navigate to $INSTALL_DIR"; exit 1; }
      return 0
    fi
  fi
  run_command mkdir -p "$INSTALL_DIR" || { echo "Failed to create directory $INSTALL_DIR."; exit 1; }
  local original_user=${SUDO_USER:-$(whoami)}
  local original_group=$(id -gn "$original_user")
  run_command chown "$original_user:$original_group" "$INSTALL_DIR"
  cd "$INSTALL_DIR" || { echo "Failed to navigate to $INSTALL_DIR"; exit 1; }
  sudo -u "$original_user" git clone "$GIT_REPO_URL" . || { echo "Failed to clone repository."; exit 1; }
  run_command chown -R "$original_user:$original_group" "$INSTALL_DIR"
  print_message "Repository cloned."
}

# *** UPDATED FUNCTION ***
create_env_file() {
    print_message "Creating .env configuration file..."
    cd "$INSTALL_DIR" || exit 1
    local env_file=".env"
    local needs_manual_edit=() # Array to track items needing manual input

    if [ -f "$env_file" ]; then
        if ! prompt_yes_no "$env_file already exists. Overwrite it?"; then
            echo "Skipping .env creation. Please configure manually."
            return
        fi
        rm "$env_file"
    fi

    echo "Please provide the following configuration values. Press Enter to accept the default."

    # Helper to append to file
    append_env() { echo "$1" >> "$env_file"; }

    # --- Discord ---
    append_env "#################################################################"
    append_env "##                       DISCORD BOT SETTINGS                  ##"
    append_env "#################################################################"
    append_env ""
    append_env "# Discord Bot Token and Client ID (Required)"
    read -r -p "Enter DISCORD_TOKEN: " discord_token
    if [[ -z "$discord_token" ]]; then
        append_env "DISCORD_TOKEN=your_discord_token_here # <<< MANUALLY EDIT REQUIRED"
        needs_manual_edit+=("DISCORD_TOKEN")
    else
        append_env "DISCORD_TOKEN=$discord_token"
    fi
    # Removed CLIENT_ID prompt
    append_env ""

    # --- Server Ports & Network ---
    append_env "#################################################################"
    append_env "##                  SERVER & NETWORK SETTINGS                  ##"
    append_env "#################################################################"
    append_env ""
    append_env "# Port for incoming SDRTrunk/TrunkRecorder uploads"
    prompt_input "Enter BOT_PORT (for SDRTrunk/TR)" "$DEFAULT_BOT_PORT" bot_port
    append_env "BOT_PORT=$bot_port"
    append_env ""
    append_env "# Port for the web interface/API server"
    prompt_input "Enter WEBSERVER_PORT (e.g., 80, 8080)" "$DEFAULT_WEBSERVER_PORT" webserver_port
    append_env "WEBSERVER_PORT=$webserver_port"
    append_env ""
    append_env "# Public domain name or IP address used for creating audio playback links"
    prompt_input "Enter PUBLIC_DOMAIN (IP or domain name for audio links)" "$DEFAULT_PUBLIC_DOMAIN" public_domain
    append_env "PUBLIC_DOMAIN=$public_domain"
    append_env ""
    append_env "# Timezone for logging timestamps (e.g., US/Eastern, America/Chicago, UTC)"
    prompt_input "Enter TIMEZONE" "$DEFAULT_TIMEZONE" timezone
    append_env "TIMEZONE=$timezone"
    append_env ""

    # --- Auth & API Keys ---
    append_env "#################################################################"
    append_env "##                   AUTHENTICATION & API KEYS                 ##"
    append_env "#################################################################"
    append_env ""
    append_env "# Path to the JSON file containing hashed API keys for SDRTrunk/TR uploads"
    prompt_input "Enter API_KEY_FILE path" "$DEFAULT_API_KEY_FILE" api_key_file
    append_env "API_KEY_FILE=$api_key_file             # Edit and run GenApiKey.js to create/update keys"
    append_env ""
    append_env "# Enable/disable password authentication for the web interface"
    prompt_input "Enable Webserver Authentication? (true/false)" "$DEFAULT_ENABLE_AUTH" enable_auth
    append_env "ENABLE_AUTH=$enable_auth                 # Set to 'true' to enable password login"
    append_env "# Password for web interface login (only used if ENABLE_AUTH=true)"
    if [[ "$enable_auth" == "true" ]]; then
        read -r -p "Enter WEBSERVER_PASSWORD (for web login): " webserver_password
        if [[ -z "$webserver_password" ]]; then
             append_env "WEBSERVER_PASSWORD=your_password # <<< MANUALLY EDIT REQUIRED"
             needs_manual_edit+=("WEBSERVER_PASSWORD (since auth enabled)")
        else
             append_env "WEBSERVER_PASSWORD=$webserver_password"
        fi
    else
         append_env "WEBSERVER_PASSWORD=                     # Run init-admin.js after changing this if auth is enabled"
    fi
    append_env ""

    # --- Transcription ---
    append_env "#################################################################"
    append_env "##                   TRANSCRIPTION SETTINGS                    ##"
    append_env "#################################################################"
    append_env ""
    append_env "# --- Transcription Mode ---"
    append_env "# Select 'local' (requires Python/CUDA setup) or 'remote' (uses API server)"
    prompt_input "Enter TRANSCRIPTION_MODE ('local' or 'remote')" "$DEFAULT_TRANSCRIPTION_MODE" transcription_mode
    append_env "TRANSCRIPTION_MODE=$transcription_mode"
    append_env ""
    append_env "# --- Local Settings (Only used if TRANSCRIPTION_MODE=local) ---"
    append_env "# faster-whisper model (e.g., tiny, base, small, medium, large-v3)"
    prompt_input "Enter WHISPER_MODEL" "$DEFAULT_WHISPER_MODEL" whisper_model
    append_env "WHISPER_MODEL=$whisper_model"
    append_env "# Device for local transcription ('cuda' or 'cpu')"
    if [[ "$transcription_mode" == "local" ]]; then
        prompt_input "Enter TRANSCRIPTION_DEVICE ('cpu' or 'cuda')" "${T_DEVICE:-cpu}" transcription_device
        append_env "TRANSCRIPTION_DEVICE=$transcription_device             # Ignored if mode is 'remote'"
    else
        append_env "TRANSCRIPTION_DEVICE=cuda             # Ignored if mode is 'remote'"
    fi
    append_env ""
    append_env "# --- Remote Settings (Only used if TRANSCRIPTION_MODE=remote) ---"
    append_env "# URL of your running faster-whisper-server/speaches API"
    if [[ "$transcription_mode" == "remote" ]]; then
        prompt_input "Enter FASTER_WHISPER_SERVER_URL" "$DEFAULT_WHISPER_SERVER_URL" whisper_server_url
        append_env "FASTER_WHISPER_SERVER_URL=$whisper_server_url # Ignored if mode is 'local'"
    else
        append_env "FASTER_WHISPER_SERVER_URL=$DEFAULT_WHISPER_SERVER_URL # Ignored if mode is 'local'"
    fi
    append_env ""

    # --- Geocoding ---
    append_env "#################################################################"
    append_env "##                  GEOCODING & LOCATION SETTINGS              ##"
    append_env "#################################################################"
    append_env ""
    append_env "# --- Geocoding API Keys ---"
    append_env "# INSTRUCTIONS:"
    append_env "# 1. Ensure you are using the correct 'geocoding.js' file for your desired provider (Google or LocationIQ)."
    append_env "# 2. Provide the API key ONLY for the provider whose 'geocoding.js' file you are using."
    append_env "# 3. You can comment out the unused key with a '#' to avoid confusion."
    append_env ""
    append_env "# Google Maps API Key (Required ONLY if using the Google version of 'geocoding.js')"
    read -r -p "Enter GOOGLE_MAPS_API_KEY (leave blank if using LocationIQ): " google_maps_key
    if [[ -z "$google_maps_key" ]]; then
        append_env "# GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here"
        needs_manual_edit+=("GOOGLE_MAPS_API_KEY (if using Google geocoding.js)")
    else
        append_env "GOOGLE_MAPS_API_KEY=$google_maps_key"
    fi
    append_env ""
    append_env "# LocationIQ API Key (Required ONLY if using the LocationIQ version of 'geocoding.js')"
    read -r -p "Enter LOCATIONIQ_API_KEY (leave blank if using Google): " location_iq_key
    if [[ -z "$location_iq_key" ]]; then
        append_env "# LOCATIONIQ_API_KEY=your_locationiq_api_key_here"
        needs_manual_edit+=("LOCATIONIQ_API_KEY (if using LocationIQ geocoding.js)")
    else
        append_env "LOCATIONIQ_API_KEY=$location_iq_key"
    fi
    append_env ""
    append_env "# --- Location Hints (Used by both providers) ---"
    append_env "# Default location hints for the geocoder"
    prompt_input "Enter GEOCODING_CITY (Default City)" "$DEFAULT_GEO_CITY" geo_city
    append_env "GEOCODING_CITY=$geo_city        # Default city"
    prompt_input "Enter GEOCODING_STATE (Default State Abbreviation, e.g., ST)" "$DEFAULT_GEO_STATE" geo_state
    append_env "GEOCODING_STATE=$geo_state                    # Default state abbreviation (e.g., MD, VA)"
    prompt_input "Enter GEOCODING_COUNTRY (Default Country Abbreviation)" "$DEFAULT_GEO_COUNTRY" geo_country
    append_env "GEOCODING_COUNTRY=$geo_country                  # Default country abbreviation"
    append_env ""
    append_env "# Target counties for address validation (comma-separated)"
    prompt_input "Enter GEOCODING_TARGET_COUNTIES" "$DEFAULT_GEO_COUNTIES" geo_counties
    append_env "GEOCODING_TARGET_COUNTIES=$geo_counties"
    append_env ""
    append_env "# Target cities for address extraction hints (comma-separated)"
    prompt_input "Enter TARGET_CITIES_LIST" "$DEFAULT_TARGET_CITIES" target_cities_list
    append_env "TARGET_CITIES_LIST=$target_cities_list"
    append_env ""


    # --- LLM & AI Summary ---
    append_env "#################################################################"
    append_env "##                LLM & AI SUMMARY SETTINGS                    ##"
    append_env "#################################################################"
    append_env ""
    append_env "# --- Ollama Settings ---"
    append_env "# URL for your running Ollama instance"
    prompt_input "Enter OLLAMA_URL" "$DEFAULT_OLLAMA_URL" ollama_url
    append_env "OLLAMA_URL=$ollama_url"
    append_env "# Ollama model used for address extraction and summarization"
    prompt_input "Enter OLLAMA_MODEL (e.g., llama3.1:8b)" "$DEFAULT_OLLAMA_MODEL_ENV" ollama_model_env
    append_env "OLLAMA_MODEL=$ollama_model_env"
    append_env ""
    append_env "# --- OpenAI Settings (Optional Alternative) ---"
    append_env "# API Key if using OpenAI instead of Ollama"
    read -r -p "Enter OPENAI_API_KEY (leave blank if using Ollama): " openai_key
    if [[ -z "$openai_key" ]]; then
        append_env "OPENAI_API_KEY= # Leave blank if using Ollama"
    else
        append_env "OPENAI_API_KEY=$openai_key"
        needs_manual_edit+=("OPENAI_API_KEY (if intended)")
    fi
    append_env ""
    append_env "# --- Summary Settings ---"
    append_env "# How many hours back the AI summary should cover"
    prompt_input "Enter SUMMARY_LOOKBACK_HOURS (e.g., 1, 0.5)" "$DEFAULT_SUMMARY_LOOKBACK_HOURS" summary_hours
    append_env "SUMMARY_LOOKBACK_HOURS=$summary_hours"
    append_env ""

    # --- Talk Group Mappings ---
    append_env "#################################################################"
    append_env "##                     TALK GROUP MAPPINGS                     ##"
    append_env "#################################################################"
    append_env ""
    append_env "# --- Address Extraction Mapping ---"
    append_env "# Comma-separated list of Talk Group IDs where address extraction should be attempted"
    append_env "# Recommend using dispatch talkgroups only."
    prompt_input "Enter MAPPED_TALK_GROUPS" "$DEFAULT_MAPPED_TGS" mapped_tgs
    append_env "MAPPED_TALK_GROUPS=$mapped_tgs"
    append_env ""
    append_env "# --- Location Descriptions for Mapped Talk Groups ---"
    append_env "# REQUIRED: Add one line for EACH Talk Group ID listed in MAPPED_TALK_GROUPS above."
    append_env "# Format: TALK_GROUP_<ID>=Location Description for LLM context"
    append_env "# Example: TALK_GROUP_1234=Any Town or Area within Your County ST"
    append_env "# --- MANUALLY EDIT THE FOLLOWING SECTION ---"
    # Split the mapped TGs and add commented out examples
    IFS=',' read -ra tgs_array <<< "$mapped_tgs"
    for tgId in "${tgs_array[@]}"; do
        # Trim whitespace
        tgId=$(echo "$tgId" | sed 's/^[ \t]*//;s/[ \t]*$//')
        if [[ -n "$tgId" ]]; then
            append_env "# TALK_GROUP_${tgId}=<Location Description for $tgId>"
        fi
    done
    append_env "# --- END MANUAL EDIT SECTION ---"
    needs_manual_edit+=("TALK_GROUP_XXXX mappings")
    append_env ""

    # Ensure correct ownership of .env file
    local original_user=${SUDO_USER:-$(whoami)}
    local original_group=$(id -gn "$original_user")
    chown "$original_user:$original_group" "$env_file"

    print_message ".env file created in $INSTALL_DIR"
    # Store the list of items needing manual edit for the final reminder
    # Join array elements into a space-separated string for export
    export MANUAL_EDIT_LIST=$(IFS=' '; echo "${needs_manual_edit[*]}")

}

# *** UPDATED FUNCTION ***
install_node_deps() {
  print_message "Installing Node.js dependencies..."
  cd "$INSTALL_DIR" || exit 1
  # Attempt npm install - Added form-data
  local original_user=${SUDO_USER:-$(whoami)}
  echo "Running npm install as user: $original_user"
  sudo -u "$original_user" npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser form-data
  if [ $? -ne 0 ]; then
      echo "npm install failed. Trying again..."
      sudo -u "$original_user" npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser form-data || echo "Warning: npm install failed again. Please check errors and try running 'npm install' manually as user '$original_user' in $INSTALL_DIR."
  fi
  print_message "Node.js dependency installation attempted."
}

setup_python_venv() {
  print_message "Setting up Python virtual environment and installing dependencies..."
  cd "$INSTALL_DIR" || exit 1
  local original_user=${SUDO_USER:-$(whoami)}
  local original_group=$(id -gn "$original_user")
  echo "Creating Python virtual environment (.venv) as user: $original_user ..."
  sudo -u "$original_user" python3 -m venv .venv || { echo "Failed to create Python venv."; return 1; }
  echo "Activating virtual environment (for this script)..."
  source .venv/bin/activate || { echo "Failed to activate Python venv."; return 1; }
  echo "Upgrading pip..."
  run_command pip install --upgrade pip
  local torch_install_cmd=""
  local use_cuda=false
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
      export T_DEVICE="cpu"
  fi
  run_command $torch_install_cmd || { echo "Failed to install PyTorch."; deactivate; return 1; }
  echo "Installing faster-whisper and python-dotenv..."
  run_command pip install faster-whisper python-dotenv || { echo "Failed to install faster-whisper/python-dotenv."; deactivate; return 1; }
  echo "Deactivating virtual environment."
  deactivate
  print_message "Python environment setup complete."
}

create_dirs() {
  print_message "Creating required directories..."
  cd "$INSTALL_DIR" || exit 1
  local original_user=${SUDO_USER:-$(whoami)}
  local original_group=$(id -gn "$original_user")
  run_command mkdir -p audio
  run_command mkdir -p data
  run_command mkdir -p logs
  run_command chown -R "$original_user:$original_group" audio data logs
  print_message "Directories created."
}

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
    local original_user=${SUDO_USER:-$(whoami)}
    while true; do
        read -r -p "Have you downloaded and saved 'talkgroups.csv' to '$INSTALL_DIR'? [y/n/skip]: " response
        case "$response" in
            [Yy]* )
                if sudo -u "$original_user" [ -f "$talkgroups_file" ]; then
                    echo "Found '$talkgroups_file'. Running import script as user '$original_user'..."
                    cd "$INSTALL_DIR" || exit 1
                    sudo -u "$original_user" node import_csv.js || echo "Warning: Talk group import script encountered an error. Check output."
                    print_message "Talk group import attempted."
                    break
                else
                    echo "Error: '$talkgroups_file' not found in '$INSTALL_DIR' or not accessible by user '$original_user'."
                    echo "Please make sure the file is correctly named and placed, and check permissions."
                fi
                ;;
            [Nn]* )
                echo "Please download the file and place it in the directory, then run this script again or run 'node import_csv.js' manually later as user '$original_user'."
                ;;
            [Ss][Kk][Ii][Pp]* )
                echo "Skipping talk group import. You MUST run 'node import_csv.js' manually later as user '$original_user' after placing the file."
                print_message "Talk group import skipped."
                break
                ;;
            * )
                echo "Please answer yes (y), no (n), or skip (s)."
                ;;
        esac
    done
}

# *** UPDATED FUNCTION ***
manual_steps_reminder() {
  print_message "--- MANUAL CONFIGURATION REQUIRED ---"
  echo "The script has completed the automated steps and created a base .env file."
  echo "You MUST now manually review and potentially edit the following files in '$INSTALL_DIR':"
  echo ""
  echo "1.  '.env' file ('nano $INSTALL_DIR/.env'):"
  echo "    - Verify all values are correct for your setup."
  echo "    - CRITICAL: Add your actual keys/tokens for:"
  local needs_edit_str=""
  for item in $MANUAL_EDIT_LIST; do
      needs_edit_str+="$item, "
  done
  if [[ -n "$needs_edit_str" ]]; then
      needs_edit_str=${needs_edit_str%, }
      echo "      -> $needs_edit_str"
  else
      echo "      -> (Review all placeholders like 'your_..._here')"
  fi
  # *** UPDATED REMINDERS ***
  echo "    - Verify TRANSCRIPTION_MODE is set correctly ('local' or 'remote')."
  echo "    - If remote, ensure FASTER_WHISPER_SERVER_URL is correct."
  echo "    - If local, ensure TRANSCRIPTION_DEVICE is correct ('cuda' or 'cpu')."
  echo "    - Choose the correct 'geocoding.js' file (Google vs LocationIQ) for your setup."
  echo "    - Ensure the corresponding API key (GOOGLE_MAPS_API_KEY or LOCATIONIQ_API_KEY) is uncommented and correct."
  # *** END UPDATED REMINDERS ***
  echo "    - CRITICAL: Add your specific 'TALK_GROUP_XXXX=Location Description' lines."
  echo ""
  echo "2.  'public/config.js' ('nano $INSTALL_DIR/public/config.js'):"
  echo "    - Review map center, zoom, icons, etc."
  echo ""
  echo "3.  API Key for SDRTrunk/TrunkRecorder:"
  echo "    - Edit 'GenApiKey.js' ('nano $INSTALL_DIR/GenApiKey.js') and set your desired secret key."
  echo "    - Run 'node GenApiKey.js' to get the HASHED key."
  echo "    - Create/edit 'data/apikeys.json' ('nano $INSTALL_DIR/data/apikeys.json')."
  echo "    - Add the HASHED key in the format: [{\"key\":\"YOUR_HASHED_KEY_HERE\",\"disabled\":false}]"
  echo ""
  echo "4.  (If Skipped) Import Talk Groups:"
  echo "    - Place 'talkgroups.csv' / 'frequencies.csv' in '$INSTALL_DIR'."
  echo "    - Run 'node import_csv.js' (run as the user who owns the files, e.g., 'sudo -u $SUDO_USER node import_csv.js' if needed)."
  echo ""
  echo "5.  (Optional) Initialize Admin User (if ENABLE_AUTH=true in .env):"
  echo "    - Run 'node init-admin.js' (run as the user who owns the files)."
  echo ""
  echo "--- HOW TO RUN ---"
  echo "1. Open Terminal 1: cd $INSTALL_DIR && source .venv/bin/activate && node bot.js"
  echo "2. Open Terminal 2: cd $INSTALL_DIR && sudo node webserver.js" # Added sudo
  echo "   (Note: 'sudo' might be needed for webserver if using a privileged port like 80 or 443)"
  echo "-------------------------------------"

}

# --- Main Script Execution ---
print_message "Starting Scanner Map Installation..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script using sudo: sudo bash $0"
  exit 1
fi

install_prerequisites
install_ollama
install_nvidia_components # Will prompt user and provide links
clone_repo
create_env_file # Uses updated function
install_node_deps # Uses updated function
setup_python_venv # Will use T_DEVICE set earlier
create_dirs
import_talkgroups # Uses updated function
manual_steps_reminder # Uses updated function

# --- PAUSE ---
print_message "Installation script finished. Please review the manual steps above."
read -r -p "Press Enter to exit the script..."

exit 0