#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

IMAGE_NAME="${IMAGE_NAME:-expense-tracker}"
IMAGE_TAG="${IMAGE_TAG:-${GITHUB_SHA:-latest}}"
CONTAINER_NAME="${CONTAINER_NAME:-expense-tracker}"
ENV_FILE="${DEPLOY_ENV_FILE:-/etc/expense-tracker/.env.production}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-Dockerfile}"
BIND_ADDRESS="${BIND_ADDRESS:-127.0.0.1}"
HOST_PORT="${HOST_PORT:-3000}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
STOP_TIMEOUT_SECONDS="${STOP_TIMEOUT_SECONDS:-30}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-30}"
HEALTHCHECK_INTERVAL_SECONDS="${HEALTHCHECK_INTERVAL_SECONDS:-2}"
LOG_MAX_SIZE="${LOG_MAX_SIZE:-10m}"
LOG_MAX_FILES="${LOG_MAX_FILES:-3}"
PREVIOUS_CONTAINER="${CONTAINER_NAME}-previous"

previous_container_renamed=false
deployment_started=false
deployment_succeeded=false
previous_image_id=""

die() {
  echo "Deployment failed: $*" >&2
  exit 1
}

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

require_positive_integer() {
  local name="$1"
  local value="$2"

  [[ "$value" =~ ^[1-9][0-9]*$ ]] || die "$name must be a positive integer"
}

rollback() {
  local exit_code=$?

  if (( exit_code == 0 )) || [[ "$deployment_succeeded" == true ]]; then
    return
  fi

  echo "Deployment failed; restoring the previous container if available." >&2

  if [[ "$deployment_started" == true ]] && container_exists "$CONTAINER_NAME"; then
    docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi

  if [[ "$previous_container_renamed" == true ]] && container_exists "$PREVIOUS_CONTAINER"; then
    if [[ -n "$previous_image_id" ]]; then
      docker tag "$previous_image_id" "${IMAGE_NAME}:latest" >/dev/null 2>&1 || true
    fi

    if docker rename "$PREVIOUS_CONTAINER" "$CONTAINER_NAME" >/dev/null 2>&1; then
      docker start "$CONTAINER_NAME" >/dev/null 2>&1 || true
      echo "Previous container restored." >&2
    else
      echo "Warning: the previous container could not be restored automatically." >&2
    fi
  fi

  exit "$exit_code"
}

wait_for_app() {
  local attempt
  local running

  for (( attempt = 1; attempt <= HEALTHCHECK_ATTEMPTS; attempt++ )); do
    running="$(docker container inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)"

    if [[ "$running" == true ]] && docker exec "$CONTAINER_NAME" node -e \
      "fetch('http://127.0.0.1:${CONTAINER_PORT}/').then((response) => process.exit(response.status < 500 ? 0 : 1)).catch(() => process.exit(1))" \
      >/dev/null 2>&1; then
      echo "Container is healthy."
      return 0
    fi

    sleep "$HEALTHCHECK_INTERVAL_SECONDS"
  done

  echo "Container did not become healthy in time. Recent logs:" >&2
  docker logs --tail 100 "$CONTAINER_NAME" >&2 || true
  return 1
}

command -v docker >/dev/null 2>&1 || die "Docker is not installed or is not on PATH"
[[ -f "$DOCKERFILE_PATH" ]] || die "Dockerfile not found: $DOCKERFILE_PATH"
[[ -f "$ENV_FILE" ]] || die "Environment file not found: $ENV_FILE"
docker info >/dev/null 2>&1 || die "Docker daemon is unavailable"

require_positive_integer HOST_PORT "$HOST_PORT"
require_positive_integer CONTAINER_PORT "$CONTAINER_PORT"
require_positive_integer STOP_TIMEOUT_SECONDS "$STOP_TIMEOUT_SECONDS"
require_positive_integer HEALTHCHECK_ATTEMPTS "$HEALTHCHECK_ATTEMPTS"
require_positive_integer HEALTHCHECK_INTERVAL_SECONDS "$HEALTHCHECK_INTERVAL_SECONDS"

[[ "$IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "IMAGE_TAG contains unsupported characters"

echo "Building ${IMAGE_NAME}:${IMAGE_TAG} from ${DOCKERFILE_PATH}."
docker build \
  --pull \
  --file "$DOCKERFILE_PATH" \
  --tag "${IMAGE_NAME}:${IMAGE_TAG}" \
  --tag "${IMAGE_NAME}:latest" \
  "$PROJECT_DIR"

if container_exists "$PREVIOUS_CONTAINER"; then
  echo "Removing stale rollback container ${PREVIOUS_CONTAINER}."
  docker rm --force "$PREVIOUS_CONTAINER" >/dev/null
fi

trap rollback EXIT

if container_exists "$CONTAINER_NAME"; then
  echo "Preparing the current container for replacement."
  previous_image_id="$(docker container inspect --format '{{.Image}}' "$CONTAINER_NAME")"
  docker rename "$CONTAINER_NAME" "$PREVIOUS_CONTAINER"
  previous_container_renamed=true

  if [[ "$(docker container inspect --format '{{.State.Running}}' "$PREVIOUS_CONTAINER")" == true ]]; then
    docker stop --time "$STOP_TIMEOUT_SECONDS" "$PREVIOUS_CONTAINER" >/dev/null
  fi
fi

echo "Starting ${CONTAINER_NAME}."
deployment_started=true
docker run \
  --detach \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  --publish "${BIND_ADDRESS}:${HOST_PORT}:${CONTAINER_PORT}" \
  --log-opt "max-size=${LOG_MAX_SIZE}" \
  --log-opt "max-file=${LOG_MAX_FILES}" \
  "${IMAGE_NAME}:${IMAGE_TAG}"

wait_for_app

if [[ "$previous_container_renamed" == true ]]; then
  docker rm "$PREVIOUS_CONTAINER" >/dev/null
fi

deployment_succeeded=true
echo "Deployment complete: ${IMAGE_NAME}:${IMAGE_TAG}."
