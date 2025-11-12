# Deployment Guide

Comprehensive guide for deploying StatCastle in various environments.

## Table of Contents

1. [Docker Deployment](#docker-deployment)
2. [Local Deployment](#local-deployment)
3. [GitHub Pages](#github-pages)
4. [Kubernetes](#kubernetes)
5. [Cloud Platforms](#cloud-platforms)
6. [Troubleshooting](#troubleshooting)

---

## Docker Deployment

### Prerequisites

- Docker 20.10+ installed
- Docker Compose 2.0+ (optional, but recommended)
- 2GB+ free disk space
- 2GB+ RAM available for Docker

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/<your-username>/statcastle.git
cd statcastle

# 2. Configure
cp config.sample.yaml config.yaml
# Edit config.yaml with your team details

# 3. Run
docker-compose up
```

### Production Deployment

For production use, consider:

1. **Use specific image tags:**
   ```bash
   docker build -t statcastle:v1.3.0 .
   ```

2. **Run as a service:**
   ```bash
   docker run -d \
     --name statcastle \
     --restart unless-stopped \
     -v $(pwd)/config.yaml:/app/config.yaml:ro \
     -v $(pwd)/cricclubs_export_out:/app/cricclubs_export_out \
     -v $(pwd)/team_dashboard:/app/team_dashboard \
     statcastle:v1.3.0 \
     sh -c "python3 cricclubs_export.py && python3 analyze.py"
   ```

3. **Schedule with cron:**
   ```bash
   # Add to crontab (crontab -e)
   0 2 * * 1 cd /path/to/statcastle && docker-compose up
   ```

### Docker Compose for Production

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  statcastle:
    build:
      context: .
      dockerfile: Dockerfile
    image: statcastle:latest
    restart: unless-stopped
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./cricclubs_export_out:/app/cricclubs_export_out
      - ./team_dashboard:/app/team_dashboard
    environment:
      - HEADLESS=1
      - MAX_LEAGUE_WORKERS=3
      - MAX_MATCH_WORKERS=4
    command: >
      sh -c "
        python3 cricclubs_export.py &&
        python3 analyze.py
      "
```

Run with:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Local Deployment

### System Requirements

- **OS:** Linux, macOS, or Windows (WSL2 recommended)
- **Python:** 3.11 or higher
- **RAM:** 2GB minimum, 4GB recommended
- **Disk:** 500MB for installation, 1GB+ for data

### Installation Steps

#### 1. Install Python Dependencies

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install packages
pip install -r requirements.txt
```

#### 2. Install Playwright Browser

```bash
playwright install chromium
playwright install-deps chromium  # Linux only
```

#### 3. Configure

```bash
cp config.sample.yaml config.yaml
# Edit config.yaml
```

#### 4. Run

```bash
# Export data
python3 cricclubs_export.py

# Generate dashboard
python3 analyze.py

# View dashboard
open team_dashboard/index.html
```

### Running as a Service (Linux)

Create systemd service `/etc/systemd/system/statcastle.service`:

```ini
[Unit]
Description=StatCastle Analysis Service
After=network.target

[Service]
Type=oneshot
User=your-user
WorkingDirectory=/path/to/statcastle
ExecStart=/usr/bin/python3 /path/to/statcastle/cricclubs_export.py
ExecStart=/usr/bin/python3 /path/to/statcastle/analyze.py
Environment="PATH=/path/to/statcastle/.venv/bin"

[Install]
WantedBy=multi-user.target
```

Create timer `/etc/systemd/system/statcastle.timer`:

```ini
[Unit]
Description=Weekly StatCastle Update
Requires=statcastle.service

[Timer]
OnCalendar=Mon 02:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:
```bash
sudo systemctl enable statcastle.timer
sudo systemctl start statcastle.timer
```

---

## GitHub Pages

### Automatic Deployment

StatCastle includes GitHub Actions workflow for automatic deployment.

#### Setup

1. **Enable GitHub Pages:**
   - Repository → Settings → Pages
   - Source: **GitHub Actions**

2. **Configure workflow:**
   - Workflow is already configured in `.github/workflows/ci.yml`
   - Runs on push to `main` branch
   - Also runs weekly (Monday 12:00 UTC)

3. **Push changes:**
   ```bash
   git add .
   git commit -m "Update dashboard"
   git push origin main
   ```

4. **Access dashboard:**
   ```
   https://<username>.github.io/statcastle/team_dashboard/
   ```

### Manual Deployment

If you prefer manual deployment:

```bash
# Generate dashboard
python3 cricclubs_export.py && python3 analyze.py

# Commit and push
git add team_dashboard/
git commit -m "Update dashboard"
git push origin main

# GitHub Pages will serve from team_dashboard/ directory
```

### Custom Domain

1. Add `CNAME` file in `team_dashboard/`:
   ```
   stats.yourteam.com
   ```

2. Configure DNS:
   - Add CNAME record pointing to `<username>.github.io`

3. Update GitHub Pages settings:
   - Settings → Pages → Custom domain

---

## Kubernetes

### Prerequisites

- Kubernetes cluster (1.20+)
- kubectl configured
- PersistentVolume support

### Quick Deployment

#### 1. Create ConfigMap

```bash
kubectl create configmap statcastle-config \
  --from-file=config.yaml=./config.yaml
```

#### 2. Create PersistentVolumeClaims

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: statcastle-export-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: statcastle-dashboard-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```

Apply:
```bash
kubectl apply -f pvc.yaml
```

#### 3. Deploy Job

See [DOCKER.md](DOCKER.md) for complete Kubernetes examples.

#### 4. Schedule with CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: statcastle-weekly
spec:
  schedule: "0 2 * * 1"  # Every Monday at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: statcastle
            image: statcastle:latest
            # ... (see DOCKER.md for full config)
          restartPolicy: OnFailure
```

### Accessing Dashboard from K8s

**Option 1: NodePort Service**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: statcastle-dashboard
spec:
  type: NodePort
  ports:
  - port: 80
    targetPort: 8000
    nodePort: 30080
  selector:
    app: statcastle-dashboard
```

**Option 2: Ingress**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: statcastle-ingress
spec:
  rules:
  - host: stats.yourteam.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: statcastle-dashboard
            port:
              number: 80
```

---

## Cloud Platforms

### AWS

#### ECS (Elastic Container Service)

1. **Push image to ECR:**
   ```bash
   aws ecr create-repository --repository-name statcastle
   docker tag statcastle:latest <account>.dkr.ecr.<region>.amazonaws.com/statcastle:latest
   docker push <account>.dkr.ecr.<region>.amazonaws.com/statcastle:latest
   ```

2. **Create ECS Task Definition:**
   - Use Fargate or EC2
   - Mount EFS for persistent storage
   - Set environment variables

3. **Schedule with EventBridge:**
   - Create rule for weekly execution
   - Target ECS task

#### Lambda (with limitations)

StatCastle requires Playwright, which is challenging in Lambda. Consider:
- Using Lambda Layers for dependencies
- Running in container (up to 10GB)
- Or use ECS/Fargate instead

### Google Cloud Platform

#### Cloud Run (Jobs)

```bash
# Build and push
gcloud builds submit --tag gcr.io/<project>/statcastle

# Create Cloud Run Job
gcloud run jobs create statcastle \
  --image gcr.io/<project>/statcastle \
  --region us-central1 \
  --set-env-vars HEADLESS=1

# Schedule with Cloud Scheduler
gcloud scheduler jobs create http statcastle-weekly \
  --schedule="0 2 * * 1" \
  --uri="https://<region>-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/<project>/jobs/statcastle:run" \
  --http-method=POST \
  --oauth-service-account-email=<service-account>@<project>.iam.gserviceaccount.com
```

### Azure

#### Container Instances

```bash
# Build and push to ACR
az acr build --registry <registry> --image statcastle:latest .

# Create container instance
az container create \
  --resource-group <rg> \
  --name statcastle \
  --image <registry>.azurecr.io/statcastle:latest \
  --cpu 2 \
  --memory 4 \
  --environment-variables HEADLESS=1 \
  --azure-file-volume-share-name statcastle-data \
  --azure-file-volume-account-name <storage> \
  --azure-file-volume-mount-path /app/team_dashboard
```

#### Azure Container Apps

```bash
az containerapp create \
  --name statcastle \
  --resource-group <rg> \
  --image <registry>.azurecr.io/statcastle:latest \
  --environment <env> \
  --cpu 2 \
  --memory 4Gi
```

---

## Troubleshooting

### Docker Issues

**Problem:** Container runs out of memory
- **Solution:** Increase Docker memory limit (Settings → Resources)
- Reduce `MAX_LEAGUE_WORKERS` and `MAX_MATCH_WORKERS`

**Problem:** Playwright browser not found
- **Solution:** Ensure `playwright install chromium` ran in Dockerfile
- Check Dockerfile includes browser installation step

**Problem:** Permission denied on volumes
- **Solution:** 
  ```bash
  sudo chown -R $USER:$USER cricclubs_export_out team_dashboard
  ```

### Local Deployment Issues

**Problem:** `ModuleNotFoundError`
- **Solution:** 
  ```bash
  source .venv/bin/activate
  pip install -r requirements.txt
  ```

**Problem:** Playwright timeout
- **Solution:**
  - Check internet connection
  - Try `HEADLESS=0` to see browser
  - Increase timeout in code
  - Check CricClubs site accessibility

**Problem:** No matches found
- **Solution:**
  - Verify `team_id`, `league_id`, `club_id` in config.yaml
  - Check team URL is accessible
  - Try fetching one match manually

### GitHub Pages Issues

**Problem:** Dashboard not updating
- **Solution:**
  - Check Actions tab for workflow errors
  - Verify `config.yaml` exists (may need to add to repo or use secrets)
  - Check Pages settings (Source: GitHub Actions)

**Problem:** 404 on GitHub Pages
- **Solution:**
  - Ensure `team_dashboard/` is in repository
  - Check Pages source is set correctly
  - Verify `index.html` exists in `team_dashboard/`

### Kubernetes Issues

**Problem:** Pod fails to start
- **Solution:**
  ```bash
  kubectl describe pod <pod-name>
  kubectl logs <pod-name>
  ```

**Problem:** PVC not mounting
- **Solution:**
  - Check PVC exists: `kubectl get pvc`
  - Verify access mode matches (ReadWriteOnce vs ReadWriteMany)
  - Check storage class is available

**Problem:** Job completes but no data
- **Solution:**
  - Check job logs: `kubectl logs job/<job-name>`
  - Verify ConfigMap is mounted correctly
  - Check PVC has data: `kubectl exec -it <pod> -- ls /app/team_dashboard`

### Performance Optimization

**For large datasets:**
- Increase `MAX_LEAGUE_WORKERS` and `MAX_MATCH_WORKERS`
- Use faster storage (SSD)
- Increase container memory
- Consider parallel processing

**For slow networks:**
- Increase `MATCH_DELAY`
- Reduce parallel workers
- Use caching (don't set `FORCE_REFRESH=1`)

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADLESS` | `1` | Playwright headless mode (0=visible, 1=headless) |
| `MAX_LEAGUE_WORKERS` | `3` | Parallel leagues to process |
| `MAX_MATCH_WORKERS` | `4` | Parallel matches per league |
| `MATCH_DELAY` | `0.3` | Delay between requests (seconds) |
| `FORCE_REFRESH` | `0` | Force re-fetch (1=yes, 0=no) |

---

## Security Considerations

1. **Never commit `config.yaml`** with sensitive data
2. **Use secrets** for API keys (if added in future)
3. **Restrict access** to persistent volumes
4. **Use read-only mounts** for config files
5. **Regular updates** for security patches

---

## Backup and Recovery

### Backup Strategy

```bash
# Backup data
tar -czf statcastle-backup-$(date +%Y%m%d).tar.gz \
  cricclubs_export_out/ \
  team_dashboard/ \
  config.yaml
```

### Automated Backups

**Using cron:**
```bash
0 3 * * * cd /path/to/statcastle && tar -czf backups/backup-$(date +\%Y\%m\%d).tar.gz cricclubs_export_out/ team_dashboard/ config.yaml
```

**Using Kubernetes:**
- Use Velero for cluster backups
- Or sidecar container for PVC backups

---

## Monitoring

### Health Checks

Create `healthcheck.sh`:
```bash
#!/bin/bash
if [ -f "team_dashboard/index.html" ]; then
  exit 0
else
  exit 1
fi
```

### Logging

- Docker: `docker logs <container>`
- Kubernetes: `kubectl logs <pod>`
- Systemd: `journalctl -u statcastle`

### Metrics

Consider adding:
- Execution time tracking
- Match count metrics
- Error rate monitoring
- Dashboard generation time

---

For more details, see:
- [DOCKER.md](DOCKER.md) - Docker-specific guide
- [README.md](README.md) - General usage
- [TESTING.md](TESTING.md) - Testing procedures

