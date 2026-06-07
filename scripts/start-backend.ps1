$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$envFile = Join-Path $PSScriptRoot "setup-env.ps1"
if (-not (Test-Path $envFile)) {
    Write-Error "Missing $envFile — copy scripts/setup-env.example.ps1 to scripts/setup-env.ps1 first."
}
. $envFile

Set-Location (Join-Path $root "backend")
mvn spring-boot:run
