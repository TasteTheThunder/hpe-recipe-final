# HPE Recipe Detection

HPE Recipe Detection is a GitOps-backed catalog and Helm release management
application. It lets users create and edit recipe catalogs, visualize recipe
upgrade paths, promote catalog versions through environments, and roll back an
environment to its previous successful deployment.

The current pipeline is:

```text
DEV -> QA -> INTEGRATION -> PROD
```

GitHub remains the source of truth for catalog metadata, environment state, and
deployment history. Kubernetes/Helm deployments are performed through Jenkins,
and Git environment state is finalized only after Jenkins reports a successful
deployment.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [State Model](#state-model)
- [Deployment Lifecycle](#deployment-lifecycle)
- [Rollback Semantics](#rollback-semantics)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Run Locally](#run-locally)
- [Build and Test](#build-and-test)
- [Jenkins and Helm Deployment](#jenkins-and-helm-deployment)
- [API Overview](#api-overview)
- [Troubleshooting](#troubleshooting)

## Features

- Environment-aware Recipe Manager UI for DEV, QA, INTEGRATION, and PROD.
- Visualizer UI for the currently deployed catalog version in the selected
  environment.
- Git-backed catalog versions under `catalogs/recipe-detection/versions`.
- DEV-first editing model: editing the active DEV catalog forks a new version.
- Sequential promotion model: DEV to QA, QA to INTEGRATION, INTEGRATION to PROD.
- Promote button is hidden when the target environment already has the same
  version.
- Rollback button is scoped to the currently selected environment only.
- Append-only environment deployment history for rollback timelines.
- Separate audit/event history shown in the Manager History panel.
- Clear History action for the UI audit/event log without touching rollback
  history.
- Helm values file generation for each catalog deployment.
- Jenkins-driven Helm install/upgrade/uninstall.
- WebSocket updates for release and deployment status changes.
- React Flow based visualizer for recipe/component relationships and upgrade
  paths.

## Architecture

```text
React UI
  |
  | HTTP /api and WebSocket /api/ws/releases
  v
Spring Boot Backend
  |
  | reads/writes catalog state with JGit
  v
GitHub Repository
  |
  | Jenkins checks out repo and uses generated Helm values files
  v
Jenkins Pipeline
  |
  | helm install / helm upgrade
  v
Kubernetes Clusters
```

Main components:

- Frontend: React 18, Vite, React Router, React Flow.
- Backend: Spring Boot 3.2, Java 17, JGit, Fabric8 Kubernetes client,
  WebSocket support.
- Deployment: Helm chart in `helm/recipe-detection-chart`.
- CI/CD: Jenkins pipeline defined in `Jenkinsfile`.
- Git state: YAML files under `catalogs/recipe-detection`.

## Repository Layout

```text
.
+-- backend/                         Spring Boot API
|   +-- src/main/java/com/hpe/recipe
|   |   +-- controller/              REST controllers
|   |   +-- service/                 GitOps, platform, mapping, Jenkins logic
|   |   +-- model/                   Catalog, release, recipe models
|   |   +-- config/                  WebSocket, Kubernetes, promotion config
|   +-- src/test/java/               Backend unit tests
+-- frontend/                        React + Vite UI
|   +-- src/
|       +-- App.jsx                  Visualizer page
|       +-- ManagePage.jsx           Recipe Manager page
|       +-- components/              UI components
|       +-- graph/                   Graph layout/build helpers
+-- helm/recipe-detection-chart/     Helm chart and generated values files
+-- catalogs/recipe-detection/       Git-backed catalog platform state
+-- scripts/                         Windows PowerShell helper scripts
+-- Jenkinsfile                      Jenkins Helm deploy pipeline
+-- Dockerfile                       Backend container build
```

## State Model

The platform state is stored in Git under:

```text
catalogs/recipe-detection/
+-- versions/
|   +-- <version>.yaml
+-- environments/
|   +-- dev.yaml
|   +-- qa.yaml
|   +-- integration.yaml
|   +-- prod.yaml
+-- environment-history/
|   +-- dev.yaml
|   +-- qa.yaml
|   +-- integration.yaml
|   +-- prod.yaml
+-- history.yaml
```

File responsibilities:

- `versions/<version>.yaml`: full catalog definition for a catalog version.
- `environments/<env>.yaml`: current deployed catalog version for one
  environment.
- `environment-history/<env>.yaml`: append-only chronological list of every
  successful deployment to that environment. This includes deploy, promote,
  edit, and rollback deployments.
- `history.yaml`: UI/event audit log with action, timestamp, version,
  environment, and optional `fromVersion`.

Important rules:

- For normal successful deployments, `environments/<env>.yaml` should match the
  latest entry in `environment-history/<env>.yaml`.
- `history.yaml` can be cleared from the UI.
- `environment-history/*.yaml` is not cleared by the History UI action because
  it drives rollback behavior.
- Delete/uninstall clears current environment pointers and removes the version
  file, but it does not rewrite chronological environment history.

## Deployment Lifecycle

The app intentionally defers Git environment updates until Jenkins confirms that
Helm deployment succeeded.

```text
1. User clicks Deploy, Promote, Edit, Create in DEV, or Rollback.
2. Backend validates the requested action.
3. Backend writes or renders catalog/Helm values data when needed.
4. Backend triggers Jenkins with:
   - CLUSTER
   - ACTION
   - CHART_VERSION
   - VALUES_FILE
   - DEPLOY_EVENT_ACTION
   - FROM_VERSION
5. UI shows a temporary deploying status.
6. Jenkins runs helm install or helm upgrade.
7. On success, Jenkins calls:
   PUT /api/helm-releases/{version}/status?cluster={env}
   body: {"status":"deployed","eventAction":"...","fromVersion":"..."}
8. Backend finalizes Git state:
   - updates environments/<env>.yaml
   - appends environment-history/<env>.yaml
   - appends history.yaml
9. UI refreshes from Git-backed state.
```

If Helm fails, Jenkins sends `status=failed` and Git environment state is not
updated.

If Jenkins never calls the backend after a successful Helm deployment, Git will
continue to show the old current environment version.

## Rollback Semantics

Rollback uses `environment-history/<env>.yaml` as a deployment timeline.

It targets the immediately previous successful deployment entry:

```yaml
- 2.1.0
- 2.1.1
- 2.1.2
- 2.1.1
- 2.2.0
```
If `2.2.0` is current, rollback targets `2.1.1`.


## Prerequisites

For local development:

- Java 17
- Maven 3.9+
- Node.js 18+
- npm
- Git

For deployment workflows:

- Jenkins with access to this repository
- Helm
- kubectl
- Kubernetes contexts named `dev`, `qa`, `integration`, and `prod`
- GitHub token with permission to push to the configured repository
- Jenkins API token for triggering builds

## Configuration

Backend configuration lives in:

```text
backend/src/main/resources/application.yml
```

Default backend URL:

```text
http://localhost:8081/api
```

Key environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `GIT_USERNAME` | Git username for JGit operations | configured in `application.yml` |
| `GIT_TOKEN` | Git token for clone/push | empty |
| `JENKINS_URL` | Jenkins base URL | `http://localhost:8080` |
| `JENKINS_JOB` | Jenkins job name | `hpe-recipe-final` |
| `JENKINS_USER` | Jenkins username | configured in `application.yml` |
| `JENKINS_TOKEN` | Jenkins API token | empty |
| `GITOPS_STATE_CACHE_TTL_SECONDS` | Git state read cache TTL | `8` |

For PowerShell users, copy the example file and fill in real secrets:

```powershell
Copy-Item scripts/setup-env.example.ps1 scripts/setup-env.ps1
notepad scripts/setup-env.ps1
```

## Run Locally

### 1. Start the backend

Linux/macOS:

```bash
export GIT_USERNAME="<github-username>"
export GIT_TOKEN="<github-token>"
export JENKINS_USER="<jenkins-user>"
export JENKINS_TOKEN="<jenkins-token>"
export JENKINS_URL="http://localhost:8080"
export JENKINS_JOB="hpe-recipe-final"

cd backend
mvn spring-boot:run
```

Windows PowerShell:

```powershell
Copy-Item scripts/setup-env.example.ps1 scripts/setup-env.ps1
# edit scripts/setup-env.ps1 with real credentials
.\scripts\start-backend.ps1
```

Backend health check:

```bash
curl http://localhost:8081/api/actuator/health
```

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

The Vite dev server proxies `/api` requests to `http://localhost:8081`.

Windows PowerShell all-in-one helper:

```powershell
.\scripts\start-dev.ps1
```

## Build and Test

Backend:

```bash
cd backend
mvn clean install
```

Frontend:

```bash
cd frontend
npm test
npm run build
```

Docker backend image:

```bash
docker build -t hpe-recipe-detection:local .
```

## Jenkins and Helm Deployment

The Jenkins pipeline is defined in `Jenkinsfile`.

Important Jenkins parameters:

| Parameter | Description |
| --- | --- |
| `ALLOW_DEPLOY` | Must be `yes` for Helm actions |
| `CLUSTER` | Target cluster: `dev`, `qa`, `integration`, or `prod` |
| `ACTION` | `deploy` or `uninstall` |
| `CHART_VERSION` | Catalog/chart version to deploy |
| `VALUES_FILE` | Values file to use, for example `values-v2.1.3.yaml` |
| `DEPLOY_EVENT_ACTION` | Backend completion action such as `deploy`, `promote`, `edit`, or `rollback` |
| `FROM_VERSION` | Previous/source version for audit history |

The backend generates version-specific Helm values files in:

```text
helm/recipe-detection-chart/values-v<version>.yaml
```

Jenkins validates that the values file target cluster matches the requested
cluster before deploying.

The Helm chart installs a ConfigMap containing `recipe-data.json`, which the
backend can read through the Kubernetes API for legacy release/detail endpoints.

## API Overview

Base path:

```text
/api
```

Platform endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/pipeline` | Return environment pipeline order |
| `GET` | `/environments` | Return current version per environment |
| `GET` | `/versions` | List catalog versions |
| `GET` | `/versions/{version}` | Get catalog version details |
| `GET` | `/versions/{version}/promotion-options` | Get promote/rollback options |
| `POST` | `/versions` | Create a catalog version |
| `POST` | `/versions?deployToDev=true` | Create and deploy when DEV has no active catalog |
| `POST` | `/versions/{version}/deploy` | Deploy existing version to DEV |
| `POST` | `/versions/{version}/promote?to={env}` | Promote to next environment |
| `POST` | `/environments/{env}/rollback` | Roll back selected environment |
| `DELETE` | `/versions/{version}` | Uninstall/delete a version |
| `GET` | `/history` | Read deployment audit/event history |
| `DELETE` | `/history` | Clear UI audit/event history only |

Helm release endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/helm-releases?cluster={env}` | List currently deployed release for environment |
| `GET` | `/helm-releases/{version}?cluster={env}` | Get release details |
| `POST` | `/helm-releases/{version}/deploy?cluster={env}` | Deploy or promote through legacy-compatible route |
| `PUT` | `/helm-releases/{version}/status?cluster={env}` | Jenkins status callback |

WebSocket:

```text
ws://localhost:8081/api/ws/releases
```

Events include `status_changed`, `version_created`, `release_deleted`,
`recipe_added`, `recipe_updated`, and `recipe_deleted`.

## UI Pages

- Visualizer: `/`
  - Select environment.
  - See only the version currently deployed in that environment.
  - Inspect recipe/component graph and upgrade paths.

- Recipe Manager: `/catalogs`
  - Create the first catalog.
  - Edit the active DEV catalog to fork a new version.
  - Promote through the pipeline.
  - Roll back the selected environment.
  - View or clear the UI audit/event history.

## Development Notes

- New versions are created from DEV edits. Editing QA, INTEGRATION, or PROD is
  intentionally not part of the workflow.
- Non-DEV environments receive versions only through promotion.
- Promote is hidden when promoting would be a no-op because the target
  environment already has the same version.
- Rollback is environment-scoped and uses append-only successful deployment
  history.
- Git state is cached briefly for reads. Mutations sync and push through JGit.
- If the frontend shows stale data, use Refresh or restart the backend to force
  a fresh Git read.

## Troubleshooting

Backend cannot push to Git:

- Check `GIT_USERNAME` and `GIT_TOKEN`.
- Confirm the token has permission to push to the configured repo.
- Check `gitops.repo-url` and `gitops.branch`.

Deploy stays in `deploying`:

- Check whether Jenkins completed successfully.
- Check whether Jenkins reached the backend callback endpoint.
- If Helm succeeded but the callback failed, Git current environment state will
  remain on the old version.

Jenkins fails with cluster mismatch:

- Open the generated values file under `helm/recipe-detection-chart`.
- Confirm `recipeData.target_cluster` matches the Jenkins `CLUSTER` parameter.

Frontend cannot load releases:

- Confirm backend is running on `http://localhost:8081/api`.
- Confirm Vite is running on port `3000`.
- Check browser dev tools for failed `/api` calls.

Rollback is not shown:

- The selected environment needs at least two successful entries in
  `environment-history/<env>.yaml`.
- Make sure you are viewing the environment you want to roll back.

## License

This project was developed for Hewlett Packard Enterprise (HPE) as part of an internal project. Licensing and usage rights are subject to HPE policies.
