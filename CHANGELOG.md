# Changelog

## v1.3 — Docker Support & Production Readiness (2025-01-XX)
- **Docker Support**: Multi-stage Dockerfile for easy deployment
  - No local setup required - run in minutes with `docker-compose up`
  - Includes Playwright browser installation
  - Optimized for production use
- **Docker Compose**: Added `docker-compose.yml` for local development
- **Kubernetes Support**: Full K8s deployment examples (Jobs, CronJobs)
- **Comprehensive Documentation**:
  - Complete README rewrite with Docker-first approach
  - New DOCKER.md with Docker and Kubernetes guides
  - New DEPLOYMENT.md with deployment instructions for various platforms
  - Updated GitHub Actions workflow with Playwright installation
- **Enhanced Features Documentation**:
  - Documented all dashboard features (filters, player stats, team stats)
  - Added troubleshooting guides
  - Environment variables documentation
- **Repository Cleanup**: Updated .gitignore and .dockerignore
- **GitHub Pages**: Improved auto-deployment workflow

## v1.2 — Team-Based Discovery & Enhanced Analytics (2025-11-03)
- Switched to team-based match discovery using `teamResults.do` (no admin access required)
- Removed league-based fallback for simpler, faster scraping
- Multi-tournament support in a single run
- Player dropdown insights (runs, SR, dot%, wickets, economy, impact games)
- Improved dashboard/PDF outputs and folder structure
- Updated README with Quick Start; updated config.sample.yaml
