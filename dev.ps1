# MarginAgent — dev launcher
# Run this from D:\AI\Projects\MarginAgent:  .\dev.ps1

$env:RUSTUP_HOME  = "D:\Software\Rust\rustup"
$env:CARGO_HOME   = "D:\Software\Rust\cargo"
$env:PATH        += ";D:\Software\Rust\cargo\bin"
$env:PATH        += ";D:\Software\VS2022BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64"
$env:PATH        += ";C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64"
$env:LIB          = "D:\Software\VS2022BuildTools\VC\Tools\MSVC\14.44.35207\lib\x64;" +
                    "C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\um\x64;" +
                    "C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\ucrt\x64"
$env:INCLUDE      = "D:\Software\VS2022BuildTools\VC\Tools\MSVC\14.44.35207\include;" +
                    "C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\um;" +
                    "C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\ucrt;" +
                    "C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\shared"

Set-Location $PSScriptRoot

# Kill any leftover instances
Get-Process node, marginagent -ErrorAction SilentlyContinue | Stop-Process -Force

# Start Vite
Write-Host "Starting Vite..." -ForegroundColor Cyan
$vite = Start-Process powershell -ArgumentList "-NoProfile -Command `"node_modules/.bin/vite.cmd`"" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 2

# Start Tauri
Write-Host "Starting MarginAgent..." -ForegroundColor Cyan
Set-Location src-tauri
.\target\debug\marginagent.exe

# Cleanup on exit
Stop-Process -Id $vite.Id -ErrorAction SilentlyContinue
Write-Host "Stopped." -ForegroundColor Yellow
