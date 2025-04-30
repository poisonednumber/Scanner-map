#Requires -RunAsAdministrator

<#
.SYNOPSIS
 Installs prerequisites and sets up the Scanner Map project on Windows.
.DESCRIPTION
 This script automates the installation of Node.js, Python, Git, FFmpeg,
 VS Build Tools, and Ollama using winget. It clones the repository,
 installs dependencies, interactively creates a base .env file, guides
 through talk group import, and reminds the user about required manual steps.
.NOTES
 - Run this script from an Administrator PowerShell window.
 - You may need to set the execution policy: Set-ExecutionPolicy RemoteSigned -Scope Process -Force
 - Manual configuration (.env, config.js, apikeys.json) is REQUIRED after running,
   especially for API keys and specific talk group mappings.
 - Ensure Node.js, Python, Git, FFmpeg are added to PATH during installation.
 - NVIDIA CUDA/cuDNN/cuBLAS installation requires manual steps (links provided).
#>

# --- Configuration ---
$InstallDir = "$HOME\scanner-map" # Default installation directory (e.g., C:\Users\YourUser\scanner-map)
$GitRepoUrl = "https://github.com/poisonednumber/Scanner-map.git" # Repository URL
$OllamaModel = "llama3.1:8b" # Ollama model to pull (check README for recommendations)
# Default .env values (from user template)
$DefaultBotPort = "3306"
$DefaultApiKeyFile = "data/apikeys.json"
$DefaultWebserverPort = "80"
$DefaultPublicDomain = "localhost"
$DefaultGeoCity = "City"
$DefaultGeoState = "ST"
$DefaultGeoCountry = "US"
$DefaultGeoCounties = "County1,County2"
$DefaultWhisperModel = "large-v3"
$DefaultTranscriptionMode = "local" # Default to local mode
$DefaultWhisperServerUrl = "http://localhost:8000" # Default remote server URL
$DefaultOllamaUrl = "http://localhost:11434"
$DefaultOllamaModelEnv = $OllamaModel # Use the same model pulled earlier
$DefaultMappedTgs = "1001,1002,2001,2002"
$DefaultTimezone = "US/Eastern"
$DefaultEnableAuth = "false"
$DefaultTargetCities = "City1,City2,City3,City4"
$DefaultSummaryLookbackHours = "1" # Added default summary hours
$DefaultAskAiLookbackHours = "8"   # <-- Add this default
# --- NEW: Storage Defaults ---
$DefaultStorageMode = "local" # Default to local
$DefaultS3Endpoint = ""
$DefaultS3BucketName = ""

# Initialize script-level variables
$script:PyTorchDevice = "cpu" # Default to CPU
$script:ManualEditList = New-Object System.Collections.ArrayList # Initialize list for .env items needing manual edit

# --- Helper Functions ---
function Print-Message {
    param([string]$Message)
    Write-Host "--------------------------------------------------" -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "--------------------------------------------------" -ForegroundColor Cyan
}

function Run-Command {
    param([scriptblock]$Command, [string]$ErrorMessage)
    Write-Host "Executing: $($Command.ToString())"
    Invoke-Command -ScriptBlock $Command
    if (-not $?) {
        Write-Warning "Warning: Command may have failed: $ErrorMessage"
    }
}

function Prompt-YesNo {
    param([string]$PromptMessage, [string]$Default = 'n')
    $choiceYes = New-Object System.Management.Automation.Host.ChoiceDescription("&Yes", "Confirm Yes.")
    $choiceNo = New-Object System.Management.Automation.Host.ChoiceDescription("&No", "Confirm No.")
    $choices = [System.Management.Automation.Host.ChoiceDescription[]]($choiceYes, $choiceNo)
    $options = [System.Management.Automation.Host.ChoiceDescription[]]$choices
    $result = $Host.UI.PromptForChoice("Confirmation", $PromptMessage, $options, $(if($Default -eq 'y') {0} else {1}))
    return $result -eq 0 # Returns $true for Yes, $false for No
}

function Prompt-Input {
    param(
        [string]$PromptMessage,
        [string]$DefaultValue
    )
    $userInput = Read-Host -Prompt "$PromptMessage [$DefaultValue]"
    if ([string]::IsNullOrWhiteSpace($userInput)) {
        return $DefaultValue
    } else {
        return $userInput
    }
}


# --- Installation Steps ---

function Install-Prerequisites {
    Print-Message "Checking winget and installing prerequisites..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Error "winget is not available. Please install the App Installer from the Microsoft Store."
        exit 1
    }
    Write-Host "Installing/Upgrading Node.js LTS..."
    Run-Command { winget install --exact --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements } "Failed to install Node.js LTS."
    Write-Host "Installing/Upgrading Python 3.10+..."
    Run-Command { winget install --exact --id Python.Python.3.11 --source winget --accept-package-agreements --accept-source-agreements } "Failed to install Python."
    Write-Host "Installing/Upgrading Git..."
    Run-Command { winget install --exact --id Git.Git --source winget --accept-package-agreements --accept-source-agreements } "Failed to install Git."
    Write-Host "Installing/Upgrading Visual Studio Build Tools (This may take a significant amount of time)..."
    Run-Command { winget install --exact --id Microsoft.VisualStudio.2022.BuildTools --source winget --accept-package-agreements --accept-source-agreements --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" } "Failed to install VS Build Tools."
    Write-Host "Installing/Upgrading FFmpeg..."
    Run-Command { winget install --exact --id Gyan.FFmpeg --source winget --accept-package-agreements --accept-source-agreements } "Failed to install FFmpeg."
    Write-Host "Verifying FFmpeg (check output manually)..."
    Start-Sleep -Seconds 2
    ffmpeg -version -hide_banner -loglevel error
    if (-not $?) { Write-Warning "ffmpeg command not found or failed. Ensure it's installed and in your PATH." }
    Print-Message "Base prerequisites installation attempted. Please ensure they were added to your system PATH."
}

function Install-Ollama {
    Print-Message "Installing Ollama..."
    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        Write-Host "Ollama appears to be already installed."
    } else {
        Write-Host "Downloading Ollama installer..."
        $ollamaInstaller = "$env:TEMP\OllamaSetup.exe"
        try {
            Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $ollamaInstaller -ErrorAction Stop
            Write-Host "Running Ollama installer (requires manual interaction)..."
            Start-Process -FilePath $ollamaInstaller -ArgumentList "/SILENT" -Wait
            Start-Sleep -Seconds 5
            if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
                 Write-Warning "Ollama installation may not have completed successfully or PATH not updated yet. Please check manually."
            }
        } catch {
            $caughtError = $_
            Write-Error "Failed to download or run Ollama installer: $($caughtError.Exception.Message)"
            return
        } finally {
            if (Test-Path $ollamaInstaller) { Remove-Item $ollamaInstaller -Force }
        }
    }
    Write-Host "Pulling Ollama model: $OllamaModel (this may take a while)..."
     if (Get-Command ollama -ErrorAction SilentlyContinue) {
        ollama pull "$OllamaModel"
     } else {
         Write-Warning "Cannot pull Ollama model because the 'ollama' command was not found. Please run 'ollama pull $OllamaModel' manually after installation."
     }
    Print-Message "Ollama installation attempted."
}

function Install-NvidiaComponents {
    Print-Message "NVIDIA GPU Components Check (CUDA/cuDNN/cuBLAS)"
    $nvidiaSmiPath = Join-Path $env:SystemRoot "System32\nvidia-smi.exe"
    if (-not (Test-Path $nvidiaSmiPath)) {
        Write-Host "NVIDIA driver not detected ($nvidiaSmiPath not found)."
        Write-Host "Skipping CUDA/cuDNN/cuBLAS steps. If you have an NVIDIA GPU, please install drivers first."
        $script:PyTorchDevice = "cpu"
        return
    }
    if (Prompt-YesNo "Do you intend to use an NVIDIA GPU for transcription (requires manual CUDA/cuDNN/cuBLAS installation)?") {
        Write-Host ""
        Write-Host "--- Manual NVIDIA Installation Required ---" -ForegroundColor Yellow
        Write-Host "Okay. Please ensure you have the correct NVIDIA drivers installed."
        Write-Host "You will need to manually install the NVIDIA CUDA Toolkit, cuDNN, and cuBLAS libraries."
        Write-Host "This script will NOT install them automatically but will provide links."
        Write-Host ""
        Write-Host "Helpful Links (Login likely required):" -ForegroundColor Yellow
        Write-Host "1. CUDA Toolkit: https://developer.nvidia.com/cuda-toolkit-archive"
        Write-Host "   (Choose version compatible with your NVIDIA driver. Download and run the installer)."
        Write-Host "2. cuDNN:        https://developer.nvidia.com/cudnn"
        Write-Host "   (Download the Library ZIP matching your CUDA version. Follow NVIDIA's instructions to extract and copy files)."
        Write-Host "3. cuBLAS:       https://developer.nvidia.com/cublas"
        Write-Host "   (Often included with CUDA Toolkit. Verify installation or download if needed)."
        Write-Host ""
        Write-Host "After manual installation, select the 'cuda' option when installing PyTorch below." -ForegroundColor Yellow
        Write-Host "------------------------------------------" -ForegroundColor Yellow
        $script:PyTorchDevice = "cuda"
        Print-Message "NVIDIA components require MANUAL installation."
    } else {
        Write-Host "Skipping NVIDIA components. PyTorch will be installed for CPU."
        $script:PyTorchDevice = "cpu"
    }
}

function Clone-Repo {
    Print-Message "Cloning repository into $InstallDir..."
    if (Test-Path $InstallDir) {
        Write-Host "Directory $InstallDir already exists."
        if (Prompt-YesNo "Do you want to remove the existing directory and re-clone?") {
            Write-Host "Removing existing directory..."
            Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
            if ($?) { Write-Host "Removed." } else { Write-Error "Failed to remove existing directory."; exit 1 }
        } else {
            Write-Host "Skipping clone. Using existing directory."
            Set-Location $InstallDir
            return
        }
    }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Set-Location $InstallDir
    Run-Command { git clone $GitRepoUrl . } "Failed to clone repository."
    Print-Message "Repository cloned."
}

# *** UPDATED FUNCTION ***
function Create-EnvFile {
    Print-Message "Creating .env configuration file..."
    Set-Location $InstallDir
    $envFile = ".\.env"
    $script:ManualEditList.Clear() # Clear any previous values

    if (Test-Path $envFile) {
        if (-not (Prompt-YesNo "$envFile already exists. Overwrite it?")) {
            Write-Host "Skipping .env creation. Please configure manually."
            return
        }
        Remove-Item $envFile -Force
    }

    Write-Host "Please provide the following configuration values. Press Enter to accept the default."
    $envContent = @()

    # --- Discord ---
    $envContent += "#################################################################"
    $envContent += "##                       DISCORD BOT SETTINGS                  ##"
    $envContent += "#################################################################"
    $envContent += ""
    $envContent += "# Discord Bot Token and Client ID (Required)"
    $discordToken = Read-Host -Prompt "Enter DISCORD_TOKEN"
    if ([string]::IsNullOrWhiteSpace($discordToken)) {
        $envContent += "DISCORD_TOKEN=your_discord_token_here # <<< MANUALLY EDIT REQUIRED"
        [void]$script:ManualEditList.Add("DISCORD_TOKEN")
    } else {
        $envContent += "DISCORD_TOKEN=$discordToken"
    }
    # $clientId = Read-Host -Prompt "Enter CLIENT_ID" # Removed as it's not used in bot.js provided
    $envContent += ""

    # --- Server Ports ---
    $envContent += "#################################################################"
    $envContent += "##                  SERVER & NETWORK SETTINGS                  ##"
    $envContent += "#################################################################"
    $envContent += ""
    $envContent += "# Port for incoming SDRTrunk/TrunkRecorder uploads"
    $botPort = Prompt-Input "Enter BOT_PORT (for SDRTrunk/TR)" $DefaultBotPort
    $envContent += "BOT_PORT=$botPort"
    $envContent += ""
    $envContent += "# Port for the web interface/API server"
    $webserverPort = Prompt-Input "Enter WEBSERVER_PORT (e.g., 80, 8080)" $DefaultWebserverPort
    $envContent += "WEBSERVER_PORT=$webserverPort"
    $envContent += ""
    $envContent += "# Public domain name or IP address used for creating audio playback links"
    $publicDomain = Prompt-Input "Enter PUBLIC_DOMAIN (IP or domain name for audio links)" $DefaultPublicDomain
    $envContent += "PUBLIC_DOMAIN=$publicDomain"
    $envContent += ""
    $envContent += "# Timezone for logging timestamps (e.g., US/Eastern, America/Chicago, UTC)"
    $timezone = Prompt-Input "Enter TIMEZONE" $DefaultTimezone
    $envContent += "TIMEZONE=$timezone"
    $envContent += ""

    # --- Authentication ---
    $envContent += "#################################################################"
    $envContent += "##                   AUTHENTICATION & API KEYS                 ##"
    $envContent += "#################################################################"
    $envContent += ""
    $envContent += "# Path to the JSON file containing hashed API keys for SDRTrunk/TR uploads"
    $apiKeyFile = Prompt-Input "Enter API_KEY_FILE path" $DefaultApiKeyFile
    $envContent += "API_KEY_FILE=$apiKeyFile             # Edit and run GenApiKey.js to create/update keys"
    $envContent += ""
    $envContent += "# Enable/disable password authentication for the web interface"
    $enableAuth = Prompt-Input "Enable Webserver Authentication? (true/false)" $DefaultEnableAuth
    $envContent += "ENABLE_AUTH=$enableAuth                 # Set to 'true' to enable password login"
    $envContent += "# Password for web interface login (only used if ENABLE_AUTH=true)"
    if ($enableAuth -eq 'true') {
        $webserverPassword = Read-Host -Prompt "Enter WEBSERVER_PASSWORD (for web login)"
        if ([string]::IsNullOrWhiteSpace($webserverPassword)) {
             $envContent += "WEBSERVER_PASSWORD=your_password # <<< MANUALLY EDIT REQUIRED"
             [void]$script:ManualEditList.Add("WEBSERVER_PASSWORD (since auth enabled)")
        } else {
             $envContent += "WEBSERVER_PASSWORD=$webserverPassword"
        }
    } else {
         $envContent += "WEBSERVER_PASSWORD=                     # Run init-admin.js after changing this if auth is enabled"
    }
    $envContent += ""


    # --- Transcription ---
    $envContent += "#################################################################"
    $envContent += "##                   TRANSCRIPTION SETTINGS                    ##"
    $envContent += "#################################################################"
    $envContent += ""
    $envContent += "# --- Transcription Mode ---"
    $envContent += "# Select 'local' (requires Python/CUDA setup) or 'remote' (uses API server)"
    $transcriptionMode = Prompt-Input "Enter TRANSCRIPTION_MODE ('local' or 'remote')" $DefaultTranscriptionMode
    $envContent += "TRANSCRIPTION_MODE=$transcriptionMode"
    $envContent += ""
    $envContent += "# --- Local Settings (Only used if TRANSCRIPTION_MODE=local) ---"
    $envContent += "# faster-whisper model (e.g., tiny, base, small, medium, large-v3)"
    $whisperModel = Prompt-Input "Enter WHISPER_MODEL" $DefaultWhisperModel
    $envContent += "WHISPER_MODEL=$whisperModel"
    $envContent += "# Device for local transcription ('cuda' or 'cpu')"
    if ($transcriptionMode -eq 'local') {
        $transcriptionDevice = Prompt-Input "Enter TRANSCRIPTION_DEVICE ('cpu' or 'cuda')" $script:PyTorchDevice
        $envContent += "TRANSCRIPTION_DEVICE=$transcriptionDevice             # Ignored if mode is 'remote'"
    } else {
        $envContent += "TRANSCRIPTION_DEVICE=cuda             # Ignored if mode is 'remote'"
    }
    $envContent += "# Maximum concurrent local transcriptions"
    $maxConcurrent = Prompt-Input "Enter MAX_CONCURRENT_TRANSCRIPTIONS (e.g., 3)" "3"
    $envContent += "MAX_CONCURRENT_TRANSCRIPTIONS=$maxConcurrent      # Used only if TRANSCRIPTION_MODE=local"
    $envContent += ""
    $envContent += "# --- Remote Settings (Only used if TRANSCRIPTION_MODE=remote) ---"
    $envContent += "# URL of your running faster-whisper-server/speaches API"
    if ($transcriptionMode -eq 'remote') {
        $whisperServerUrl = Prompt-Input "Enter FASTER_WHISPER_SERVER_URL" $DefaultWhisperServerUrl
        $envContent += "FASTER_WHISPER_SERVER_URL=$whisperServerUrl # Ignored if mode is 'local'"
    } else {
        $envContent += "FASTER_WHISPER_SERVER_URL=$DefaultWhisperServerUrl # Ignored if mode is 'local'"
    }
    $envContent += ""

    # --- Geocoding ---
    $envContent += "#################################################################"
    $envContent += "##                  GEOCODING & LOCATION SETTINGS              ##"
    $envContent += "#################################################################"
    $envContent += ""
    $envContent += "# --- Geocoding API Keys ---"
    $envContent += "# INSTRUCTIONS:"
    $envContent += "# 1. Ensure you are using the correct 'geocoding.js' file for your desired provider (Google or LocationIQ)."
    $envContent += "# 2. Provide the API key ONLY for the provider whose 'geocoding.js' file you are using."
    $envContent += "# 3. You can comment out the unused key with a '#' to avoid confusion."
    $envContent += ""
    $envContent += "# Google Maps API Key (Required ONLY if using the Google version of 'geocoding.js')"
    $googleMapsKey = Read-Host -Prompt "Enter GOOGLE_MAPS_API_KEY (leave blank if using LocationIQ)"
    if ([string]::IsNullOrWhiteSpace($googleMapsKey)) {
        $envContent += "# GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here"
        [void]$script:ManualEditList.Add("GOOGLE_MAPS_API_KEY (if using Google geocoding.js)")
    } else {
        $envContent += "GOOGLE_MAPS_API_KEY=$googleMapsKey"
    }
    $envContent += ""
    $envContent += "# LocationIQ API Key (Required ONLY if using the LocationIQ version of 'geocoding.js')"
    $locationIqKey = Read-Host -Prompt "Enter LOCATIONIQ_API_KEY (leave blank if using Google)"
    if ([string]::IsNullOrWhiteSpace($locationIqKey)) {
        $envContent += "# LOCATIONIQ_API_KEY=your_locationiq_api_key_here"
        [void]$script:ManualEditList.Add("LOCATIONIQ_API_KEY (if using LocationIQ geocoding.js)")
    } else {
        $envContent += "LOCATIONIQ_API_KEY=$locationIqKey"
    }
    $envContent += ""
    $envContent += "# --- Location Hints (Used by both providers) ---"
    $envContent += "# Default location hints for the geocoder"
    $geoCity = Prompt-Input "Enter GEOCODING_CITY (Default City)" $DefaultGeoCity
    $envContent += "GEOCODING_CITY=$geoCity        # Default city"
    $geoState = Prompt-Input "Enter GEOCODING_STATE (Default State Abbreviation, e.g., ST)" $DefaultGeoState
    $envContent += "GEOCODING_STATE=$geoState                    # Default state abbreviation (e.g., MD, VA)"
    $geoCountry = Prompt-Input "Enter GEOCODING_COUNTRY (Default Country Abbreviation)" $DefaultGeoCountry
    $envContent += "GEOCODING_COUNTRY=$geoCountry                  # Default country abbreviation"
    $envContent += ""
    $envContent += "# Target counties for address validation (comma-separated)"
    $geoCounties = Prompt-Input "Enter GEOCODING_TARGET_COUNTIES" $DefaultGeoCounties
    $envContent += "GEOCODING_TARGET_COUNTIES=$geoCounties"
    $envContent += ""
    $envContent += "# Target cities for address extraction hints (comma-separated)"
    $targetCitiesList = Prompt-Input "Enter TARGET_CITIES_LIST" $DefaultTargetCities
    $envContent += "TARGET_CITIES_LIST=$targetCitiesList"
    $envContent += ""

    # --- LLM & AI Summary ---
    $envContent += "#################################################################"
    $envContent += "##                LLM & AI SUMMARY SETTINGS                    ##"
    $envContent += "#################################################################"
    $envContent += ""
    $envContent += "# --- Ollama Settings ---"
    $envContent += "# URL for your running Ollama instance"
    $ollamaUrl = Prompt-Input "Enter OLLAMA_URL" $DefaultOllamaUrl
    $envContent += "OLLAMA_URL=$ollamaUrl"
    $envContent += "# Ollama model used for address extraction and summarization"
    $ollamaModelEnv = Prompt-Input "Enter OLLAMA_MODEL (e.g., llama3.1:8b)" $DefaultOllamaModelEnv
    $envContent += "OLLAMA_MODEL=$ollamaModelEnv"
    $envContent += ""
    $envContent += "# --- OpenAI Settings (Optional Alternative) ---"
    $envContent += "# API Key if using OpenAI instead of Ollama"
    $openaiKey = Read-Host -Prompt "Enter OPENAI_API_KEY (leave blank if using Ollama)"
    if ([string]::IsNullOrWhiteSpace($openaiKey)) {
        $envContent += "OPENAI_API_KEY= # Leave blank if using Ollama"
    } else {
        $envContent += "OPENAI_API_KEY=$openaiKey"
        [void]$script:ManualEditList.Add("OPENAI_API_KEY (if intended)")
    }
    $envContent += ""
    $envContent += "# --- Summary Settings ---"
    $envContent += "# How many hours back the AI summary should cover"
    $summaryHours = Prompt-Input "Enter SUMMARY_LOOKBACK_HOURS (e.g., 1, 0.5)" $DefaultSummaryLookbackHours
    $envContent += "SUMMARY_LOOKBACK_HOURS=$summaryHours"
    $envContent += "# How many hours back the \'Ask AI\' feature should cover"
    $askAiHours = Prompt-Input "Enter ASK_AI_LOOKBACK_HOURS (e.g., 8, 12)" $DefaultAskAiLookbackHours
    $envContent += "ASK_AI_LOOKBACK_HOURS=$askAiHours"
    $envContent += ""

    # --- NEW: Storage Mode ---
    $envContent += "#################################################################"
    $envContent += "##                     STORAGE SETTINGS                        ##"
    $envContent += "#################################################################"
    $envContent += ""
    $envContent += "# --- Storage Mode ---"
    $envContent += "# Select 'local' (saves audio files to ./audio folder) or 's3' (saves to S3-compatible storage)"
    $storageMode = Prompt-Input "Enter STORAGE_MODE ('local' or 's3')" $DefaultStorageMode
    $envContent += "STORAGE_MODE=$storageMode"
    $envContent += ""
    $envContent += "# --- S3 Settings (Only used if STORAGE_MODE=s3) ---"
    if ($storageMode -eq 's3') {
        $s3Endpoint = Prompt-Input "Enter S3_ENDPOINT (URL of your S3-compatible storage)" $DefaultS3Endpoint
        if ([string]::IsNullOrWhiteSpace($s3Endpoint)) {
             $envContent += "S3_ENDPOINT=                     # <<< MANUALLY EDIT REQUIRED if STORAGE_MODE=s3"
             [void]$script:ManualEditList.Add("S3_ENDPOINT")
        } else {
             $envContent += "S3_ENDPOINT=$s3Endpoint"
        }
        $s3BucketName = Prompt-Input "Enter S3_BUCKET_NAME" $DefaultS3BucketName
        if ([string]::IsNullOrWhiteSpace($s3BucketName)) {
             $envContent += "S3_BUCKET_NAME=                 # <<< MANUALLY EDIT REQUIRED if STORAGE_MODE=s3"
             [void]$script:ManualEditList.Add("S3_BUCKET_NAME")
        } else {
             $envContent += "S3_BUCKET_NAME=$s3BucketName"
        }
        $s3AccessKeyId = Read-Host -Prompt "Enter S3_ACCESS_KEY_ID"
        if ([string]::IsNullOrWhiteSpace($s3AccessKeyId)) {
             $envContent += "S3_ACCESS_KEY_ID=              # <<< MANUALLY EDIT REQUIRED if STORAGE_MODE=s3"
             [void]$script:ManualEditList.Add("S3_ACCESS_KEY_ID")
        } else {
             $envContent += "S3_ACCESS_KEY_ID=$s3AccessKeyId"
        }
        $s3SecretAccessKey = Read-Host -Prompt "Enter S3_SECRET_ACCESS_KEY"
        if ([string]::IsNullOrWhiteSpace($s3SecretAccessKey)) {
             $envContent += "S3_SECRET_ACCESS_KEY=           # <<< MANUALLY EDIT REQUIRED if STORAGE_MODE=s3"
             [void]$script:ManualEditList.Add("S3_SECRET_ACCESS_KEY")
        } else {
             $envContent += "S3_SECRET_ACCESS_KEY=$s3SecretAccessKey"
        }
    } else {
        $envContent += "S3_ENDPOINT=                     # Ignored if STORAGE_MODE=local"
        $envContent += "S3_BUCKET_NAME=                 # Ignored if STORAGE_MODE=local"
        $envContent += "S3_ACCESS_KEY_ID=              # Ignored if STORAGE_MODE=local"
        $envContent += "S3_SECRET_ACCESS_KEY=           # Ignored if STORAGE_MODE=local"
    }
    $envContent += ""

    # --- Talk Groups ---
    $envContent += "#################################################################"
    $envContent += "##                     TALK GROUP MAPPINGS                     ##"
    $envContent += "#################################################################"
    $envContent += ""
    $envContent += "# --- Address Extraction Mapping ---"
    $envContent += "# Comma-separated list of Talk Group IDs where address extraction should be attempted"
    $envContent += "# Recommend using dispatch talkgroups only."
    $mappedTgs = Prompt-Input "Enter MAPPED_TALK_GROUPS" $DefaultMappedTgs
    $envContent += "MAPPED_TALK_GROUPS=$mappedTgs"
    $envContent += ""
    $envContent += "# --- Location Descriptions for Mapped Talk Groups ---"
    $envContent += "# REQUIRED: Add one line for EACH Talk Group ID listed in MAPPED_TALK_GROUPS above."
    $envContent += "# Format: TALK_GROUP_<ID>=Location Description for LLM context"
    $envContent += "# Example: TALK_GROUP_1234=Any Town or Area within Your County ST"
    $envContent += "# --- MANUALLY EDIT THE FOLLOWING SECTION ---"
    # Split the mapped TGs and add commented out examples
    $mappedTgs.Split(',') | ForEach-Object {
        $tgId = $_.Trim()
        if ($tgId -ne '') {
            $envContent += "# TALK_GROUP_$($tgId)=<Location Description for $tgId>"
        }
    }
    $envContent += "# --- END MANUAL EDIT SECTION ---"
    [void]$script:ManualEditList.Add("TALK_GROUP_XXXX mappings")
    $envContent += ""

    # Write the content to the .env file
    try {
        # Use Set-Content with -Encoding UTF8 for better compatibility
        Set-Content -Path $envFile -Value ($envContent -join [Environment]::NewLine) -Encoding utf8 -ErrorAction Stop
        Print-Message ".env file created in $InstallDir"
    } catch {
        $caughtError = $_
        Write-Error "Failed to write to ${envFile}: $($caughtError.Exception.Message)"
    }
}


function Install-NodeDeps {
    Print-Message "Installing Node.js dependencies..."
    Set-Location $InstallDir
    # Attempt npm install - Added form-data and aws-sdk
    npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser form-data aws-sdk
    if (-not $?) {
        Write-Warning "First npm install attempt failed. Trying again..."
        npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser form-data aws-sdk
        if (-not $?) {
             Write-Warning "npm install failed again. Please check errors and try running 'npm install' manually in $InstallDir."
        }
    }
    Print-Message "Node.js dependency installation attempted."
}

function Setup-PythonDeps {
    Print-Message "Installing Python dependencies..."
    Set-Location $InstallDir
    Write-Host "Installing Python packages globally using pip..."
    $torchInstallCmd = ""
    if ($script:PyTorchDevice -eq "cuda") {
        Write-Host "Installing PyTorch with CUDA support (using latest CUDA 12.1 index URL, verify compatibility)..."
        $torchInstallCmd = "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
    } else {
        Write-Host "Installing CPU-only version of PyTorch..."
        $torchInstallCmd = "pip3 install torch torchvision torchaudio"
    }
    Run-Command { Invoke-Expression $torchInstallCmd } "Failed to install PyTorch."
    Write-Host "Installing faster-whisper, python-dotenv, and pydub..."
    Run-Command { pip3 install faster-whisper python-dotenv pydub } "Failed to install faster-whisper/python-dotenv/pydub."
    Print-Message "Python dependency installation attempted."
}

function Create-Dirs {
    Print-Message "Creating required directories..."
    Set-Location $InstallDir
    New-Item -ItemType Directory -Force -Path ".\audio" | Out-Null
    New-Item -ItemType Directory -Force -Path ".\data" | Out-Null
    New-Item -ItemType Directory -Force -Path ".\logs" | Out-Null
    Print-Message "Directories created."
}

function Import-Talkgroups {
    Print-Message "Import Talk Group Data (Required)"
    Write-Host "This application requires talk group data exported from RadioReference.com."
    Write-Host "1. Go to RadioReference.com and find your desired trunked radio system."
    Write-Host "2. Look for an option to export talk groups (usually requires a Premium Subscription)."
    Write-Host "3. Export the talk groups as a CSV file."
    Write-Host "4. Save the file as 'talkgroups.csv' inside the '$InstallDir' directory."
    Write-Host "5. (Optional) Export frequencies as 'frequencies.csv' and save it in the same directory."
    Write-Host ""
    $talkgroupsFile = Join-Path $InstallDir "talkgroups.csv"
    while ($true) {
        $choiceYes = New-Object System.Management.Automation.Host.ChoiceDescription("&Yes", "Confirm you have the file.")
        $choiceNo = New-Object System.Management.Automation.Host.ChoiceDescription("&No", "Indicate you do not have the file yet.")
        $choiceSkip = New-Object System.Management.Automation.Host.ChoiceDescription("&Skip", "Skip the import process for now.")
        $choices = [System.Management.Automation.Host.ChoiceDescription[]]($choiceYes, $choiceNo, $choiceSkip)
        $options = [System.Management.Automation.Host.ChoiceDescription[]]$choices
        $result = $Host.UI.PromptForChoice("Confirmation", "Have you downloaded and saved 'talkgroups.csv' to '$InstallDir'?", $options, 1) # Default to No
        switch ($result) {
            0 { # Yes
                if (Test-Path $talkgroupsFile) {
                    Write-Host "Found '$talkgroupsFile'. Running import script..."
                    Set-Location $InstallDir
                    Run-Command { node import_csv.js } "Talk group import script encountered an error. Check output."
                    Print-Message "Talk group import attempted."
                    return
                } else {
                    Write-Warning "Error: '$talkgroupsFile' not found in '$InstallDir'."
                    Write-Warning "Please make sure the file is correctly named and placed."
                }
            }
            1 { # No
                Write-Host "Please download the file and place it in the directory, then run this script again or run 'node import_csv.js' manually later."
            }
            2 { # Skip
                Write-Host "Skipping talk group import. You MUST run 'node import_csv.js' manually later after placing the file."
                Print-Message "Talk group import skipped."
                return
            }
        }
    }
}

# *** UPDATED FUNCTION ***
function Manual-StepsReminder {
    Print-Message "--- MANUAL CONFIGURATION REQUIRED ---"
    Write-Host "The script has completed the automated steps and created a base .env file." -ForegroundColor Yellow
    Write-Host "You MUST now manually review and potentially edit the following files in '$InstallDir':" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "1.  '.env' file ('notepad .\.env'):" -ForegroundColor Green
    Write-Host "    - Verify all values entered during the script are correct."
    Write-Host "    - CRITICAL: Add your actual keys/tokens for:"
    if ($script:ManualEditList -ne $null -and $script:ManualEditList.Count -gt 0) {
        Write-Host "      -> $($script:ManualEditList -join ', ')" -ForegroundColor Red
    } else {
         Write-Host "      -> (Review all placeholders like 'your_..._here')" -ForegroundColor Red
    }
    # *** UPDATED REMINDERS ***
    Write-Host "    - Verify STORAGE_MODE is set correctly ('local' or 's3')." -ForegroundColor Yellow
    Write-Host "    - If STORAGE_MODE=s3, ensure S3_ENDPOINT, S3_BUCKET_NAME, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are correct." -ForegroundColor Yellow
    Write-Host "    - Verify TRANSCRIPTION_MODE is set correctly ('local' or 'remote')." -ForegroundColor Yellow
    Write-Host "    - If remote, ensure FASTER_WHISPER_SERVER_URL is correct." -ForegroundColor Yellow
    Write-Host "    - If local, ensure TRANSCRIPTION_DEVICE is correct ('cuda' or 'cpu')." -ForegroundColor Yellow
    Write-Host "    - Choose the correct 'geocoding.js' file (Google vs LocationIQ) for your setup." -ForegroundColor Yellow
    Write-Host "    - Ensure the corresponding API key (GOOGLE_MAPS_API_KEY or LOCATIONIQ_API_KEY) is uncommented and correct." -ForegroundColor Yellow
    Write-Host "    - Verify SUMMARY_LOOKBACK_HOURS and ASK_AI_LOOKBACK_HOURS are set as desired." -ForegroundColor Yellow
    Write-Host "    - If local, ensure MAX_CONCURRENT_TRANSCRIPTIONS is set appropriately." -ForegroundColor Yellow
    # *** END UPDATED REMINDERS ***
    Write-Host "    - CRITICAL: Add your specific 'TALK_GROUP_XXXX=Location Description' lines." -ForegroundColor Red
    Write-Host ""
    Write-Host "2.  'public\config.js' ('notepad .\public\config.js'):" -ForegroundColor Green
    Write-Host "    - Review map center, zoom, icons, etc."
    Write-Host ""
    Write-Host "3.  API Key for SDRTrunk/TrunkRecorder:" -ForegroundColor Green
    Write-Host "    - Edit 'GenApiKey.js' ('notepad .\GenApiKey.js') and set your desired secret key."
    Write-Host "    - Run 'node GenApiKey.js' in this directory to get the HASHED key."
    Write-Host "    - Create/edit 'data\apikeys.json' ('notepad .\data\apikeys.json')."
    Write-Host "    - Add the HASHED key in the format: [{""key"":""YOUR_HASHED_KEY_HERE"",""disabled"":false}]" # Escaped quotes for PowerShell
    Write-Host ""
    Write-Host "4.  (If Skipped) Import Talk Groups:" -ForegroundColor Green
    Write-Host "    - Place 'talkgroups.csv' / 'frequencies.csv' in '$InstallDir'."
    Write-Host "    - Run 'node import_csv.js'."
    Write-Host ""
    Write-Host "5.  (Optional) Initialize Admin User (if ENABLE_AUTH=true in .env):" -ForegroundColor Green
    Write-Host "    - Run 'node init-admin.js'."
    Write-Host ""
    Write-Host "--- HOW TO RUN ---" -ForegroundColor Magenta
    Write-Host "1. Open PowerShell/CMD 1: cd $InstallDir"
    Write-Host "   (If using venv for Python, activate it first)"
    Write-Host "   node bot.js"
    Write-Host "2. Open PowerShell/CMD 2: cd $InstallDir"
    Write-Host "   node webserver.js"
    Write-Host "-------------------------------------" -ForegroundColor Cyan
}

# --- Main Script Execution ---
Print-Message "Starting Scanner Map Installation for Windows..."

Install-Prerequisites
Install-Ollama
Install-NvidiaComponents # Will prompt user and provide links/guidance
Clone-Repo
Create-EnvFile # Uses updated function
Install-NodeDeps
Setup-PythonDeps # Will use $script:PyTorchDevice set earlier
Create-Dirs
Import-Talkgroups # Uses updated function
Manual-StepsReminder # Uses updated function

Print-Message "Installation script finished. Please complete the manual configuration steps."

# Pause at the end
Read-Host "Press Enter to exit the script..."

exit 0