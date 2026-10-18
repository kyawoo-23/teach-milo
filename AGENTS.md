<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Teach Milo is a Next.js app where a learner teaches Milo from their notes and then receives a report. Use pnpm.

After a substantive change, run `pnpm typecheck` and the tests that cover it. `pnpm test` skips the Firestore emulator suites; `pnpm test:integration` runs them.

Open the linked doc before editing that area.

## Learned User Preferences

- UI for lists, modals, toolbars, composers, and control size: [docs/agents/ui.md](docs/agents/ui.md).
- Lessons and boards stay catalog- and prep-driven. Extend the catalog or prep output instead of adding a per-subject module, filename, or board kind. Mechanism: [docs/agents/boards.md](docs/agents/boards.md).
- Local Gemini substitutes while iterating on lesson or chat latency: [docs/agents/local-setup.md](docs/agents/local-setup.md).

## Learned Workspace Facts

- Emulator, `APP_ORIGIN`, and Google OAuth: [docs/agents/local-setup.md](docs/agents/local-setup.md).
- Cloud Run, Firestore index deploy, and the production image prune: [docs/agents/deploy.md](docs/agents/deploy.md).
- Phase readiness, prompts, Gemini timeouts, and chat scroll: [docs/agents/teaching.md](docs/agents/teaching.md).
- Board catalog, schemas, transfer checks, and report arithmetic: [docs/agents/boards.md](docs/agents/boards.md).
- Expiry, session history, and UI locale versus teaching language: [docs/agents/retention-locale.md](docs/agents/retention-locale.md).
