---
description: Fix the CI jobs for this project
---

Load the GitLab MCP server and start the following debug sequence:

1. Figure out why the latest Pipeline jobs are failing.
2. See if the failures can be reproduced locally with the same tests.
3. Fix any problems, and commit the fixes without mentioning Claude or Anthropic.
4. Cancel the failed pipeline if it's still running.
5. Push the fixes upstream and watch the resulting Pipeline. If it succeeds, bump the package version (fix revision!) and push a tagged commit. Otherwise, repeat this sequence.
