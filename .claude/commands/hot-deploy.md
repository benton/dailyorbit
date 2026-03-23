Run the hot-deploy script to build, push, and deploy the Docker image to production.

Execute `./deploy/hot-deploy.sh` and stream the output. This script will:

1. Build the Docker image locally (ARM) with a versioned hotdeploy tag
2. Push it to ECR
3. SSH to api.dailyorbit.org and pull the new image, update the systemd unit, and restart the service

Run the script and report the results. If any step fails, diagnose the issue and suggest a fix.
