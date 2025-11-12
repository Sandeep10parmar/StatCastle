#!/bin/bash
# Simple script to serve the dashboard
# Usage: ./serve.sh

cd "$(dirname "$0")"
echo "Starting server on http://localhost:8000"
echo "Open http://localhost:8000 in your browser"
echo "Press Ctrl+C to stop"
python3 -m http.server 8000

