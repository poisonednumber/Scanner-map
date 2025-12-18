# Scanner Map Installer - Simple Walkthrough

## What is This?

The Scanner Map installer is a step-by-step guide that helps you set up Scanner Map on your computer. It asks you questions and sets everything up automatically.

You can choose between:
- **Docker** (Recommended - easier to use)
- **Local** (Traditional installation)

---

## How to Start

**On Windows:**
- Double-click `install.bat`

**On Linux or Mac:**
- Run `./install.sh` in a terminal

---

## Step-by-Step Process

### Step 1: Welcome Screen
You'll see a welcome message: "Scanner Map Installer"

### Step 2: Choose Installation Type
The installer asks: "Choose installation type"
- **Docker (Recommended)** - Press Enter (this is the default)
- **Local (Non-Docker)** - Use arrow keys to select

### Step 3: System Check
The installer checks if you have everything needed:

**For Docker:**
- Checks if Docker is installed
- Checks if Docker is running

**For Local:**
- Checks if Node.js is installed (version 18 or higher)
- Checks if npm is installed
- Warns if Python is missing (needed for some features)

**What happens:**
- ✅ If everything is good → Continues
- ⚠️ If something is missing → Shows a warning but continues
- ❌ If something critical is missing → Stops and tells you what to install

### Step 4: Configuration Questions

The installer asks you several questions. You can press Enter to accept the default answers for most of them.

#### Optional Services
The installer asks if you want to enable these optional features:

1. **Ollama (Local AI service)**
   - Question: "Enable Ollama?"
   - Default: No (just press Enter)

2. **iCAD Transcribe (Advanced transcription)**
   - Question: "Enable iCAD Transcribe?"
   - Default: No (just press Enter)

3. **TrunkRecorder (Radio recording)**
   - Question: "Enable TrunkRecorder?"
   - Default: No (just press Enter)

#### Basic Settings
The installer asks for:

- **Web server port**: Default is `3001` (just press Enter)
- **API port**: Default is `3306` (just press Enter)
- **Public domain**: Default is `localhost` (just press Enter)
- **Timezone**: Default is `America/New_York` (just press Enter)

#### Geocoding (Location Services)
Choose how to get location information:

- **Nominatim** (FREE, no API key needed) ← Default - just press Enter
- **LocationIQ** (FREE tier available)
- **Google Maps** (Paid service)

The installer also asks about your location (pre-filled with Baltimore, MD - you can change if needed)

#### AI Provider
Choose which AI service to use:

- **OpenAI (ChatGPT)** ← Default if you didn't enable Ollama
- **Ollama (Local AI)** ← Default if you enabled Ollama

If you choose OpenAI:
- You can enter an API key (optional - can add later)
- Model name (default is fine - just press Enter)

If you choose Ollama:
- URL (default is fine - just press Enter)
- Model name (default is fine - just press Enter)

#### Discord Bot (Optional)
- Question: "Configure Discord bot?"
- Default: No (just press Enter)

If you choose Yes:
- You'll need to enter your Discord bot token
- Client ID is optional

### Step 5: Review Your Settings

The installer shows you everything you configured:
- Installation type
- Ports
- Timezone
- Services enabled/disabled
- And more...

**Question**: "Proceed with installation?"
- Default: Yes (just press Enter)

### Step 6: Installation Happens

The installer does all the work automatically:

**For Docker:**
1. Creates folders for your data
2. Generates API keys (if needed)
3. Sets up configuration files
4. Creates the Docker setup file
5. Downloads TrunkRecorder (if you enabled it)

**For Local:**
1. Installs required software packages
2. Creates folders for your data
3. Sets up configuration files
4. Generates API keys (if needed)

### Step 7: Finish Up

The installer shows you what to do next:

**For Docker:**
- API keys were automatically created
- If you enabled Ollama: You'll need to download a model after starting
- If you enabled iCAD: Change the default password
- If you enabled TrunkRecorder: Configure your radio system

**Question**: "Start Docker services now?"
- Default: Yes (just press Enter)
- This starts everything up for you

**For Local:**
- Review the configuration file (.env)
- Install any optional services you enabled
- Start Scanner Map when ready

**Question**: "Set up auto-start on boot?" (Local only)
- Default: No (just press Enter)
- If Yes: Scanner Map will start automatically when your computer boots

---

## What Gets Created

After installation, you'll have:

- **.env file** - Your main configuration file
- **docker-compose.yml** - Docker setup (if using Docker)
- **appdata folder** - Where all your data is stored
  - Scanner Map data, audio files, and logs
  - Configuration for optional services (if enabled)

---

## If Something Goes Wrong

The installer handles common problems:

- **Port already in use**: The installer will try to work around it or tell you which port is busy
- **Missing software**: The installer will tell you what to install
- **Service won't start**: The installer will show you what went wrong and how to fix it

Most of the time, you can just press Enter to accept the defaults and everything will work!

## Quick Reference

### Starting the Installer

**Windows:** Double-click `install.bat`

**Linux/Mac:** Run `./install.sh` in a terminal

### After Installation

**Docker:**
- Start services: `docker-compose up -d`
- View what's happening: `docker-compose logs -f scanner-map`

**Local:**
- Start Scanner Map: `npm start`

### Access Your Scanner Map

Open your web browser and go to: **http://localhost:3001**

---

## Important Notes

- The installer needs to run in a terminal window (not through a batch file directly)
- All API keys are created automatically - you don't need to make them yourself
- Docker is recommended because it's easier to manage
- If you already have configuration files, the installer won't overwrite them

