#!/usr/bin/env bash
# =============================================================
# Orpa — Run Portable Docker Container
# =============================================================
# Starts Orpa on http://localhost:8000 with persistent
# data volume. Configure via .env or environment variables.
#
# Usage:
#   chmod +x run-docker.sh
#   ./run-docker.sh
#
# Stop:
#   docker stop orpa
#   docker rm orpa
#
# =============================================================

set -euo pipefail

CONTAINER_NAME="orpa"
IMAGE_NAME="orpa-server:latest"
HOST_PORT="${ORPA_PORT:-8000}"
DATA_VOLUME="orpa-data"

echo ""
echo "========================================"
echo " Starting Orpa Server (Docker)"
echo "========================================"
echo ""

# Create data volume if it doesn't exist
docker volume create "$DATA_VOLUME" 2>/dev/null || true

# Load .env file if present
ENV_FILE=""
if [ -f .env ]; then
  ENV_FILE="--env-file .env"
  echo "[run] Loading .env configuration..."
fi

# Remove old container if it exists
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "[run] Starting container on port $HOST_PORT..."
echo "[run] Open http://localhost:$HOST_PORT in your browser"
echo "[run] Data volume: $DATA_VOLUME"
echo "[run] Press Ctrl+C to stop"
echo ""

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${HOST_PORT}:8000" \
  -v "${DATA_VOLUME}:/app/data" \
  -e DATA_DIR=/app/data \
  $ENV_FILE \
  "$IMAGE_NAME"

# Show logs
docker logs -f "$CONTAINER_NAME"
