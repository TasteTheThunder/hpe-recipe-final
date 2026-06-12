# Start all 4 minikube clusters for the promotion pipeline (dev -> qa -> integration -> prod)

$ErrorActionPreference = "Stop"
$profiles = @("dev", "qa", "integration", "prod")

foreach ($p in $profiles) {
    Write-Host "Starting minikube profile: $p" -ForegroundColor Cyan
    minikube start -p $p --driver=docker
    kubectl --context=$p get nodes
}

Write-Host ""
Write-Host "All clusters ready. Promotion pipeline: DEV -> QA -> INTEGRATION -> PROD" -ForegroundColor Green
Write-Host "Verify: kubectl config get-contexts"
