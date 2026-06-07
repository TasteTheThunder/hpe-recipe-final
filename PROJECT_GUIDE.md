# HPE Recipe Detection - Current Project Guide

## What This Project Does

This project manages Helm release recipe metadata and deployment status for four Kubernetes targets (`dev`, `prod`, `qa`, `integration`).

Engineers can:
- Create a Helm release draft from UI
- Add recipes and component versions
- Trigger deployment through GitOps + Jenkins
- Watch deployment status in real time via WebSocket
- Visualize recipe/component and upgrade relationships

## Current End-to-End Flow

1. User creates a release in `/manage`.
2. Backend stores it as draft in backend memory (not in Kubernetes).
3. User clicks Deploy.
4. Backend sets status to `deploying`, generates `values-v<version>.yaml`, updates `Chart.yaml`, commits and pushes to Git.
5. Backend triggers Jenkins `buildWithParameters` with `CLUSTER=dev|prod|qa|integration` (with Jenkins crumb and basic auth).
6. Jenkins runs Helm install/upgrade on the selected kube-context.
7. Jenkins calls `PUT /api/helm-releases/{version}/status?cluster=...` with `deployed` or `failed`.
8. Backend broadcasts status changes over WebSocket and, on `deployed`, removes draft state if Helm-managed data is present.
9. Frontend receives event and refetches data.

## Architecture Snapshot

- Frontend: React + Vite (`/` visualizer, `/manage` manager)
- Backend: Spring Boot API on port `8081`, context path `/api`
- Real-time: native WebSocket endpoint `/api/ws/releases`
- GitOps: JGit writes values file and chart version, then pushes
- CI/CD: Jenkins deploys Helm chart to selected cluster context
- Kubernetes data source: Helm-managed ConfigMap data per release version

## Tech Stack (Current)

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, React Router, React Flow, Dagre |
| Backend | Spring Boot 3.2.5, Java 17 |
| Realtime | Spring WebSocket + browser WebSocket client |
| GitOps | JGit + SnakeYAML |
| K8s access | Fabric8 Kubernetes Client |
| CI/CD | Jenkins Pipeline |
| Packaging | Docker multi-stage build |
| Helm | Helm v3 chart (`recipe-detection`) |

## Current Repository Structure

```
hpe-recipe/
|- backend/
|  |- src/main/java/com/hpe/recipe/
|  |  |- controller/
|  |  |  |- HealthController.java
|  |  |  |- HelmReleaseController.java
|  |  |  |- CatalogController.java
|  |  |  |- RecipeController.java
|  |  |- service/
|  |  |  |- HelmReleaseService.java
|  |  |  |- GitOpsService.java
|  |  |  |- CatalogService.java
|  |  |- config/
|  |  |  |- WebSocketConfig.java
|  |  |  |- ReleaseWebSocketHandler.java
|  |- src/main/resources/application.yml
|  |- pom.xml
|- frontend/
|  |- src/
|  |  |- main.jsx
|  |  |- App.jsx
|  |  |- ManagePage.jsx
|  |  |- useRealtimeReleases.js
|  |- package.json
|  |- vite.config.js
|- helm/recipe-detection-chart/
|  |- Chart.yaml
|  |- values.yaml
|  |- values-v*.yaml
|  |- templates/
|  |  |- configmap.yaml
|  |  |- _helpers.tpl
|- Jenkinsfile
|- Dockerfile
|- HOW_TO_RUN.md
|- PROJECT_GUIDE.md
```

## Frontend Pages

### 1) Visualizer (`/`)

Capabilities currently present:
- Cluster selector (`dev` / `prod` / `qa` / `integration` via query param)
- Helm version timeline
- Recipe dependency graph (React Flow + Dagre)
- Component expansion for selected recipe
- Compare dropdown using `/api/helm-releases/compare`
- Stats bar and detail panel
- Live refresh from WebSocket events

### 2) Manage (`/manage`)

Capabilities currently present:
- Create release form with draft recipes/components
- List releases with status badges
- Expand release to inspect recipes/components/upgrade links
- Edit/delete recipes
- Delete release
- Deploy button (`POST /api/helm-releases/{version}/deploy?cluster=...`)
- Toasts and real-time status updates

## Backend Behavior (Important)

### Release storage model

- Before deployment: release exists as in-memory draft in backend (`HelmReleaseService`).
- After deployment: Helm-managed ConfigMap becomes the deployed source.
- On `deployed` status update, backend removes draft if Helm-managed release exists.

### Status lifecycle

Common statuses observed in current code:
- `pending`
- `deploying`
- `deployed`
- `failed`
- `push_failed`

## API Endpoints (Current)

Note: Helm release APIs are cluster-scoped and require `cluster` query param.

### Helm Releases

| Method | Endpoint |
| --- | --- |
| GET | `/api/helm-releases?cluster=dev|prod|qa|integration` |
| GET | `/api/helm-releases/{version}?cluster=dev|prod|qa|integration` |
| POST | `/api/helm-releases?cluster=dev|prod|qa|integration` |
| PUT | `/api/helm-releases/{version}?cluster=dev|prod|qa|integration` |
| DELETE | `/api/helm-releases/{version}?cluster=dev|prod|qa|integration` |
| PUT | `/api/helm-releases/{version}/status?cluster=dev|prod|qa|integration` |
| POST | `/api/helm-releases/{version}/deploy?cluster=dev|prod|qa|integration` |
| GET | `/api/helm-releases/compare?cluster=dev|prod|qa|integration&from=X&to=Y` |

### Recipes Within Release

| Method | Endpoint |
| --- | --- |
| GET | `/api/helm-releases/{v}/recipes?cluster=dev|prod|qa|integration` |
| POST | `/api/helm-releases/{v}/recipes?cluster=dev|prod|qa|integration` |
| PUT | `/api/helm-releases/{v}/recipes/{rv}?cluster=dev|prod|qa|integration` |
| DELETE | `/api/helm-releases/{v}/recipes/{rv}?cluster=dev|prod|qa|integration` |
| GET | `/api/helm-releases/{v}/recipes/{rv}/components?cluster=dev|prod|qa|integration` |
| GET | `/api/helm-releases/{v}/recipes/{rv}/upgradePaths?cluster=dev|prod|qa|integration` |

### Legacy Catalog APIs

| Method | Endpoint |
| --- | --- |
| GET | `/api/catalogs` |
| GET | `/api/catalogs/{catalogVersion}/recipes` |
| GET | `/api/recipes/{recipeVersion}/components` |
| GET | `/api/recipes/{recipeVersion}/upgradePaths` |

### Health

| Method | Endpoint |
| --- | --- |
| GET | `/api/health` |

## WebSocket Contract

- Endpoint used by frontend: `ws://<host>:8081/api/ws/releases?cluster=dev|prod|qa|integration`
- Server registration path: `/api/ws/releases`

Events broadcast:
- `release_created`
- `release_updated`
- `release_deleted`
- `recipe_added`
- `recipe_updated`
- `recipe_deleted`
- `status_changed`

Payload shape:

```json
{
  "event": "status_changed",
  "data": { "version": "0.0.8", "status": "deploying", "cluster": "dev" },
  "timestamp": 1710000000000
}
```

## Jenkins Pipeline (Current Stages)

`Jenkinsfile` currently executes these stages:

1. Checkout
2. Validate Cluster Access (`kubectl --context=<cluster> get nodes`)
3. Determine Chart Version (reads `Chart.yaml`, chooses matching `values-v<version>.yaml`)
4. Deploy Helm (Config Only) (`helm install` or `helm upgrade` with `--kube-context`)
5. Verify ConfigMap
6. Update Backend Status (`deployed`)

Post actions:
- `failure`: sends status `failed` to backend API
- `always`: cleans Jenkins workspace

## Helm Chart State (Current)

Current chart templates include:
- `templates/configmap.yaml`
- `templates/_helpers.tpl`

This means the chart currently renders recipe metadata ConfigMap and labels/helpers. Deployment/Service templates are not present in current chart template directory.

## Configuration (Current)

Key runtime settings in `backend/src/main/resources/application.yml`:

- Server: `8081`, context path `/api`
- GitOps repo: `https://github.com/TasteTheThunder/hpe-recipe.git`
- GitOps local clone path: `${java.io.tmpdir}/hpe-recipe-gitops`
- Jenkins URL/job from env with defaults:
  - `JENKINS_URL` default `http://localhost:8080`
  - `JENKINS_JOB` default `hpe-recipe`
- Cluster contexts configured:
  - `dev -> dev`
  - `prod -> prod`
  - `qa -> qa`
  - `integration -> integration`

Required environment variables for deploy flow:
- `JENKINS_USER`
- `JENKINS_TOKEN`
- `GIT_USERNAME` (optional default exists)
- `GIT_TOKEN`

## Local Run Notes

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Backend can be started in two ways:
- From IDE (Spring Boot run configuration), or
- Via Maven command line if Maven is installed.

This project does not require Maven to be installed on your machine if you run backend directly from your IDE setup.

## Known Characteristics

- Draft releases are in backend memory before deployment.
- If backend restarts before deployment completes, drafts are lost.
- Once deployed and status is updated, cluster-held Helm-managed data is used.
