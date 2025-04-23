@echo off
:: Check for Admin privileges
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Requesting administrative privileges...
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    :: Now running with Admin privileges
    echo Running PowerShell script install_scanner_map.ps1...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_scanner_map.ps1"

    echo.
    echo Script execution finished. Press any key to exit.
    pause > nul
    exit /B