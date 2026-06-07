$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$envFile = Join-Path $PSScriptRoot "setup-env.ps1"
if (-not (Test-Path $envFile)) {
    Write-Error "Missing $envFile — copy scripts/setup-env.example.ps1 to scripts/setup-env.ps1 first."
}
. $envFile

Write-Host "Starting backend on http://localhost:8081/api ..."
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $PSScriptRoot "start-backend.ps1")

Start-Sleep -Seconds 2

Write-Host "Starting frontend on http://localhost:3000 ..."
Set-Location (Join-Path $root "frontend")
if (-not (Test-Path "node_modules")) {
    npm install
}
npm run dev
