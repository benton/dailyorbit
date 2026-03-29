# Git usage Rules

- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0)
- **NEVER** Refer to Claude or Anthropic in commit messages
- Use git worktrees when dev servers (Vite, API) are running and you need live browser testing, or when multiple agents need to coordinate on shared files. Othersies, work directly on a feature branch in the project dir.
