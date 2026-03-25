#!/usr/bin/env bash
set -euo pipefail

# Hot-deploy: build, push, and restart the production container in-place.
# Usage: ./scripts/hot-deploy.sh

AWS_ACCOUNT=665226324657
AWS_REGION=us-east-2
ECR_REPO=daily-orbit
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
SSH_HOST=api.dailyorbit.org
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

# Derive tag: <version>-hotdeploy-<timestamp>
VERSION=$(node -p "require('./packages/server/package.json').version")
TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
TAG="${VERSION}-hotdeploy-${TIMESTAMP}"

VITE_SERVER_URL="https://api.dailyorbit.org"
VITE_NEWSPAPER_IMAGES_URL="/newspaper"

echo "==> Building Docker image: ${ECR_REPO}:${TAG}"
docker build \
  --build-arg VITE_SERVER_URL="${VITE_SERVER_URL}" \
  --build-arg VITE_NEWSPAPER_IMAGES_URL="${VITE_NEWSPAPER_IMAGES_URL}" \
  -t "${ECR_REPO}:${TAG}" .

echo "==> Tagging for ECR"
docker tag "${ECR_REPO}:${TAG}" "${ECR_URI}:${TAG}"

echo "==> Logging into ECR"
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_URI}"

echo "==> Pushing ${ECR_URI}:${TAG}"
docker push "${ECR_URI}:${TAG}"

echo "==> Deploying to ${SSH_HOST}"
# shellcheck disable=SC2087
ssh ${SSH_OPTS} "ubuntu@${SSH_HOST}" bash -s <<REMOTE
set -euo pipefail

ECR_URI="${ECR_URI}"
TAG="${TAG}"

echo "--- ECR login"
aws ecr get-login-password --region ${AWS_REGION} \
  | sudo docker login --username AWS --password-stdin "\${ECR_URI}"

echo "--- Pulling \${ECR_URI}:\${TAG}"
sudo docker pull "\${ECR_URI}:\${TAG}"

echo "--- Updating systemd unit to use new image tag"
sudo sed -i "s|${ECR_URI}:[^ ]*|${ECR_URI}:${TAG}|" /etc/systemd/system/daily-orbit.service

echo "--- Reloading systemd and restarting service"
sudo systemctl daemon-reload
sudo systemctl restart daily-orbit

echo "--- Waiting for service to start..."
sleep 5
if systemctl is-active --quiet daily-orbit; then
  echo "--- daily-orbit is running"
else
  echo "!!! daily-orbit failed to start, showing logs:"
  sudo journalctl -u daily-orbit --no-pager -n 30
  exit 1
fi

echo "--- Hot deploy complete: \${ECR_URI}:\${TAG}"
REMOTE

echo "==> Done! Deployed ${TAG} to ${SSH_HOST}"
