# Docker Deployment Guide

This guide covers running StatCastle using Docker and deploying to Kubernetes.

## Quick Start with Docker

### Prerequisites

- Docker installed ([Get Docker](https://docs.docker.com/get-docker/))
- Docker Compose (usually included with Docker Desktop)

### Step 1: Configure Your Team

```bash
# Copy the sample config
cp config.sample.yaml config.yaml

# Edit config.yaml with your team details
# You'll need: team_id, club_id, league_id from your CricClubs URL
```

### Step 2: Run with Docker Compose

```bash
# Build and run in one command
docker-compose up

# Or run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f
```

This will:
1. Build the Docker image (first time only)
2. Fetch match data from CricClubs
3. Generate the dashboard and PDF report
4. Save outputs to `team_dashboard/` directory

### Step 3: Access Results

After completion, find your results in:
- `team_dashboard/index.html` - Interactive dashboard
- `team_dashboard/Team_Stats_Summary.pdf` - PDF report
- `team_dashboard/summary.txt` - Text summary

## Manual Docker Commands

### Build the Image

```bash
docker build -t statcastle:latest .
```

### Run Export Only

```bash
docker run --rm \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/cricclubs_export_out:/app/cricclubs_export_out \
  statcastle:latest \
  python3 cricclubs_export.py
```

### Run Analysis Only

```bash
docker run --rm \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/cricclubs_export_out:/app/cricclubs_export_out \
  -v $(pwd)/team_dashboard:/app/team_dashboard \
  statcastle:latest \
  python3 analyze.py
```

### Run Both (Full Pipeline)

```bash
docker run --rm \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/cricclubs_export_out:/app/cricclubs_export_out \
  -v $(pwd)/team_dashboard:/app/team_dashboard \
  statcastle:latest \
  sh -c "python3 cricclubs_export.py && python3 analyze.py"
```

### Interactive Shell

```bash
docker run --rm -it \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/cricclubs_export_out:/app/cricclubs_export_out \
  -v $(pwd)/team_dashboard:/app/team_dashboard \
  statcastle:latest \
  /bin/bash
```

## Environment Variables

You can customize behavior with environment variables:

```bash
docker run --rm \
  -e HEADLESS=0 \
  -e MAX_LEAGUE_WORKERS=5 \
  -e MAX_MATCH_WORKERS=8 \
  -e MATCH_DELAY=0.5 \
  -e FORCE_REFRESH=1 \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/cricclubs_export_out:/app/cricclubs_export_out \
  -v $(pwd)/team_dashboard:/app/team_dashboard \
  statcastle:latest \
  python3 cricclubs_export.py
```

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADLESS` | `1` | Run Playwright in headless mode (0 for visible browser) |
| `MAX_LEAGUE_WORKERS` | `3` | Parallel leagues to process |
| `MAX_MATCH_WORKERS` | `4` | Parallel matches per league |
| `MATCH_DELAY` | `0.3` | Delay between match requests (seconds) |
| `FORCE_REFRESH` | `0` | Force re-fetch even if data exists (1 to enable) |

## Kubernetes Deployment

### Option 1: One-Time Job

For a single analysis run, use a Kubernetes Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: statcastle-analysis
spec:
  template:
    spec:
      containers:
      - name: statcastle
        image: statcastle:latest
        command:
          - sh
          - -c
          - |
            python3 cricclubs_export.py &&
            python3 analyze.py
        volumeMounts:
        - name: config
          mountPath: /app/config.yaml
          subPath: config.yaml
          readOnly: true
        - name: export-out
          mountPath: /app/cricclubs_export_out
        - name: dashboard
          mountPath: /app/team_dashboard
        env:
        - name: HEADLESS
          value: "1"
        - name: MAX_LEAGUE_WORKERS
          value: "3"
        - name: MAX_MATCH_WORKERS
          value: "4"
      volumes:
      - name: config
        configMap:
          name: statcastle-config
      - name: export-out
        persistentVolumeClaim:
          claimName: statcastle-export-pvc
      - name: dashboard
        persistentVolumeClaim:
          claimName: statcastle-dashboard-pvc
      restartPolicy: Never
  backoffLimit: 3
```

### Option 2: Scheduled CronJob

For regular updates (e.g., weekly):

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
            command:
              - sh
              - -c
              - |
                python3 cricclubs_export.py &&
                python3 analyze.py
            volumeMounts:
            - name: config
              mountPath: /app/config.yaml
              subPath: config.yaml
              readOnly: true
            - name: export-out
              mountPath: /app/cricclubs_export_out
            - name: dashboard
              mountPath: /app/team_dashboard
            env:
            - name: HEADLESS
              value: "1"
          volumes:
          - name: config
            configMap:
              name: statcastle-config
          - name: export-out
            persistentVolumeClaim:
              claimName: statcastle-export-pvc
          - name: dashboard
            persistentVolumeClaim:
              claimName: statcastle-dashboard-pvc
          restartPolicy: OnFailure
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
```

### Create ConfigMap from config.yaml

```bash
kubectl create configmap statcastle-config \
  --from-file=config.yaml=./config.yaml
```

### Create PersistentVolumeClaims

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

### Deploy to Kubernetes

```bash
# Apply all resources
kubectl apply -f k8s/

# Check job status
kubectl get jobs

# View logs
kubectl logs -l job-name=statcastle-analysis

# For CronJob
kubectl get cronjobs
kubectl get jobs --watch
```

## Accessing Dashboard from Kubernetes

If you need to serve the dashboard from Kubernetes, you can:

1. **Use a simple HTTP server pod:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: statcastle-dashboard-server
spec:
  containers:
  - name: nginx
    image: nginx:alpine
    volumeMounts:
    - name: dashboard
      mountPath: /usr/share/nginx/html
    ports:
    - containerPort: 80
  volumes:
  - name: dashboard
    persistentVolumeClaim:
      claimName: statcastle-dashboard-pvc
```

2. **Or use an Ingress with a web server:**
   - Deploy nginx or another web server
   - Mount the dashboard PVC
   - Configure Ingress to route traffic

## Troubleshooting

### Container fails to start

```bash
# Check container logs
docker logs <container-id>

# Run interactively to debug
docker run --rm -it statcastle:latest /bin/bash
```

### Playwright issues

If you see Playwright errors, ensure the browser is installed:
```bash
docker run --rm statcastle:latest playwright install chromium
```

### Permission issues with volumes

On Linux, you may need to adjust permissions:
```bash
sudo chown -R $USER:$USER cricclubs_export_out team_dashboard
```

### Out of memory

If the container runs out of memory:
- Reduce `MAX_LEAGUE_WORKERS` and `MAX_MATCH_WORKERS`
- Increase Docker memory limit
- For K8s, adjust resource requests/limits

## Building for Different Platforms

### Build for ARM64 (Apple Silicon, Raspberry Pi)

```bash
docker buildx build --platform linux/arm64 -t statcastle:latest .
```

### Build for AMD64

```bash
docker buildx build --platform linux/amd64 -t statcastle:latest .
```

### Multi-platform build

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t statcastle:latest .
```

## Pushing to Container Registry

```bash
# Tag for your registry
docker tag statcastle:latest your-registry/statcastle:latest

# Push
docker push your-registry/statcastle:latest

# In Kubernetes, update image reference
# image: your-registry/statcastle:latest
```

