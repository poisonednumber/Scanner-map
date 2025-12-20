# live-reload.ps1
# PowerShell script for live reload functionality

param(
    [string]$Mode = "local",  # "local" or "docker"
    [int]$WebserverPort = 3001,
    [string]$DockerComposeCmd = "docker compose"
)

$ErrorActionPreference = "Continue"

# Files to watch (only source files, not runtime files)
$watchPaths = @(
    "public\*.js",
    "public\*.html",
    "public\*.css",
    "webserver.js",
    "bot.js"
)

function Restart-Docker {
    Write-Host "[Live Reload] Restarting Docker services..." -ForegroundColor Yellow
    & $DockerComposeCmd restart scanner-map 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[Live Reload] Restart failed, trying full restart..." -ForegroundColor Red
        & $DockerComposeCmd down 2>&1 | Out-Null
        Start-Sleep -Milliseconds 1000
        & $DockerComposeCmd up -d --build 2>&1 | Out-Null
    }
    Write-Host "[Live Reload] Docker services restarted" -ForegroundColor Green
}

function Restart-Local {
    Write-Host "[Live Reload] Restarting local application..." -ForegroundColor Yellow
    
    # Kill existing process by window title (more reliable on Windows)
    $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue
    foreach ($proc in $processes) {
        try {
            $windowTitle = $proc.MainWindowTitle
            if ($windowTitle -like "*Scanner Map*") {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        } catch {
            # Process might not have a window, try to kill by checking command line via WMI
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
                if ($cmdLine -like "*bot.js*") {
                    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                }
            } catch {
                # Ignore errors
            }
        }
    }
    
    Start-Sleep -Milliseconds 500
    
    # Restart in a new window
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
    $projectRoot = Split-Path -Parent $scriptPath
    Set-Location $projectRoot
    Start-Process -FilePath "node" -ArgumentList "bot.js" -WindowStyle Normal
    Write-Host "[Live Reload] Local application restarted" -ForegroundColor Green
}

function Invoke-BrowserRefresh {
    Write-Host "[Live Reload] Refreshing browser..." -ForegroundColor Cyan
    
    # Wait a moment for the service to be ready
    Start-Sleep -Seconds 2
    
    # Try to refresh browser by opening the URL (browser will handle if tab is already open)
    try {
        $url = "http://localhost:$WebserverPort/?setup-wizard=1&reload=" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
        Start-Process $url
        Write-Host "[Live Reload] Browser refreshed" -ForegroundColor Green
    } catch {
        Write-Host "[Live Reload] Could not refresh browser automatically. Please refresh manually." -ForegroundColor Yellow
    }
}

# File change handler script block
$script:debounceTimer = $null
$script:debounceDelay = 3000  # 3 seconds - wait for all file writes to complete (gives time after code generation)
$script:lastReloadTime = 0
$script:minReloadInterval = 10000  # Minimum 10 seconds between reloads (prevents rapid-fire reloads)

$fileChangeAction = {
    param($source, $fileEvent)
    
    $changedFile = $fileEvent.SourceEventArgs.FullPath
    $changeType = $fileEvent.SourceEventArgs.ChangeType
    
    # Comprehensive ignore patterns - ignore temporary files, editor files, node_modules, and runtime files
    $ignorePatterns = @(
        "node_modules",
        "\.tmp",
        "\.temp",
        "\.swp",
        "~$",
        "\.git",
        "\.vscode",
        "\.idea",
        "\.DS_Store",
        "Thumbs\.db",
        "desktop\.ini",
        "\.log$",
        "\.db$",
        "\.sqlite",
        "\\data\\",
        "\\audio\\",
        "\\logs\\",
        "\\recordings\\",
        "\\appdata\\",
        "\\docker-data\\",
        "scripts\\test-event-generator\.js",  # Don't reload when test generator changes
        "scripts\\file-watcher\.ps1",  # Don't reload when watcher itself changes
        "scripts\\live-reload\.ps1"  # Don't reload when live reload script changes
    )
    
    $shouldIgnore = $false
    foreach ($pattern in $ignorePatterns) {
        if ($changedFile -match $pattern) {
            $shouldIgnore = $true
            break
        }
    }
    
    if ($shouldIgnore) {
        return
    }
    
    # Check if we've reloaded too recently (rate limiting to prevent excessive reloads)
    $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $timeSinceLastReload = $now - $script:lastReloadTime
    if ($timeSinceLastReload -lt $script:minReloadInterval) {
        Write-Host "[Live Reload] Change detected but skipping (reloaded $([math]::Round($timeSinceLastReload/1000, 1))s ago, min interval: $([math]::Round($script:minReloadInterval/1000))s)" -ForegroundColor DarkYellow
        return
    }
    
    Write-Host "[Live Reload] $changeType detected: $changedFile" -ForegroundColor Yellow
    
    # Cancel previous debounce timer
    if ($script:debounceTimer) {
        $script:debounceTimer.Stop()
        $script:debounceTimer.Dispose()
    }
    
    # Create new debounce timer
    $script:debounceTimer = New-Object System.Timers.Timer
    $script:debounceTimer.Interval = $script:debounceDelay
    $script:debounceTimer.AutoReset = $false
    $script:debounceTimer.Add_Elapsed({
        $script:debounceTimer.Stop()
        $script:debounceTimer.Dispose()
        
        # Update last reload time
        $script:lastReloadTime = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
        
        Write-Host "[Live Reload] Reloading..." -ForegroundColor Green
        
        # Restart based on mode
        if ($Mode -eq "docker") {
            Restart-Docker
        } else {
            Restart-Local
        }
        
        # Wait a moment for service to restart
        Start-Sleep -Seconds 3
        
        # Refresh browser
        Invoke-BrowserRefresh
        
        Write-Host "[Live Reload] Reload complete. Next reload available in $([math]::Round($script:minReloadInterval/1000))s..." -ForegroundColor Cyan
    })
    
    $script:debounceTimer.Start()
}

# Create file system watchers
$watchers = @()
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptPath

foreach ($pattern in $watchPaths) {
    $fullPattern = Join-Path $projectRoot $pattern
    $directory = Split-Path -Parent $fullPattern
    $filePattern = Split-Path -Leaf $fullPattern
    
    if (-not (Test-Path $directory)) {
        continue
    }
    
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $directory
    $watcher.Filter = $filePattern
    $watcher.IncludeSubdirectories = $true
    $watcher.EnableRaisingEvents = $true
    
    # Register event handlers
    Register-ObjectEvent -InputObject $watcher -EventName "Changed" -Action $fileChangeAction | Out-Null
    Register-ObjectEvent -InputObject $watcher -EventName "Created" -Action $fileChangeAction | Out-Null
    Register-ObjectEvent -InputObject $watcher -EventName "Deleted" -Action $fileChangeAction | Out-Null
    Register-ObjectEvent -InputObject $watcher -EventName "Renamed" -Action $fileChangeAction | Out-Null
    
    $watchers += $watcher
    Write-Host "[Live Reload] Watching: $fullPattern" -ForegroundColor Cyan
}

Write-Host "[Live Reload] File watcher started in $Mode mode" -ForegroundColor Green
Write-Host "[Live Reload] Watching for changes. Press Ctrl+C to stop." -ForegroundColor Green
Write-Host ""

# Keep script running
try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    # Cleanup
    foreach ($watcher in $watchers) {
        $watcher.EnableRaisingEvents = $false
        $watcher.Dispose()
    }
    if ($script:debounceTimer) {
        $script:debounceTimer.Stop()
        $script:debounceTimer.Dispose()
    }
    Write-Host "[Live Reload] Stopped." -ForegroundColor Yellow
}

