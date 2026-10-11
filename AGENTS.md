<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Learned User Preferences

- Prefer minimal, targeted fixes when debugging API/UI failures; run `pnpm typecheck` and relevant tests after substantive changes.
- Local Gemini latency matters: `gemini-3-flash-preview` is an acceptable faster alternative to the repo default when iterating on lesson/chat flows.

## Learned Workspace Facts

- TeachBack AI is a guest-only Next.js MVP: Firestore persistence, Gemini for OCR/lessons/chat, session phases through report; intended production is Cloud Run + Firestore + Secret Manager (`deploy/cloudrun.yaml`, README).
- Workspace path includes a trailing space (`TeachBack AI `); quote paths in shell commands.
- Local dev expects JDK 21+, Firestore emulator (`pnpm emulators` on 127.0.0.1:8080), and `pnpm dev` in a second terminal; `node scripts/doctor.mjs` checks setup.
- Match browser origin to `APP_ORIGIN` in `.env.local` (typically `http://127.0.0.1:3000`, not `localhost`); Google OAuth redirect URI is `{APP_ORIGIN}/api/auth/google/callback` with the same origin authorized on the Web client.
- `GOOGLE_CLOUD_PROJECT` is the Firebase/Firestore project id (e.g. `demo-teachback` with the emulator); it is separate from `GEMINI_API_KEY`. The app does not read `.firebaserc` (Firebase CLI only); `pnpm emulators` still passes `--project demo-teachback`.
- Phase `ready_for_check` (“Milo understood” UI) comes from deterministic `readyForCheck()` on the cumulative ledger after each turn—not Milo’s chat tone; `inferLedgerGaps` can backfill empty demonstration; lesson prep `concerns` no longer gate readiness (they still affect report scoring).
- Lesson prep uses Gemini structured JSON (`LessonGeneratedSchema`); `ControlSchema` must not emit JSON Schema `minimum`/`maximum` on control `min`/`max` fields—Gemini rejects that in large schemas (runtime board bounds live in `validateBoardConfiguration`).
- Gemini client timeouts in `src/server/model.ts` are aligned with route `maxDuration` (120s text, 240s PDF).
- Student turns run `normalizeStudentReply` before `validateStudent` so minor model formatting issues do not fail the whole turn.
- Session chat UI optimistically shows the learner message via `outgoing` in `session-experience.tsx`; scroll effect deps use `messageCount`, `outgoingId`, and `busy`.
- Docker production stage: set `ENV CI=true` then `pnpm prune --prod` only (pnpm 11 rejects `--store-dir` / `--offline` on `prune`).
