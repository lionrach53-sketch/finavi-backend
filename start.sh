#!/usr/bin/env bash
set -euo pipefail

# Start helper for VM deployment.
# Usage: ./start.sh [docker|node]

MODE=${1:-docker}

if [ "$MODE" = "docker" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not installed. Install docker or run: ./start.sh node" >&2
    exit 2
  fi

  IMAGE_NAME="finavii-api"
  echo "Building Docker image $IMAGE_NAME..."
  docker build -t "$IMAGE_NAME" .

  # Stop existing container if present
  if docker ps -a --format '{{.Names}}' | grep -q "^finavii-api$"; then
    echo "Stopping existing container..."
    docker rm -f finavii-api || true
  fi

  echo "Starting container on port 3000 (host -> container)..."
  docker run -d --name finavii-api -p 3000:3000 --env-file .env --restart unless-stopped finavii-api
  echo "Container started. Use 'docker logs -f finavii-api' to follow logs."
  exit 0
fi

if [ "$MODE" = "node" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not installed. Install Node.js or run: ./start.sh docker" >&2
    exit 2
  fi

  echo "Installing dependencies (production)..."
  npm ci --only=production || npm install --production

  echo "Starting Node server..."
  # Run in foreground; recommend using systemd/pm2 for production.
  node serve.js
  exit 0
fi

echo "Unknown mode: $MODE. Use 'docker' or 'node'" >&2
exit 3
