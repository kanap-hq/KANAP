@AGENTS.md

## Claude Code

- Shared skills are reachable through the symlinks in `.claude/skills/`; edit them under `.agents/skills/`.
- Private notes for the maintainer's own setup live in `CLAUDE.local.md` (gitignored), when present.
- After opening a pull request, do not turn on Auto-fix and do not follow the PR: the queue keeper
  owns it (`AGENTS.md`, "Workflow with the maintainer"). The session's work is done.
- Do not coordinate with other sessions through `SendMessage`, and do not start sessions for
  parts of your own lot. Work outside the lot goes to the tracker.
- End a turn with a question only for the move to PR or a product decision. Anything else on the
  way, do it and say so in one line.
