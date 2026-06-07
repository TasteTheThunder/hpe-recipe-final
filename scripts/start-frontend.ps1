$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Set-Location (Join-Path $root "frontend")
if (-not (Test-Path "node_modules")) {
    npm install
}
npm run dev
