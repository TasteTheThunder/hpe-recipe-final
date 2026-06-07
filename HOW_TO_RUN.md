# 🚀 HPE Recipe Detection — Complete Setup & Run Guide

This guide explains how to run the project locally with:

* React Frontend
* Spring Boot Backend
* Kubernetes (Minikube: dev + prod + qa + integration clusters)
* Helm
* Jenkins CI/CD (with CSRF crumb support)
* GitHub (GitOps-style integration)

---

# 📌 1. Prerequisites

| Tool     | Version | Check                      |
| -------- | ------- | -------------------------- |
| Java     | 17+     | `java -version`            |
| Maven    | 3.9+    | `mvn -version`             |
| Node.js  | 18+     | `node -v`                  |
| npm      | 9+      | `npm -v`                   |
| Docker   | Latest  | `docker -v`                |
| Minikube | Latest  | `minikube version`         |
| kubectl  | Latest  | `kubectl version --client` |
| Helm     | v3+     | `helm version`             |
| Jenkins  | Running | http://localhost:8080      |

---

# 🧠 2. Architecture Overview

```
React UI
   ↓
Spring Boot Backend
   ↓
GitHub (Helm values)
   ↓
Jenkins Pipeline
   ↓
Kubernetes (dev / prod / qa / integration)
```

---

# ⚙️ 3. Configuration (VERY IMPORTANT)

## 🔐 3.1 Environment Variables

These are required by the backend (especially for deploy flow). Set them before running Spring Boot.

Linux/macOS/WSL:

```bash
export JENKINS_USER=your-jenkins-username
export JENKINS_TOKEN=your-jenkins-api-token
export GIT_USERNAME=your-github-username
export GIT_TOKEN=your-github-token
```

PowerShell:

```powershell
$env:JENKINS_USER="your-jenkins-username"
$env:JENKINS_TOKEN="your-jenkins-api-token"
$env:GIT_USERNAME="your-github-username"
$env:GIT_TOKEN="your-github-token"
```

---

## 🔧 3.2 application.yml

Located in:

```
backend/src/main/resources/application.yml
```

```yaml
server:
  port: 8081
  servlet:
    context-path: /api

spring:
  application:
    name: recipe-detection-api

gitops:
  repo-url: https://github.com/TasteTheThunder/hpe-recipe.git (Your Repo URL)
  local-path: ${java.io.tmpdir}/hpe-recipe-gitops
  branch: main
  username: ${GIT_USERNAME:TasteTheThunder}
  token: ${GIT_TOKEN}
  values-dir: helm/recipe-detection-chart

jenkins:
  url: ${JENKINS_URL:http://localhost:8080}
  job: ${JENKINS_JOB:hpe-recipe}
  username: ${JENKINS_USER}
  token: ${JENKINS_TOKEN}

kubernetes:
  clusters:
    dev:
      context: dev
    prod:
      context: prod
    qa:
      context: qa
    integration:
      context: integration
```

---

# ☸️ 4. Setup Kubernetes (Minikube Multi-Cluster)

## Start clusters

```bash
minikube start -p dev
minikube start -p prod
minikube start -p qa
minikube start -p integration
```

## Verify contexts

```bash
kubectl config get-contexts
```

Expected:

```text
dev
prod
qa
integration
```

---

# 🔧 5. Setup Jenkins

## 5.1 Create Job

* Go to: http://localhost:8080
* Create job: `hpe-recipe`
* Type: Pipeline

## 5.2 Configure Pipeline

* Select: **Pipeline script from SCM**
* Repo: your GitHub repo
* Branch: `main`
* Script Path: `Jenkinsfile`

---

## 🔐 5.3 Enable API Trigger

* Go to: **Build Triggers**
* Enable:

  ```
  Trigger builds remotely
  ```
* Add token (optional)

---

## 🔒 5.4 CSRF (Crumb)

Your backend already handles crumb automatically ✅
(No need to disable CSRF)

---

# 🚀 6. Run Backend

```bash
cd backend
mvn clean spring-boot:run
```

Backend runs at:

```
http://localhost:8081/api
```

---

# 🌐 7. Run Frontend

```bash
cd frontend
npm install   # only first time
npm run dev
```

Frontend runs at:

```
http://localhost:3000
```

---

# 🧪 8. Verify Setup

```bash
curl http://localhost:8081/api/health
```

Expected:

```json
{"status":"UP","service":"recipe-detection-api"}
```

---

# 🚀 9. How Deployment Works

### Step 1: Create Release (from UI)

* Saves draft release in backend memory (no Kubernetes write yet)
* Release appears in UI so you can review/edit before deployment

### Step 2: Deploy (UI)

* Calls backend `POST /api/helm-releases/{version}/deploy?cluster=dev|prod|qa|integration`
* Backend marks draft as `deploying`, pushes GitOps values, and triggers Jenkins

### Step 3: Jenkins Pipeline

* Selects cluster (dev/prod/qa/integration)
* Runs Helm upgrade/install (first actual write to cluster)
* Calls backend status API (`deployed`/`failed`), then backend reads state from cluster

---

# ☸️ 10. Manual Helm Commands (Optional)

```bash
cd helm/recipe-detection-chart

# Install on dev cluster
kubectl config use-context dev
helm install recipe-dev . -f values-v0.0.1.yaml

# Install on prod cluster
kubectl config use-context prod
helm install recipe-prod . -f values-v0.0.2.yaml

# Install on qa cluster
kubectl config use-context qa
helm install recipe-qa . -f values-v0.0.3.yaml

# Install on integration cluster
kubectl config use-context integration
helm install recipe-integration . -f values-v0.0.4.yaml


# Delete
helm uninstall recipe-dev
```

---

# 🛑 11. Stop Clusters

```bash
minikube stop -p dev
minikube stop -p prod
minikube stop -p qa
minikube stop -p integration
```

---

# 🐳 12. Docker (Optional)

```bash
docker build -t hpe-recipe-detection .
docker run -p 8081:8081 hpe-recipe-detection
```

---

# ⚠️ 13. Troubleshooting

| Issue                  | Solution                      |
| ---------------------- | ----------------------------- |
| Jenkins not triggering | Check `/api/helm-releases/{version}/deploy?cluster=...` is called |
| 403 error Jenkins      | Ensure crumb is handled       |
| Frontend can't fetch   | Restart backend               |
| Helm install fails     | Use `helm upgrade`            |
| Cluster not found      | Check kube contexts           |

---

# 📁 14. Project Structure

```
hpe-recipe/
├── backend/
├── frontend/
├── helm/
├── Jenkinsfile
├── Dockerfile
└── README.md
```

---

# 🏁 Final Notes

```text
✔ Multi-cluster deployment (dev + prod + qa + integration)
✔ Jenkins CI/CD integrated
✔ Secure API (CSRF handled)
✔ GitOps-style workflow
```

---

# 🔥 One-line Summary

```text
Start backend → start frontend → create release → click deploy → Jenkins deploys to selected cluster
```
