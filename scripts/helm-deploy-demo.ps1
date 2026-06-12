# Manual deploy — DEMO release v9.0.5 (HPE Alletra MP Block, recipes 1.5.1 / 1.5.2)
# No UI. Requires: helm, kubectl, minikube profile "dev" running

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$ChartDir = Join-Path $Root "helm\recipe-detection-chart"
$ValuesFile = Join-Path $ChartDir "values-v9.0.5.yaml"
$Cluster = "dev"
$ChartVersion = "9.0.5"
$ReleaseName = "recipe-$Cluster"

Write-Host "Deploying DEMO release $ReleaseName on $Cluster ..." -ForegroundColor Cyan

kubectl --context=$Cluster get nodes | Out-Null

helm --kube-context $Cluster upgrade --install $ReleaseName $ChartDir `
  --namespace default `
  -f $ValuesFile

Write-Host ""
Write-Host "Done. Verify:" -ForegroundColor Green
Write-Host "  helm --kube-context $Cluster list"
Write-Host "  kubectl --context=$Cluster get configmaps -l app.kubernetes.io/name=recipe-detection"
