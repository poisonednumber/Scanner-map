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
$DefaultOllamaUrl = "http://localhost:11434"
$DefaultOllamaModelEnv = $OllamaModel # Use the same model pulled earlier
$DefaultMappedTgs = "1001,1002,2001,2002"
$DefaultTimezone = "US/Eastern"
$DefaultEnableAuth = "false"
$DefaultTargetCities = "City1,City2,City3,City4"

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
        # Don't exit, allow script to continue
    }
}

function Prompt-YesNo {
    param([string]$PromptMessage, [string]$Default = 'n')
    # Create individual ChoiceDescription objects
    $choiceYes = New-Object System.Management.Automation.Host.ChoiceDescription("&Yes", "Confirm Yes.")
    $choiceNo = New-Object System.Management.Automation.Host.ChoiceDescription("&No", "Confirm No.")
    # Put the objects into an array
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

    # Check for winget
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Error "winget is not available. Please install the App Installer from the Microsoft Store."
        exit 1
    }

    # Install Node.js LTS
    Write-Host "Installing/Upgrading Node.js LTS..."
    Run-Command { winget install --exact --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements } "Failed to install Node.js LTS."

    # Install Python
    Write-Host "Installing/Upgrading Python 3.10+..."
    Run-Command { winget install --exact --id Python.Python.3.11 --source winget --accept-package-agreements --accept-source-agreements } "Failed to install Python." # Using 3.11, adjust if needed

    # Install Git
    Write-Host "Installing/Upgrading Git..."
    Run-Command { winget install --exact --id Git.Git --source winget --accept-package-agreements --accept-source-agreements } "Failed to install Git."

    # Install VS Build Tools (Can take a while)
    Write-Host "Installing/Upgrading Visual Studio Build Tools (This may take a significant amount of time)..."
    Run-Command { winget install --exact --id Microsoft.VisualStudio.2022.BuildTools --source winget --accept-package-agreements --accept-source-agreements --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" } "Failed to install VS Build Tools."

    # Install FFmpeg
    Write-Host "Installing/Upgrading FFmpeg..."
    Run-Command { winget install --exact --id Gyan.FFmpeg --source winget --accept-package-agreements --accept-source-agreements } "Failed to install FFmpeg."

    Write-Host "Verifying FFmpeg (check output manually)..."
    Start-Sleep -Seconds 2 # Give PATH changes a moment
    # Try running ffmpeg, suppress error output if not found yet
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
            Start-Process -FilePath $ollamaInstaller -ArgumentList "/SILENT" -Wait # Attempt silent install, may still show UI
            # Add check if ollama command exists after install attempt
            Start-Sleep -Seconds 5
            if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
                 Write-Warning "Ollama installation may not have completed successfully or PATH not updated yet. Please check manually."
            }
        } catch {
            $caughtError = $_ # Assign error record
            Write-Error "Failed to download or run Ollama installer: $($caughtError.Exception.Message)"
            return
        } finally {
            if (Test-Path $ollamaInstaller) { Remove-Item $ollamaInstaller -Force }
        }
    }

    Write-Host "Pulling Ollama model: $OllamaModel (this may take a while)..."
    # Check if ollama command exists before trying to pull
     if (Get-Command ollama -ErrorAction SilentlyContinue) {
        ollama pull "$OllamaModel" # Run directly, user sees output
     } else {
         Write-Warning "Cannot pull Ollama model because the 'ollama' command was not found. Please run 'ollama pull $OllamaModel' manually after installation."
     }

    Print-Message "Ollama installation attempted."
}

# Updated function: Provides links and instructions for manual NVIDIA component installation
function Install-NvidiaComponents {
    Print-Message "NVIDIA GPU Components Check (CUDA/cuDNN/cuBLAS)"
    # Simple check if nvidia-smi exists
    $nvidiaSmiPath = Join-Path $env:SystemRoot "System32\nvidia-smi.exe"
    if (-not (Test-Path $nvidiaSmiPath)) {
        Write-Host "NVIDIA driver not detected ($nvidiaSmiPath not found)."
        Write-Host "Skipping CUDA/cuDNN/cuBLAS steps. If you have an NVIDIA GPU, please install drivers first."
        # Set reminder variable for .env
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

        # Set reminder variable for .env
        $script:PyTorchDevice = "cuda"
        Print-Message "NVIDIA components require MANUAL installation."

    } else {
        Write-Host "Skipping NVIDIA components. PyTorch will be installed for CPU."
        # Set reminder variable for .env
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

# New function to create .env file interactively
function Create-EnvFile {
    Print-Message "Creating .env configuration file..."
    Set-Location $InstallDir
    $envFile = ".\.env"
    # Use the script-scoped variable initialized earlier
    $script:ManualEditList.Clear() # Clear any previous values

    # Check if .env already exists
    if (Test-Path $envFile) {
        if (-not (Prompt-YesNo "$envFile already exists. Overwrite it?")) {
            Write-Host "Skipping .env creation. Please configure manually."
            return
        }
        Remove-Item $envFile -Force
    }

    Write-Host "Please provide the following configuration values. Press Enter to accept the default."

    # Use a helper function or inline logic to build the content
    $envContent = @()

    # --- Discord ---
    $envContent += "# Discord Bot Configuration"
    $discordToken = Read-Host -Prompt "Enter DISCORD_TOKEN"
    if ([string]::IsNullOrWhiteSpace($discordToken)) {
        $envContent += "DISCORD_TOKEN=your_discord_token_here # <<< MANUALLY EDIT REQUIRED"
        [void]$script:ManualEditList.Add("DISCORD_TOKEN")
    } else {
        $envContent += "DISCORD_TOKEN=$discordToken"
    }
    $clientId = Read-Host -Prompt "Enter CLIENT_ID"
    if ([string]::IsNullOrWhiteSpace($clientId)) {
        $envContent += "CLIENT_ID=your_client_id_here # <<< MANUALLY EDIT REQUIRED"
        [void]$script:ManualEditList.Add("CLIENT_ID")
    } else {
        $envContent += "CLIENT_ID=$clientId"
    }
    $envContent += ""

    # --- Server Ports ---
    $envContent += "# Server Ports"
    $botPort = Prompt-Input "Enter BOT_PORT (for SDRTrunk/TR)" $DefaultBotPort
    $envContent += "BOT_PORT=$botPort"
    $apiKeyFile = Prompt-Input "Enter API_KEY_FILE path" $DefaultApiKeyFile
    $envContent += "API_KEY_FILE=$apiKeyFile"
    $webserverPort = Prompt-Input "Enter WEBSERVER_PORT (e.g., 80, 8080)" $DefaultWebserverPort
    $envContent += "WEBSERVER_PORT=$webserverPort"
    $publicDomain = Prompt-Input "Enter PUBLIC_DOMAIN (IP or domain name for audio links)" $DefaultPublicDomain
    $envContent += "PUBLIC_DOMAIN=$publicDomain"
    $envContent += ""

    # --- Geocoding ---
    $envContent += "# Geocoding Configuration"
    $googleMapsKey = Read-Host -Prompt "Enter GOOGLE_MAPS_API_KEY"
    if ([string]::IsNullOrWhiteSpace($googleMapsKey)) {
        $envContent += "GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here # <<< MANUALLY EDIT REQUIRED"
        [void]$script:ManualEditList.Add("GOOGLE_MAPS_API_KEY")
    } else {
        $envContent += "GOOGLE_MAPS_API_KEY=$googleMapsKey"
    }
    $geoCity = Prompt-Input "Enter GEOCODING_CITY (Default City)" $DefaultGeoCity
    $envContent += "GEOCODING_CITY=$geoCity"
    $geoState = Prompt-Input "Enter GEOCODING_STATE (Default State Abbreviation, e.g., ST)" $DefaultGeoState
    $envContent += "GEOCODING_STATE=$geoState"
    $geoCountry = Prompt-Input "Enter GEOCODING_COUNTRY (Default Country Abbreviation)" $DefaultGeoCountry
    $envContent += "GEOCODING_COUNTRY=$geoCountry"
    $geoCounties = Prompt-Input "Enter GEOCODING_TARGET_COUNTIES (Comma-separated)" $DefaultGeoCounties
    $envContent += "GEOCODING_TARGET_COUNTIES=$geoCounties"
    $envContent += ""

    # --- Transcription ---
    $envContent += "# Transcription Configuration"
    $whisperModel = Prompt-Input "Enter WHISPER_MODEL (e.g., tiny, base, small, medium, large-v3)" $DefaultWhisperModel
    $envContent += "WHISPER_MODEL=$whisperModel"
    # Use the device determined earlier
    $transcriptionDevice = Prompt-Input "Enter TRANSCRIPTION_DEVICE ('cpu' or 'cuda')" $script:PyTorchDevice
    $envContent += "TRANSCRIPTION_DEVICE=$transcriptionDevice"
    $envContent += ""

    # --- LLM ---
    $envContent += "# Local LLM Configuration"
    $ollamaUrl = Prompt-Input "Enter OLLAMA_URL" $DefaultOllamaUrl
    $envContent += "OLLAMA_URL=$ollamaUrl"
    $ollamaModelEnv = Prompt-Input "Enter OLLAMA_MODEL (e.g., llama3.1:8b)" $DefaultOllamaModelEnv
    $envContent += "OLLAMA_MODEL=$ollamaModelEnv"
    $envContent += ""

    # --- OpenAI (Optional) ---
    $envContent += "# Optional: OpenAI Configuration (alternative to Ollama)"
    $openaiKey = Read-Host -Prompt "Enter OPENAI_API_KEY (leave blank if using Ollama)"
    if ([string]::IsNullOrWhiteSpace($openaiKey)) {
        $envContent += "OPENAI_API_KEY= # <<< Optional: Add key here if using OpenAI"
    } else {
        $envContent += "OPENAI_API_KEY=$openaiKey"
        [void]$script:ManualEditList.Add("OPENAI_API_KEY (if intended)")
    }
    $envContent += ""

    # --- Talk Groups ---
    $envContent += "# Talk Groups"
    $mappedTgs = Prompt-Input "Enter MAPPED_TALK_GROUPS (Comma-separated IDs for address extraction)" $DefaultMappedTgs
    $envContent += "MAPPED_TALK_GROUPS=$mappedTgs"
    $envContent += ""

    # --- Timezone ---
    $envContent += "# Timezone"
    $timezone = Prompt-Input "Enter TIMEZONE (e.g., US/Eastern, America/Chicago, UTC)" $DefaultTimezone
    $envContent += "TIMEZONE=$timezone"
    $envContent += ""

    # --- Authentication ---
    $envContent += "# Authentication"
    $enableAuth = Prompt-Input "Enable Webserver Authentication? (true/false)" $DefaultEnableAuth
    $envContent += "ENABLE_AUTH=$enableAuth"
    # Only ask for password if auth is enabled
    if ($enableAuth -eq 'true') {
        $webserverPassword = Read-Host -Prompt "Enter WEBSERVER_PASSWORD (for web login)"
        if ([string]::IsNullOrWhiteSpace($webserverPassword)) {
             $envContent += "WEBSERVER_PASSWORD=your_password # <<< MANUALLY EDIT REQUIRED"
             [void]$script:ManualEditList.Add("WEBSERVER_PASSWORD (since auth enabled)")
        } else {
             $envContent += "WEBSERVER_PASSWORD=$webserverPassword"
        }
    } else {
         $envContent += "WEBSERVER_PASSWORD= # Authentication disabled"
    }
    $envContent += ""

    # --- Talk Group Mappings (Manual Edit Required) ---
    $envContent += "# Talk Groups mapping (format: ID=Location)"
    $envContent += "# --- MANUALLY EDIT THE FOLLOWING SECTION ---"
    $envContent += "# Add one line for EACH talk group ID listed in MAPPED_TALK_GROUPS above."
    $envContent += "# Example format:"
    $envContent += "# TALK_GROUP_1001=City1 or any town in County1 ST"
    $envContent += "# TALK_GROUP_1002=City2 or any town in County1 ST"
    $envContent += "# TALK_GROUP_2001=City3 or any town in County2 ST"
    $envContent += "# TALK_GROUP_2002=City4 or any town in County2 ST"
    $envContent += "# --- END MANUAL EDIT SECTION ---"
    [void]$script:ManualEditList.Add("TALK_GROUP_XXXX mappings")
    $envContent += ""

    # --- Target Cities ---
    $envContent += "# Target Cities (comma-separated list of cities in your target areas)"
    $targetCitiesList = Prompt-Input "Enter TARGET_CITIES_LIST (Comma-separated)" $DefaultTargetCities
    $envContent += "TARGET_CITIES_LIST=$targetCitiesList"
    $envContent += ""

    # Write the content to the .env file
    try {
        $envContent | Out-File -FilePath $envFile -Encoding utf8 -ErrorAction Stop
        Print-Message ".env file created in $InstallDir"
    } catch {
        # *** FIX APPLIED HERE ***
        $caughtError = $_
        Write-Error "Failed to write to ${envFile}: $($caughtError.Exception.Message)"
    }
}


function Install-NodeDeps {
    Print-Message "Installing Node.js dependencies..."
    Set-Location $InstallDir
    # Attempt npm install
    npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser
    if (-not $?) {
        Write-Warning "First npm install attempt failed. Trying again..."
        npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser
        if (-not $?) {
             Write-Warning "npm install failed again. Please check errors and try running 'npm install' manually in $InstallDir."
        }
    }
    Print-Message "Node.js dependency installation attempted."
}

function Setup-PythonDeps {
    Print-Message "Installing Python dependencies..."
    Set-Location $InstallDir

    # --- Option 1: Install Globally (Simpler for basic Windows use, but less isolated) ---
    Write-Host "Installing Python packages globally using pip..."

    # Determine PyTorch command based on earlier choice
    $torchInstallCmd = ""
    if ($script:PyTorchDevice -eq "cuda") {
        Write-Host "Installing PyTorch with CUDA support (using latest CUDA 12.1 index URL, verify compatibility)..."
        $torchInstallCmd = "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
    } else {
        Write-Host "Installing CPU-only version of PyTorch..."
        $torchInstallCmd = "pip3 install torch torchvision torchaudio"
    }

    Run-Command { Invoke-Expression $torchInstallCmd } "Failed to install PyTorch."

    Write-Host "Installing faster-whisper and python-dotenv..."
    Run-Command { pip3 install faster-whisper python-dotenv } "Failed to install faster-whisper/python-dotenv."

    # Optional: Install specific ctranslate2 version
    # Write-Host "Check README if a specific ctranslate2 version is needed for your CUDA setup."
    # Run-Command { pip3 install --force-reinstall ctranslate2==<version> } "Failed to install ctranslate2."

    # --- Option 2: Using venv (Commented out - uncomment if preferred) ---
    # Write-Host "Setting up Python virtual environment (.venv)..."
    # Run-Command { python -m venv .venv } "Failed to create Python venv."
    # Write-Host "Activating venv and installing packages..."
    # Note: Activating venv within a script is complex. These pip commands assume it's active.
    # Run-Command { & "$($InstallDir)\.venv\Scripts\pip.exe" install --upgrade pip } "Failed to upgrade pip in venv."
    # Run-Command { & "$($InstallDir)\.venv\Scripts\pip.exe" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 } "Failed to install PyTorch in venv." # Adjust URL/CPU as needed
    # Run-Command { & "$($InstallDir)\.venv\Scripts\pip.exe" install faster-whisper python-dotenv } "Failed to install other packages in venv."
    # Write-Host "Remember to activate the venv manually before running: .\ .venv\Scripts\activate.ps1"

    Print-Message "Python dependency installation attempted."
}

function Create-Dirs {
    Print-Message "Creating required directories..."
    Set-Location $InstallDir
    New-Item -ItemType Directory -Force -Path ".\audio" | Out-Null
    New-Item -ItemType Directory -Force -Path ".\data" | Out-Null
    New-Item -ItemType Directory -Force -Path ".\logs" | Out-Null # Added logs directory
    Print-Message "Directories created."
}

# Updated function to handle talk group import
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
        # *** FIX APPLIED HERE ***
        # Create individual ChoiceDescription objects
        $choiceYes = New-Object System.Management.Automation.Host.ChoiceDescription("&Yes", "Confirm you have the file.")
        $choiceNo = New-Object System.Management.Automation.Host.ChoiceDescription("&No", "Indicate you do not have the file yet.")
        $choiceSkip = New-Object System.Management.Automation.Host.ChoiceDescription("&Skip", "Skip the import process for now.")

        # Put the objects into an array
        $choices = [System.Management.Automation.Host.ChoiceDescription[]]($choiceYes, $choiceNo, $choiceSkip)

        $options = [System.Management.Automation.Host.ChoiceDescription[]]$choices # This line might be redundant now, but harmless

        $result = $Host.UI.PromptForChoice("Confirmation", "Have you downloaded and saved 'talkgroups.csv' to '$InstallDir'?", $options, 1) # Default to No

        switch ($result) {
            0 { # Yes
                if (Test-Path $talkgroupsFile) {
                    Write-Host "Found '$talkgroupsFile'. Running import script..."
                    Set-Location $InstallDir
                    Run-Command { node import_csv.js } "Talk group import script encountered an error. Check output."
                    Print-Message "Talk group import attempted."
                    return # Exit the function
                } else {
                    Write-Warning "Error: '$talkgroupsFile' not found in '$InstallDir'."
                    Write-Warning "Please make sure the file is correctly named and placed."
                    # Loop continues
                }
            }
            1 { # No
                Write-Host "Please download the file and place it in the directory, then run this script again or run 'node import_csv.js' manually later."
                # Optionally pause here again if needed
                # Read-Host "Press Enter when ready to continue..."
            }
            2 { # Skip
                Write-Host "Skipping talk group import. You MUST run 'node import_csv.js' manually later after placing the file."
                Print-Message "Talk group import skipped."
                return # Exit the function
            }
        }
    }
}

function Manual-StepsReminder {
    Print-Message "--- MANUAL CONFIGURATION REQUIRED ---"
    Write-Host "The script has completed the automated steps and created a base .env file." -ForegroundColor Yellow
    Write-Host "You MUST now manually review and potentially edit the following files in '$InstallDir':" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "1.  '.env' file ('notepad .\.env'):" -ForegroundColor Green
    Write-Host "    - Verify all values entered during the script are correct."
    Write-Host "    - CRITICAL: Add your actual keys/tokens for:"
    # List items that definitely need manual input based on the env creation function
    if ($script:ManualEditList -ne $null -and $script:ManualEditList.Count -gt 0) {
        Write-Host "      -> $($script:ManualEditList -join ', ')" -ForegroundColor Red
    } else {
         Write-Host "      -> (Review all placeholders like 'your_..._here')" -ForegroundColor Red
    }
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
    Write-Host "   (If using venv, activate: .\.venv\Scripts\activate.ps1)"
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
Create-EnvFile # New step
Install-NodeDeps
Setup-PythonDeps # Will use $script:PyTorchDevice set earlier
Create-Dirs
Import-Talkgroups # New interactive step
Manual-StepsReminder

Print-Message "Installation script finished. Please complete the manual configuration steps."

# Pause at the end
Read-Host "Press Enter to exit the script..."

exit 0