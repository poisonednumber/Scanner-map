# file-watcher.ps1
# PowerShell script to watch for file changes and trigger reload

param(
    [string]$WatchPath = ".",
    [string]$ActionScript = "",
    [string[]]$FilePatterns = @("*.js", "*.html", "*.css")
)

$action = {
    param($source, $event)
    
    $changedFile = $event.SourceEventArgs.FullPath
    $changeType = $event.SourceEventArgs.ChangeType
    
    Write-Host "[File Watcher] $changeType detected: $changedFile" -ForegroundColor Yellow
    
    if ($ActionScript) {
        Write-Host "[File Watcher] Executing action script..." -ForegroundColor Green
        & $ActionScript
    }
}

# Create file system watchers for each pattern
$watchers = @()

foreach ($pattern in $FilePatterns) {
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = (Resolve-Path $WatchPath).Path
    $watcher.Filter = $pattern
    $watcher.IncludeSubdirectories = $true
    $watcher.EnableRaisingEvents = $true
    
    # Register event handler
    Register-ObjectEvent -InputObject $watcher -EventName "Changed" -Action $action | Out-Null
    Register-ObjectEvent -InputObject $watcher -EventName "Created" -Action $action | Out-Null
    Register-ObjectEvent -InputObject $watcher -EventName "Deleted" -Action $action | Out-Null
    Register-ObjectEvent -InputObject $watcher -EventName "Renamed" -Action $action | Out-Null
    
    $watchers += $watcher
    Write-Host "[File Watcher] Watching for $pattern in $WatchPath" -ForegroundColor Cyan
}

Write-Host "[File Watcher] File watcher started. Press Ctrl+C to stop." -ForegroundColor Green

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
    Write-Host "[File Watcher] Stopped." -ForegroundColor Yellow
}

