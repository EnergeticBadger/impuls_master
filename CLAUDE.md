# Impulse Caster: repo conventions

A free Magic: The Gathering card search (a better Scryfall front end) at impulsecaster.cards, growing into
deck building. React Router 7 + Valtio, served by a Cloudflare Worker. Phases: `docs/PLAN.md`.

## Commands
- `npm run verify`: typecheck + affiliate and unit tests + backlog validation + build (must pass)
- `npm run test-unit`: node's test runner on `app/**/*.test.ts`
- `npm run dev`: dev server. Other `test-*` / `fuzz-*` scripts call Scryfall: never run them unattended.

## Layout
- `app/routes/`: pages (home search, card, sets, syntax). `app/Components/`: UI by area (Searchbar, Card, ...).
- `app/lib/`: data helpers. `carddata.ts` rebuilds Scryfall-shaped cards from our compact card data;
  `affiliate.ts` rewrites buy links (never Scryfall's affiliate ids).
- `workers/`: the Worker: `/api/scryfall/*` proxy with caching and rate spacing, `/data/*` from R2.
- `scripts/`: card data build, local search engine and its Scryfall comparison tests.
- `backlog/tasks/`: one task per file (format in `backlog/README.md`).

## Rules
- TypeScript strict; no `any`. No new npm dependencies without a human decision.
- Free, no paywalls, no upsells (a line in the sand). Disclosed affiliate buy links are fine.
- Scryfall allows 2 searches a second; every call goes through `/api/scryfall/`. Never call Scryfall directly
  from new code, and never in tests.
- Unit-tested logic lives in pure modules with a `x.test.ts` next to them. Node runs them directly, so those
  modules may only import other modules by relative path with the `.ts` extension, or `import type`.
- Phone first: everything works at 360px wide with no horizontal scroll. `app.css` resets inputs with
  `all: unset`, so set `box-sizing: border-box` on any new input.
- Agents can't open a browser: say in the PR what a human should click through.
- Keep diffs focused on the task. Commit messages: `<task-id>: <what changed>`.
