# Changelog

## v1.4 — Mobile Filter Experience Enhancement (2024-11-15)
- **Mobile Filter Redesign**: Replaced space-consuming filter section with compact floating icon button
  - Floating filter icon button (bottom-right corner) for easy access on mobile
  - Bottom sheet modal that slides up smoothly with all filter controls
  - Badge indicator showing active filter count on icon
  - Active filter chips remain visible outside modal for quick reference
- **Cross-Platform Sync**: Full synchronization between mobile and desktop filter inputs
- **Enhanced Mobile UX**: 
  - Significantly reduced vertical space usage on mobile screens
  - Smooth animations and transitions for modal open/close
  - Touch-friendly filter controls optimized for mobile interaction
- **Desktop Experience**: Original filter section remains unchanged for desktop users
- **Accessibility**: Added proper ARIA labels, keyboard navigation, and focus management

## v1.3 — Docker Support & Production Readiness (2025-11-12)
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

## v1.1 — Team-Based Discovery (2025-10-31)
- Team-based `teamResults.do` discovery
- Initial team-based match discovery implementation

## v1.0 — Initial Release (2025-10-25)
- Initial release with league-based discovery (deprecated)
- Basic dashboard functionality
- Match data export and analysis
