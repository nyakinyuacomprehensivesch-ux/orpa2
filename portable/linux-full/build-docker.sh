#!/usr/bin/env bash
# =============================================================
# Orpa — Build Portable Docker Image (no install on host)
# =============================================================
# Produces a self-contained Docker image (~120 MB) that runs
# the entire Orpa stack. Works on any x86_64 Linux with
# Docker installed. Data persists in a Docker volume.
#
# Prerequisites (on the BUILD/RUN machine):
#   - Docker (https://docs.docker.com/engine/install/)
#
# Usage:
#   chmod +x build-docker.sh
#   ./build-docker.sh          # builds the image
#   ./run-docker.sh            # starts the container
#
# =============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"  # the Orpa-Server repo
IMAGE_NAME="orpa-server"
IMAGE_TAG="latest"

echo ""
echo "========================================"
echo " Orpa Docker Builder"
echo "========================================"
echo ""

# Build the Docker image from the repo root
docker build \
  -t "$IMAGE_NAME:$IMAGE_TAG" \
  -f "$SCRIPT_DIR/Dockerfile" \
  "$SOURCE_DIR"

echo ""
echo "✅ Image built: $IMAGE_NAME:$IMAGE_TAG"
echo "   Run with:  ./run-docker.sh"
echo ""
