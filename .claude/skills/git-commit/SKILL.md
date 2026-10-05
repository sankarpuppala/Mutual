---
name: git-commit
description: Commit the currently staged changes in the Mutual repository with a message that names the PLAN.md phase and the SPEC.md section(s) implemented. Refuses to commit secrets, databases, media, .venv or node_modules. Never pushes, amends or force-commits.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git check-ignore:*), Bash(git commit:*)
---

# git-commit

Use git commands only. Never run `git push`, `git commit --amend`, `--force`,
`--no-verify`, `git reset`, `git rebase`, or anything that rewrites history.
Never stage or unstage files yourself: commit exactly what the human staged.

## 1. Gather context

Run:

- `git status`
- `git branch --show-current`
- `git diff --staged --stat`
- `git diff --staged`

If nothing is staged, say so and stop.

## 2. Refuse unsafe commits

Stop without committing, and list the offending paths, if any staged path:

- is inside `.venv/` or `node_modules/`;
- is a database (`*.db`, `*.sqlite`, `*.sqlite3`);
- is a secret or local config (`.env*`, `server/config.yaml`, `*.keystore`, `*.jks`);
- is uploaded media (`server/media/`);
- is personal notes (`prompt.md`, `notes/`);
- is matched by `.gitignore` — check with
  `git check-ignore --no-index -v <path> ...` on the staged paths.

Tell the human the exact `git restore --staged <path>` command to run, but do
not run it.

## 3. Write the message

- **Phase**: from the branch name `phase-<n>-<name>`. If the branch does not
  follow that pattern, ask the human which phase this is.
- **SPEC sections**, from the staged paths:

  | Path | SPEC.md |
  |---|---|
  | `packages/protocol-spec/`, `packages/protocol_py/`, `packages/protocol-ts/` | §6 |
  | `server/` | §11, §12 (plus §6.9 for matching, §8 for safety, §9 for retention) |
  | `sim/` | §15 |
  | `app/src/design/`, `app/app/`, `app/src/components/`, `docs/design/` | §13 |
  | `app/modules/mutual-ble/`, `app/src/presence/` | §14 |
  | `docs/THREAT_MODEL.md`, `docs/SECURITY_ARGUMENT.md` | §7 |
  | `study/` | §16 |
  | `CLAUDE.md`, `SPEC.md`, `PLAN.md`, root config files | name the file itself |

Format:

```
Phase <n> (<name>): <one-line summary, imperative, under 72 chars>

Implements SPEC.md §<x>[, §<y>].
- <one bullet per meaningful change>
```

If the staged diff touches `server/tests/test_leak_two_worlds.py` or
`server/tests/test_route_audit.py`, add the line
`Touches privacy test(s): <file(s)> — reviewed with extra care.` (CLAUDE.md §7).

End the message with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## 4. Commit

Show the message to the human, then commit with `git commit -F -` (message on
stdin) or one `-m` per paragraph. Report the resulting short hash from
`git log -1 --oneline`. If a pre-commit hook fails, report its output and stop.
Do not bypass it.
