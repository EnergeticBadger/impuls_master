# Backlog

One task per file in `tasks/`, named `<id>.md`. Agents (the harness from the-system repo) pick up tasks from
`staging`, so a task becomes workable once its file is merged there. Task *progress* (ready / review / done /
blocked) is tracked by the runner outside git, in `~/.agents/impulse/`. Agent PRs target `staging` and wait
for a human to merge them (`merge = false` in `agents.toml`).

## Format

Frontmatter must be flat `key: value` lines (lists as `[a, b]`), because the runner parses it
without a YAML library. `npm run validate` checks every file.

```markdown
---
id: p1-example            # must match the file name
title: Short imperative title
phase: P1                 # P0..P9, see docs/PLAN.md
priority: 3               # 1 = first, 9 = last (default 5)
depends_on: [p1-other]    # task ids that must be merged first
model: sonnet             # haiku | sonnet | opus (default sonnet)
timeout_min: 40           # watchdog wall-clock limit (default 40)
max_turns: 60             # watchdog turn limit (default 60)
hold: false               # true = agents skip it (needs a human)
---
## Goal
What and why, in a few sentences.

## Acceptance criteria
- Concrete, checkable statements.

## Verify
npm run verify
```

## Writing good tasks
- Small: one focused PR, under about an hour of agent work. Split anything bigger.
- Name the files to touch and the behaviour to test. Vague tasks are what make agents loop.
- Give each task exactly one way to check it's done (the Verify block).
- Agents can't open a browser or reach Scryfall. Put what a human should click through in the acceptance
  criteria, and make anything that needs live checks or Cloudflare settings `hold: true`.
- Logic goes in pure modules with `*.test.ts` next to them (run by `npm run test-unit`), so agents can test it.
