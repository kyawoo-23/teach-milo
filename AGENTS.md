<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Learned User Preferences

- Prefer minimal, targeted fixes when debugging API/UI failures; run `pnpm typecheck` and relevant tests after substantive changes.
- Local Gemini latency matters: `gemini-3-flash-preview` is an acceptable faster alternative to the repo default when iterating on lesson/chat flows; `gemini-3.5-flash-lite` is fine for cost/speed if structured JSON and PDF OCR stay reliable.

## Learned Workspace Facts

- TeachBack AI is a Next.js MVP: Firestore persistence, Gemini for OCR/lessons/chat, session phases through report; auth is email/password with optional Google OAuth (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env.local` locally).
- Production app deploy is Cloud Build / Cloud Run only (`cloudbuild.yaml`: image, env, Secret Manager `teachback-gemini-key`, `teachback-rate-limit-secret`, `teachback-google-client-id`, `teachback-google-client-secret`, `_APP_ORIGIN`, `_GEMINI_MODEL`); `firebase.json` has no Hosting—use `pnpm exec firebase deploy --only firestore:indexes` (and `firestore:rules` if changed) for Firestore config; wait for new composite indexes before paginated session history in prod. Docker production stage: set `ENV CI=true` then `pnpm prune --prod` only (pnpm 11 rejects `--store-dir` / `--offline` on `prune`).
- Workspace path includes a trailing space (`TeachBack AI `); quote paths in shell commands.
- Local dev expects JDK 21+, Firestore emulator (`pnpm emulators` on 127.0.0.1:8080), and `pnpm dev` in a second terminal; `node scripts/doctor.mjs` checks setup.
- Match browser origin to `APP_ORIGIN` in `.env.local` (typically `http://127.0.0.1:3000`, not `localhost`); Google OAuth redirect URI is `{APP_ORIGIN}/api/auth/google/callback` with the same origin authorized on the Web client.
- `GOOGLE_CLOUD_PROJECT` is the Firebase/Firestore project id (e.g. `demo-teachback` with the emulator); it is separate from `GEMINI_API_KEY`. The app does not read `.firebaserc` (Firebase CLI only); `pnpm emulators` still passes `--project demo-teachback`.
- Phase `ready_for_check` (“Milo understood” UI) comes from deterministic `readyForCheck()` on the cumulative ledger after each turn—not Milo’s chat tone; `inferLedgerGaps` can backfill empty demonstration; lesson prep `concerns` no longer gate readiness (they still affect report scoring).
- Lesson prep uses Gemini structured JSON (`LessonGeneratedSchema`); board `BoardStateSchema` must not emit JSON Schema `minimum`/`maximum` on `min`/`max`—Gemini rejects that in large schemas (runtime board bounds live in `compileBoard`, `src/lib/board-catalog.ts`). The model-facing `BoardGeneratedSchema` omits `version` (no JSON Schema `const`); the server stamps `version: 2`.
- Boards are composed from the 17-component catalog in `src/lib/board-catalog.ts` (no topic-specific code); the prompt's board section comes from `catalogPrompt()`. The server re-runs `calculate` (`src/server/calculation.ts`) for board snapshots and for the model-written `transfer.numeric` key, which is dropped unless it reproduces its expected values.
- Gemini client timeouts in `src/server/model.ts` align with route `maxDuration` (120s text, 240s PDF); student turns run `normalizeStudentReply` before `validateStudent` so minor model formatting issues do not fail the whole turn.
- Milo teaching-turn system prompt is `STUDENT_PROMPT` in `src/content/prompts.ts` (prep/evaluate prompts and `languageInstruction()` live there too); `src/server/sessions.ts` appends `languageInstruction(lesson.teachingLanguage)` on each turn.
- Session chat UI optimistically shows the learner message via `outgoing` in `session-experience.tsx`; scroll effect deps use `messageCount`, `outgoingId`, and `busy`.
- Retention is 7 days by default (`SESSION_RETENTION_DAYS`, `expiresAt()` in `src/server/db.ts`): sessions (and messages/operations), extracted `materials`, and `lessons` all get `expiresAt` on create (materials at upload); original PDF/DOCX bytes are not stored. Finishing to report does not extend expiry. After expiry the API returns 410, history omits the session, and `/session/…` reads as missing. Firestore TTL on `expiresAt` in `firestore.indexes.json` plus `pnpm cleanup` / `scripts/cleanup.mjs` remove documents (TTL is async). Auth cookies in `user_sessions` last 30 days; users can delete a session anytime via `DELETE /api/sessions/:id`.
