# Local ARM64 GitLab Runner Setup

## Background

The project's CI pipeline builds `linux/arm64` Docker images for deployment to AWS
Graviton instances. The current shared runner (`ed.h.usky.io`) is x86_64 and uses
QEMU emulation via `tonistiigi/binfmt` to cross-compile. This adds significant
overhead — the `build` job typically takes 6+ minutes, most of which is spent in
emulated compilation of native modules (DuckDB bindings, etc.).

Running a GitLab runner on an Apple Silicon Mac eliminates emulation entirely, since
macOS on M-series chips is natively ARM64. Expected build times drop to ~1-2 minutes.

## Current CI Architecture

| Job | Runner | Platform | Typical Duration |
|---|---|---|---|
| `test` | shared (ed.h.usky.io) | x86_64 native | ~45s |
| `code_quality` | shared (ed.h.usky.io) | x86_64 native | ~3.5 min |
| `build` | shared (ed.h.usky.io) | arm64 via QEMU | **~6 min** |
| `container_scanning` | shared (ed.h.usky.io) | arm64 scan | ~1 min |
| `deploy` | shared (ed.h.usky.io) | x86_64 (pull/push) | ~2 min |

The `build` job is the bottleneck. It runs these emulation setup commands before
every build:

```bash
docker run --rm --privileged tonistiigi/binfmt --install arm64
docker buildx create --use --name cibuilder --driver docker-container
```

With a native ARM runner, both lines become unnecessary.

## Prerequisites

- **Apple Silicon Mac** (M1/M2/M3/M4) — this is the whole point
- **Docker Desktop for Mac** — required for the `docker` executor
  - Must be running whenever the runner should accept jobs
  - Enable "Use Virtualization Framework" in Docker Desktop settings (default on modern versions)
- **Homebrew** — for installing `gitlab-runner`
- **Network access** to `git.h.usky.io` (the GitLab instance) and `registry.git.h.usky.io` (the container registry)

## Installation

### 1. Install the GitLab Runner Binary

```bash
brew install gitlab-runner
```

Verify:

```bash
gitlab-runner --version
```

### 2. Obtain a Runner Registration Token

1. Navigate to https://git.h.usky.io/benton/daily-orbit/-/settings/ci_cd
2. Expand the **Runners** section
3. Under **Project runners**, click **New project runner**
4. Set the following options:
   - **Tags**: `arm64`
   - **Description**: `macOS ARM64 Docker runner`
   - **Run untagged jobs**: No (leave unchecked — we only want tagged jobs routed here)
5. Click **Create runner** and copy the registration token

### 3. Register the Runner

```bash
gitlab-runner register \
  --url https://git.h.usky.io \
  --token <TOKEN_FROM_STEP_2> \
  --executor docker \
  --docker-image docker:27 \
  --description "macOS ARM64 Docker runner" \
  --tag-list arm64
```

When prompted for additional options, accept the defaults.

### 4. Configure Privileged Mode

The `build` job uses Docker-in-Docker (`docker:27-dind` service), which requires
privileged mode. Edit the runner config:

```bash
nano ~/.gitlab-runner/config.toml
```

Find the `[runners.docker]` section for the new runner and ensure these settings:

```toml
[runners.docker]
  tls_verify = false
  image = "docker:27"
  privileged = true
  disable_entrypoint_overwrite = false
  oom_kill_disable = false
  disable_cache = false
  volumes = ["/cache", "/certs/client"]
```

Key settings:
- **`privileged = true`** — required for Docker-in-Docker
- **`volumes`** — the `/certs/client` volume is needed for DinD TLS communication

### 5. Start the Runner as a Service

```bash
brew services start gitlab-runner
```

Verify it's running:

```bash
brew services info gitlab-runner
gitlab-runner status
```

The runner should now appear as online at:
https://git.h.usky.io/benton/daily-orbit/-/settings/ci_cd (under Runners)

## CI Configuration Changes

### Tag the Build Job

Add `tags: [arm64]` to the `build` job and remove the QEMU emulation setup:

```yaml
build:
  stage: build
  needs: []
  tags: [arm64]                          # <-- route to ARM runner
  image: docker:27
  services:
    - docker:27-dind
  variables:
    DOCKER_TLS_CERTDIR: ""
  before_script:
    # No more binfmt/QEMU lines needed
    - docker buildx create --use --name cibuilder --driver docker-container
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - |
      TAGS="--tag $GL_IMAGE:$CI_COMMIT_SHORT_SHA"
      if [ -n "$CI_COMMIT_TAG" ]; then
        SANITIZED_TAG=$(echo "$CI_COMMIT_TAG" | sed 's/[^a-zA-Z0-9._-]/-/g')
        TAGS="$TAGS --tag $GL_IMAGE:$SANITIZED_TAG --tag $GL_IMAGE:latest"
      fi
    - |
      docker buildx build \
        --platform linux/arm64 \
        --build-arg VITE_SERVER_URL="$VITE_SERVER_URL" \
        --cache-from type=registry,ref=$GL_IMAGE:buildcache \
        --cache-to type=registry,ref=$GL_IMAGE:buildcache,mode=max \
        $TAGS \
        --push \
        .
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG
```

### Jobs to Leave on the Shared Runner

| Job | Why |
|---|---|
| `test` | Already fast (~45s), no architecture dependency |
| `code_quality` | GitLab template job, x86 is fine |
| `container_scanning` | Runs after build, just scans the pushed image |
| `deploy` | Must be available 24/7 for production deploys; needs AWS credentials that shouldn't live on a laptop |

## Operational Notes

### When the Mac is Off or Asleep

If the ARM runner is unavailable, jobs tagged `arm64` will sit in the queue
indefinitely. Two strategies to handle this:

1. **Fallback with `arm64` tag on the shared runner too** — re-add the binfmt lines
   conditionally. This is complex and defeats the purpose.

2. **Preferred: just keep the Mac awake during development hours.** The build job
   only triggers on pushes to `main` and tags, so it's not constant. Use
   `caffeinate` or set Energy Saver preferences to prevent sleep while on power.

### Stopping the Runner

```bash
brew services stop gitlab-runner
```

Or to unregister entirely:

```bash
gitlab-runner unregister --all-runners
brew services stop gitlab-runner
```

### Viewing Logs

```bash
# Live logs
gitlab-runner run

# Or via brew services log
brew services log gitlab-runner
```

### Updating the Runner

```bash
brew upgrade gitlab-runner
brew services restart gitlab-runner
```

## Security Considerations

- The runner operates in **privileged mode**, which means CI jobs have root-level
  access to the Docker daemon. This is acceptable for a single-user, project-scoped
  runner but would be a risk on a shared runner.
- **Do not enable "Run untagged jobs"** — otherwise all project jobs (including
  from MRs by other contributors, if any) would execute on your workstation.
- CI variables containing secrets (AWS credentials, registry passwords) are injected
  by GitLab and are masked in logs, but they are accessible inside the job
  container. Keep the Mac physically secure.
- Consider using GitLab's **protected runner** setting so the runner only picks up
  jobs from protected branches/tags (main, release tags).

## Verification

After setup, push a commit to `main` or create a tag. Confirm:

1. The `build` job is picked up by the new ARM runner (check the job log header for
   the runner description)
2. There are no `binfmt` or QEMU references in the job log
3. Build time is under 2 minutes
4. The pushed image runs correctly on the Graviton deployment target
