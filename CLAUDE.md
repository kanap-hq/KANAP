@AGENTS.md

## Claude Code

- Shared skills are reachable through the symlinks in `.claude/skills/`; edit them under `.agents/skills/`.
- Private notes for the maintainer's own setup live in `CLAUDE.local.md` (gitignored), when present.
- Right after opening a pull request, turn on **Auto-fix** for it in the app's PR bar
  (`mcp__ccd_pr__set_monitor`, `auto_fix: true`): a failed queue check or a conflict then wakes
  the session, which fixes it and queues the PR again. Successful merges stay silent.
