# Teach Milo

Learn by teaching Milo, a curious AI student. Bring PDF, DOCX, PPTX, TXT, or pasted notes; review extraction; confirm a focused lesson; teach with an interactive board; and optionally take an independent application check before receiving evidence-linked feedback.

This implements the revised, general-subject MVP. There is no preset topic catalog, topic-specific code path, or teaching-turn cap.

## Run locally

Requirements: Node **24.15+**, pnpm **11.21**, JDK **21+**, and a Gemini API key with access to the configured model. Firebase CLI is a project dependency. No cloud Firestore project is needed for local development.

```sh
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Set `GEMINI_API_KEY` in `.env.local`. Keep the key server-side. The default model is `gemini-3.8-flash`; change `GEMINI_MODEL` if your account uses a different model with structured JSON and PDF vision support.

Start Firestore and the application in separate terminals:

```sh
pnpm emulators
```

```sh
pnpm dev
```

Open **http://127.0.0.1:3000**. Use this hostname consistently: sign-in cookies and request-origin checks are scoped to it. Firestore's local UI is **http://127.0.0.1:4000**. `pnpm doctor` checks prerequisites without printing credentials.

The working app always calls real Gemini. Missing keys, exhausted quota, and model failures produce actionable errors; they never switch to simulated answers. The local emulator persists data in `.emulator-data` on clean shutdown. Use `pnpm cleanup` to remove expired records locally.

## Checks

```sh
pnpm typecheck
pnpm test                     # unit/extraction tests; emulator tests skip if no emulator is configured
pnpm test:integration         # starts its own emulator; stop an existing one first
pnpm exec playwright install chromium
pnpm test:e2e                 # browser fixtures, desktop and mobile; starts the app if needed
pnpm test:http                # real local API smoke; requires the app and emulator running
pnpm record:walkthrough       # paced, explicitly labeled scripted recording
pnpm build
```

To test against an already-running emulator:

```sh
GOOGLE_CLOUD_PROJECT=demo-teach-milo FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm test
```

Browser tests use intercepted API responses to exercise the complete UI. Integration tests use real Firestore emulator transactions and a controlled model implementation. Neither requires paid model calls. A real-Gemini smoke test is still required after adding a key: upload mixed/scanned material, inspect OCR, complete a custom lesson, and review cited assessment evidence.

`artifacts/` contains screenshots and an explicitly labeled scripted walkthrough recording produced by the browser tests. It is a demonstration backup, not a recording of live inference.

## Architecture

- `src/app`: Next.js routes and server API handlers.
- `src/components`: material preparation, chat, boards, transfer, and report interfaces.
- `src/lib`: shared Zod contracts, the board component catalog and compiler, and pure controller, grading, and board validation.
- `src/server`: account ownership, Firestore, operations, extraction, lesson preparation, Gemini calls, and session orchestration. Imports are protected by `server-only`.
- `src/content`: private prompts.
- `scripts/extract-worker.mjs`: memory/time-bounded document parsing worker.

Client data entry uses React Hook Form with Zod resolvers: account access, material preparation and source review, chat explanations, independent checks, and board editors. Client schemas in `src/lib/form-schemas.ts` reuse the API contracts; server validation remains authoritative. `schema-form.tsx` provides localized, linked field errors and controlled board fields. Board gestures and shared workspace drafts stay separate from form interaction state, so edits and failed submissions remain recoverable.

The backend owns phases: `preparing → baseline → teaching → ready_for_check → transfer → report`. `preparing` is represented by durable lesson-preparation operations before a session is created. Teaching tracks objective evidence rather than counting turns. An offer to take the check requires supported objectives, mechanism and demonstration evidence, correction of any introduced misconception, and no unresolved source or conceptual error. Learners can continue or end manually. A hint is available once.

Preparation freezes the source snapshot, private knowledge card, objective criteria, misconception, and novel transfer task. Student calls receive no transfer answer. The controller validates allowed moves and exact learner citations. Recent history plus a bounded evidence ledger keeps requests bounded during long conversations. Reports use stored quoted evidence and a separate model call. Unassessable dimensions remain null; a `/10` total appears only when all dimensions are assessable.

### Materials

One upload, 10 MB maximum; PDFs have a 50-page cap; extracted content has a 50,000-character cap. Multipart limits apply while streaming. PDF.js checks each page's text, drawing operations, annotations and reading order. Clean prose pages use native text and confirmed blank pages skip OCR; scans, diagrams, formulas and uncertain layouts go to Gemini in batches of up to five selected pages, retaining original page references. OCR uncertainty is shown in the editable review. Original bytes are held only during processing and are not stored in Firestore or uploaded to the Gemini Files API. Gemini still processes the inline content under the configured API service's terms.

Validated extraction results are cached in `extraction_cache` by user, exact file bytes, model, prompt and extraction version. Repeat PDF uploads (including renamed files) reuse completed extraction, and interrupted uploads resume after successful batches. Concurrent uploads of the same document share a transactional lease and return a busy response while extraction is running. Cache retention starts at first extraction and is never renewed by reuse; expiry checks, TTL and `pnpm cleanup` cover these records. Extracted text and warnings are retained, never original bytes. See [OCR extraction research and behavior](docs/ocr-extraction.md).

DOCX archives undergo streamed ZIP preflight (500 entries / 25 MB decompressed maximum) before plain-text extraction. PPTX uses the same ZIP limits and extracts slide text in presentation order (up to 50 slides), retaining blank slides with warnings. Images, charts, diagrams, native equations, and speaker notes are not extracted; upload a PDF for visual content. TXT requires valid UTF-8. Password-protected PDFs and damaged files produce clear errors. Long OCR runs time out with a request to use fewer pages. Do not use learner-uploaded documents as system instructions.

### Boards

Lesson preparation composes each board, in the same Gemini call, from a catalog of 17 components that Teach Milo owns (`src/lib/board-catalog.ts`): layout (Stack, Row, Card), content (Heading, Text, Callout), inputs (Slider, NumberInput, Toggle, Select), displays (Metric, Bar, Grid, LineChart), and composites (SortableList, Buckets, CompareCards). The board section of the prompt is generated from that registry. A board declares named, typed state (up to 8 variables), derived values, and at most one `calculate(inputs)` function; components bind to state and derived ids, never to inline expressions. Boards without interactive components can instead seed a concept map, matching pairs, or a table. The board is frozen with the lesson.

`compileBoard` validates every node against the catalog. It drops unknown components and invalid props with diagnostics and enforces limits of 40 nodes, 8 state variables, and 4 levels of nesting. A board with a fatal problem gets one repair call that includes the diagnostics, then falls back to an editable example table. Calculations use a deliberately small JavaScript language: arithmetic, approved Math functions, locals, and conditionals. Imports, loops, recursion, strings, constructors, arbitrary property access, and globals are rejected by AST validation.

In the browser, trusted React components render every control and display. Only `calculate` runs, in a worker created by an app-owned bootstrap inside an opaque sandboxed frame; CSP disables network access, and the worker is terminated after 500 ms. Updates are debounced, and a failed update keeps the last good values on screen. When a board is attached, the server re-runs `calculate` in a resource-limited worker thread and stores a verified snapshot. Milo and the evaluator see only labelled `{label, value, unit}` entries. Board values are illustrative, never assessment keys.

### Numeric transfer checks

When the transfer question asks for specific numbers, lesson prep also writes a numeric key: up to 4 fields with expected values and tolerances, the inputs from the question, and a `calculate` function. The server runs that function and keeps the key only if it reproduces every expected value; otherwise the lesson has no numeric check. During the check, the learner enters one value per field. A value outside tolerance caps the transfer score at 1 and is explained in the report; the model evaluates the reasoning separately.

The board tool selector always offers a sketchpad, concept map, matching pairs, and comparison table. The fixed sketch canvas supports pen, eraser, labels, arrows, shapes, selection, movement, and undo/redo. Desktop, expanded, and mobile views share one workspace. Unfinished tools and pending attachments are saved in this browser by account and session; expiry, deletion, sign-out, and leaving teaching clear them. Storage failures preserve in-memory work and display a notice.

Attaching freezes the current state; an explanation is required to send it. Version-2 snapshots accept up to 48 KiB of structured state and a 128 KiB PNG. The newest relevant sketch is sent inline with the existing Gemini teaching call, while base64 is excluded from model JSON and public chat/history. PNG previews use an ownership-checked endpoint and the message's existing retention. Drawings contextualize explanations; readiness and assessment still require exact learner quotes. Interactive boards attach as version-3 snapshots of raw state. Lessons whose stored board predates the catalog show the example table instead; they are not migrated.

### Access, retries, and expiry

Visitors can complete the learning flow without an account. The first material submission automatically creates a private guest identity through `POST /api/auth/guest`; ordinary page visits and `GET /api/auth/me` never create identities. Guest uploads, notes, boards, chat, reports, and history use the same ownership checks as accounts. A seven-day HttpOnly, SameSite=Lax guest cookie (`__Host-teach-milo_guest` over production HTTPS, `teach-milo_guest` locally) maps to a token hash in `guests`. Browser history access ends if the cookie expires or is cleared. Guest access does not renew its expiry. Optional sign-in supports email/password, Google, or a previously enrolled passkey. An opaque HttpOnly, SameSite=Lax `teach-milo_auth` cookie maps to a server-side session token hash. IDs alone grant no access. Mutation endpoints check Origin; Firestore rules deny all direct browser access. Production requires HTTPS and a strong `RATE_LIMIT_SECRET`.

Successful sign-in binds the browser’s guest to that account and moves unexpired materials, lessons, sessions, and owner-scoped retry records in resumable batches of 50. `GET /api/auth/me` returns `user`, `guest`, and optional `claim` state; `POST /api/auth/guest/claim` advances a pending transfer and requires account authentication plus Origin validation. The UI automatically resumes interrupted transfers. Transactional guest fences stop older writes and cleanup from restoring guest ownership, and current-day guest usage is added to the account exactly once. IDs, child messages, pending answers, reports, and original expiry dates remain unchanged. Local board drafts move to the account namespace. Signing in enables access across devices without extending learning-data retention. Extraction caches expire under their original guest owner. Google callbacks require a ten-minute browser-bound, single-use state stored with TTL in `user_sessions`.

Passkeys are added, renamed, and removed under **Account settings → Passkeys** after signing in within the last 10 minutes. Create the account with email/password or Google first; those methods remain available for recovery. Passkey login supports an explicit button and conditional browser autofill, native WebAuthn JSON serialization with compatibility polyfills, and optional Signal API synchronization with password managers. Device PIN/biometric verification and discoverable credentials are required; security keys and cross-device authenticators are allowed. SimpleWebAuthn verifies signatures, origin, RP ID, challenge, and authenticator counters. Five-minute, browser-bound challenges are consumed transactionally before verification, and challenge generation is rate-limited. Public keys and metadata persist in `passkeys`; no biometric data or private keys reach the server. `passkey_challenges` have TTL and cleanup coverage.

The RP ID is the hostname of the configured `APP_ORIGIN`; keep that hostname stable in production. **For local passkey testing**, set `APP_ORIGIN=http://localhost:3000`, start Next with `pnpm exec next dev --webpack --hostname localhost`, and open that exact URL. The normal `127.0.0.1` development origin cannot serve as a WebAuthn RP ID. Update the Google OAuth authorized redirect URI to match if also testing Google sign-in. Deploy the challenge TTL with `pnpm exec firebase deploy --only firestore:indexes`; no Firestore rules change is needed.

Durable operation IDs, payload fingerprints, revisions, and transactional leases prevent duplicate stored turns and overlapping calls. Pending teaching/transfer input is stored with the operation before generation/evaluation. Failed calls leave the phase unchanged. Retries reuse the operation ID; expired leases can be recovered. An external provider request whose result is lost during a server crash can still incur a second charge on retry—Firestore cannot make the external API exactly-once.

Daily per-identity, network, and global call budgets are transactional and configurable; guests and accounts both default to 100 model calls per day, with 300 per network and 1,000 globally. They pause requests rather than end lessons. The default network bucket is shared, which is conservative. Only enable `TRUST_PROXY=true` behind a proxy whose forwarded-address behavior you control; otherwise leave the shared bucket enabled. Telemetry stores event names and session IDs, not source or conversation text.

Seven-day expiry is checked on every access. Session history filters ownership and expiry in Firestore and orders active sessions newest first. `GET /api/sessions` returns up to 20 summaries and an optional `nextCursor`; pass it as `?cursor=...` to load the next page. Each request reads at most 21 session documents (one lookahead) and 20 distinct lesson documents, with summary-only projections. The modal appends pages with “Load more” and resets when reopened. Cursors use ordered field values, so deleting a boundary session does not break continuation. History is live: updates can move sessions between pages; reopen to refresh the newest entries. The document limit does not bound index entries scanned for expiry filtering.

TTL policies cover parent records and message/operation subcollections because deleting a Firestore parent does not delete descendants. Account authentication sessions in `user_sessions` have their own 30-day expiry, TTL policy, and cleanup coverage; user accounts remain persistent. The cleanup script also recursively deletes expired parents and should run daily in production. Resetting or creating another lesson does not immediately delete prior materials; use session deletion for conversation removal and expiry for retained extracted sources.

Large source, lesson, evidence, report, board, and pending-operation payloads are exempt from indexing because the app does not query those fields. Ownership, email, message-sequence, and cleanup expiry indexes remain available.

### Content Security Policy

`next.config.ts` sends an enforced starter `Content-Security-Policy` on all routes. Resources default to the app's own origin; plugins, base tags, external form submissions, and embedding the app are blocked. HTTPS images remain allowed for Google avatars and Markdown content. Fonts and browser API requests stay same-origin; Gemini, Firestore, and Google OAuth token requests run on the server and need no browser allowlist.

Inline scripts remain allowed for Next.js hydration, and inline styles for React and KaTeX. This is a compatibility baseline, not a strict XSS policy. Development additionally permits `unsafe-eval` and WebSocket scheme sources for Next.js debugging and hot reload; these exceptions are omitted in production. The board calculator's `srcdoc` frame inherits the page policy, so blob workers are allowed; its existing inner policy still denies network access.

For stricter script protection, first adapt the calculator and Next.js rendering to per-request nonces or script hashes, then validate a candidate policy in report-only mode before enforcing it. Trusted Types also requires checking React/KaTeX HTML sinks first. CSP changes take effect after restarting development or rebuilding production. Browser regression coverage lives in `tests/browser/csp.spec.ts`, alongside the board and formula fixtures.

## Cloud Run preparation

The Dockerfile builds Next's standalone server and includes the extraction worker's production dependencies. This environment uses Webpack because Turbopack's CSS subprocess requires local port permissions unavailable in the task sandbox.

```sh
docker build --platform linux/amd64 -t teach-milo .
```

Before deployment, create a Firestore database, an Artifact Registry image repository, and a dedicated runtime service account. Give the runtime `roles/datastore.user` and Secret Manager accessor on: `teach-milo-gemini-key` (Gemini API key), `teach-milo-rate-limit-secret` (random 32+ character rate-limit secret), and—for Google Sign-In—`teach-milo-google-client-id` and `teach-milo-google-client-secret` from a Google Cloud OAuth **Web application** client. In that client, set the authorized redirect URI to `{_APP_ORIGIN}/api/auth/google/callback` (must match `APP_ORIGIN` exactly). Deploy with Cloud Build (`gcloud builds submit` or a trigger using `cloudbuild.yaml`). Set the `_APP_ORIGIN` substitution to the service HTTPS URL. Do not set `FIRESTORE_EMULATOR_HOST` in production.

Deploy `firestore.rules` and `firestore.indexes.json`, including TTL fields. Before releasing the session-history query, confirm the target database edition and deploy indexes with `pnpm exec firebase deploy --only firestore:indexes --project YOUR_PROJECT_ID`; wait until the `sessions` composite indexes are ready, including the pagination index on `ownerId ASC`, `updatedAt DESC`, `expiresAt ASC`, and `__name__ ASC`. Emulator tests do not verify production index readiness. TTL deletion is asynchronous, so application expiry checks and scheduled cleanup remain necessary. Schedule a Cloud Run Job using the same image and `node scripts/cleanup.mjs` daily, with Firestore access. Public IAM access should be enabled only for the app service when you are ready to launch. No cloud deployment is performed by this repository's local commands.

## Current boundaries

English interface; no voice, web search, standalone images, slides, or recordings as inputs. Custom material checks use model knowledge and source evidence, not independently verified external facts. Ambiguous material can yield unscored criteria. A generated simulation can be mathematically bounded without being a scientifically valid model; source assumptions and learner interpretation remain essential.

### Languages

The website supports English, Simplified Chinese, and Japanese. The navigation selector remembers the website language in this browser for one year; without a saved choice, browser language preferences select the initial language. URLs stay unchanged.

Choose what language Milo should use before preparing a lesson. It initially follows the website language and is preserved across sign-in. Lesson text, Milo’s messages, the independent check, and feedback stay in that language even when the website language changes. Existing lessons default to English; original material and learner quotes are never translated. Prepare a new lesson to change its teaching language.

Translations live in `src/lib/i18n`; add matching keys and interpolation parameters to all four translated dictionaries (English uses the keys). User-facing API errors can include `messageKey` and `params` while retaining their English `message` and existing error code.

### Guest mode release checks

Run `pnpm typecheck`, `pnpm test`, and `pnpm test:integration`. With the Firestore emulator and app running at `http://127.0.0.1:3000`, run `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm exec playwright test tests/browser/guests.spec.ts` for desktop/mobile guest cookies, notes/uploads, reload, browser isolation, history/deletion, blocked cookies, and account transfer. Only lesson generation is scripted in these browser tests; the guest, account, material, and session APIs are real. Firestore integration tests cover interrupted multi-batch transfer, pending input, usage merging, OAuth state, and in-flight write fencing.

Deploy with the existing Cloud Build / Cloud Run pipeline. Guest TTL, owner-field single indexes, and session history composites already exist; this feature needs no Firestore rules or index changes. Before judging, use a fresh private browser on the production origin to start a lesson, refresh, inspect history, and sign in to transfer it. The production network bucket is shared unless trusted proxy handling is explicitly configured.
