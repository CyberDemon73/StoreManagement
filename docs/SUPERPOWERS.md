# Superpowers in this repo

[Superpowers](https://github.com/obra/superpowers) is a community Claude Code plugin by Jesse Vincent (obra) that adds a disciplined engineering workflow as skills: brainstorm first, write a plan, execute it in reviewed batches, test-driven development, systematic debugging and verification before claiming completion. Avenue Stock uses it for every sprint.

## Install (once per machine)
In Claude Code:
```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```
Then **start a new session** (skills load at session start) and confirm with `/plugin list`.

If the marketplace name or install command has changed, check the README at https://github.com/obra/superpowers — do not guess.

## What it gives us
| Superpowers skill / command | When it fires here |
|---|---|
| `/superpowers:brainstorm` (brainstorming) | Start of every sprint and every feature not fully specified in `docs/` |
| `/superpowers:write-plan` (writing-plans) | After brainstorm; plan saved to `docs/plans/sprint-N.md` |
| `/superpowers:execute-plan` (executing-plans) | Runs the plan in batches with review checkpoints |
| test-driven-development | Every service function and route handler (red → green → refactor) |
| systematic-debugging | Any failing test, flaky behaviour or bug report |
| verification-before-completion | Before ticking any checkbox: show the passing command output |
| requesting-code-review | End of each sprint, before `/security-review` |

## How it combines with our own skills
- `/sprint N` (ours) reads the sprint checklist, then runs the Superpowers chain: brainstorm → write-plan → execute-plan → verification → `/security-review`.
- `/api-endpoint`, `/db-migration`, `/analytics-query` (ours) describe the *shape* of the code; inside them, write the test first as TDD requires.
- Plans live in `docs/plans/` and are committed, so the next session can resume from the plan rather than from memory.

## Session hygiene
- One sprint per session where possible. Start each session with: "Read CLAUDE.md, then `/sprint N`."
- If Claude skips brainstorm/plan and starts coding, say: "Stop. Use the brainstorming skill first."
- Keep plans short and concrete: files to touch, test to write first, command that proves it.
