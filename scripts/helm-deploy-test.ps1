# Manual deploy — TEST release v9.0.6 (HPE Analytics Runtime, recipes 2.0.0 / 2.0.1)
# No UI. Use this to practice install/upgrade before the demo.

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$ChartDir = Join-Path $Root "helm\recipe-detection-chart"
$ValuesFile = Join-Path $ChartDir "values-v9.0.6.yaml"
$Cluster = "dev"
$ChartVersion = "9.0.6"
$ReleaseName = "recipe-$Cluster"

Write-Host "Deploying TEST release $ReleaseName on $Cluster ..." -ForegroundColor Cyan

kubectl --context=$Cluster get nodes | Out-Null

helm --kube-context $Cluster upgrade --install $ReleaseName $ChartDir `
  --namespace default `
  -f $ValuesFile

Write-Host ""
Write-Host "Done. Verify:" -ForegroundColor Green
Write-Host "  helm --kube-context $Cluster list"
Write-Host "  kubectl --context=$Cluster get configmaps -l app.kubernetes.io/name=recipe-detection"
