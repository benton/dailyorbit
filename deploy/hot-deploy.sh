#!/usr/bin/env bash
set -euo pipefail

# Hot-deploy: build, push, restart the API container, sync frontend to S3,
# and invalidate CloudFront — all in one step.
# Usage: ./deploy/hot-deploy.sh

AWS_ACCOUNT=665226324657
AWS_REGION=us-east-2
ECR_REPO=daily-orbit
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
SSH_HOST=api.dailyorbit.org
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
FRONTEND_BUCKET=daily-orbit-prod-frontend
CLOUDFRONT_DIST_ID=E2YVC4MEMBIV20

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

echo "==> Extracting frontend from Docker image"
CONTAINER_ID=$(docker create "${ECR_REPO}:${TAG}")
rm -rf /tmp/hotdeploy-web-dist
docker cp "${CONTAINER_ID}:/app/packages/web/dist" /tmp/hotdeploy-web-dist
docker rm "${CONTAINER_ID}" > /dev/null

echo "==> Tagging for ECR"
docker tag "${ECR_REPO}:${TAG}" "${ECR_URI}:${TAG}"

echo "==> Logging into ECR"
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_URI}"

echo "==> Pushing ${ECR_URI}:${TAG}"
docker push "${ECR_URI}:${TAG}"

echo "==> Deploying API to ${SSH_HOST}"
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

echo "--- API deploy complete: \${ECR_URI}:\${TAG}"
REMOTE

echo "==> Syncing frontend to S3 (${FRONTEND_BUCKET})"
aws s3 sync /tmp/hotdeploy-web-dist/ "s3://${FRONTEND_BUCKET}/" --delete
rm -rf /tmp/hotdeploy-web-dist

echo "==> Invalidating CloudFront (${CLOUDFRONT_DIST_ID})"
aws cloudfront create-invalidation \
  --distribution-id "${CLOUDFRONT_DIST_ID}" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text

echo "==> Done! Deployed ${TAG} to ${SSH_HOST} + S3/CloudFront"
