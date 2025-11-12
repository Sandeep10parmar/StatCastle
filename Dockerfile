# Multi-stage Dockerfile for StatCastle
# Stage 1: Base image with system dependencies and Playwright
FROM python:3.11-slim as base

# Install system dependencies required for Playwright and other tools
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright and Chromium browser
RUN pip install --no-cache-dir playwright==1.40.0 && \
    playwright install chromium && \
    playwright install-deps chromium

# Stage 2: Install Python dependencies
FROM base as builder

WORKDIR /build

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies to user directory
RUN pip install --user --no-cache-dir -r requirements.txt

# Stage 3: Runtime image
FROM base as runtime

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local

# Set working directory
WORKDIR /app

# Copy application code
COPY cricclubs_export.py .
COPY analyze.py .
COPY summary_report.py .
COPY config.sample.yaml .

# Make scripts executable
RUN chmod +x cricclubs_export.py analyze.py summary_report.py

# Add user-local bin to PATH
ENV PATH=/root/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Create directories for outputs
RUN mkdir -p /app/cricclubs_export_out /app/team_dashboard/assets

# Default command (can be overridden)
CMD ["python3", "--version"]

