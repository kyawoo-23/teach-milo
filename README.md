# TeachBack AI

Learn by teaching Milo, a curious AI student. Bring PDF, DOCX, TXT, or pasted notes; review extraction; confirm a focused lesson; teach with an interactive board; and optionally take an independent application check before receiving evidence-linked feedback.

This implements the revised, general-subject MVP. There is no preset topic catalog or teaching-turn cap. The CNN lesson is a vetted internal specialization and regression case.

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
GOOGLE_CLOUD_PROJECT=demo-teachback FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm test
```

Browser tests use intercepted API responses to exercise the complete UI. Integration tests use real Firestore emulator transactions and a controlled model implementation. Neither requires paid model calls. A real-Gemini smoke test is still required after adding a key: upload mixed/scanned material, inspect OCR, complete a custom lesson, and review cited assessment evidence.

`artifacts/` contains screenshots and an explicitly labeled scripted walkthrough recording produced by the browser tests. It is a demonstration backup, not a recording of live inference.

## Architecture

- `src/app`: Next.js routes and server API handlers.
- `src/components`: material preparation, chat, boards, transfer, and report interfaces.
- `src/lib`: shared Zod contracts and pure controller, arithmetic, grading, and board validation.
- `src/server`: account ownership, Firestore, operations, extraction, lesson preparation, Gemini calls, and session orchestration. Imports are protected by `server-only`.
- `src/content`: private prompts and the vetted CNN reference.
- `scripts/extract-worker.mjs`: memory/time-bounded document parsing worker.

The backend owns phases: `preparing → baseline → teaching → ready_for_check → transfer → report`. `preparing` is represented by durable lesson-preparation operations before a session is created. Teaching tracks objective evidence rather than counting turns. An offer to take the check requires supported objectives, mechanism and demonstration evidence, correction of any introduced misconception, and no unresolved source or conceptual error. Learners can continue or end manually. A hint is available once.

Preparation freezes the source snapshot, private knowledge card, objective criteria, misconception, and novel transfer task. Student calls receive no transfer answer. The controller validates allowed moves and exact learner citations. Recent history plus a bounded evidence ledger keeps requests bounded during long conversations. Reports use stored quoted evidence and a separate model call. Unassessable dimensions remain null; a `/10` total appears only when all dimensions are assessable.

### Materials

One upload, 10 MB maximum; PDFs have a 50-page cap; extracted content has a 50,000-character cap. Multipart limits apply while streaming. PDF.js checks the document and extracts native text; Gemini reads every PDF in batches of up to five pages so scanned content and diagrams are covered. OCR uncertainty is shown in the editable review. Original bytes are held only during processing and are not stored in Firestore or uploaded to the Gemini Files API. Gemini still processes the inline content under the configured API service's terms.

DOCX archives undergo streamed ZIP preflight (500 entries / 25 MB decompressed maximum) before plain-text extraction. TXT requires valid UTF-8. Password-protected PDFs and damaged files produce clear errors. Long OCR runs time out with a request to use fewer pages. Do not use learner-uploaded documents as system instructions.

### Boards

Trusted templates cover causal sliders, sequencing, classification, and comparison. Generated calculations use a deliberately small JavaScript language: arithmetic, approved Math functions, locals, and conditionals. Imports, loops, recursion, constructors, arbitrary property access, and globals are rejected by AST validation. A generated board gets one configuration repair attempt before textual fallback.

Generated code executes only in a worker created by an app-owned bootstrap in an opaque sandboxed frame. CSP disables network access; code receives board inputs only. The worker is terminated after 500 ms, messages are validated, and a failed runtime calculation gets one retry before text fallback. Trusted React components render all controls and output. Generated outputs remain illustrative; they are not arithmetic assessment keys.

The CNN specialization uses deterministic server-recomputed snapshots (224 parameters for both image sizes; 194,400 / 830,304 multiplications). Its transfer check verifies submitted parameter counts against 204; the model evaluates semantic reasoning separately.

### Access, retries, and expiry

Learners must sign in (email/password or Google) before material is processed. An opaque HttpOnly, SameSite=Lax `teachback_auth` cookie maps to a server-side session token hash. IDs alone grant no access. Mutation endpoints check Origin; Firestore rules deny all direct browser access. Production requires HTTPS and a strong `RATE_LIMIT_SECRET`.

Durable operation IDs, payload fingerprints, revisions, and transactional leases prevent duplicate stored turns and overlapping calls. Pending teaching/transfer input is stored with the operation before generation/evaluation. Failed calls leave the phase unchanged. Retries reuse the operation ID; expired leases can be recovered. An external provider request whose result is lost during a server crash can still incur a second charge on retry—Firestore cannot make the external API exactly-once.

Daily per-user, network, and global call budgets are transactional and configurable. They pause requests rather than end lessons. The default network bucket is shared, which is conservative. Only enable `TRUST_PROXY=true` behind a proxy whose forwarded-address behavior you control; otherwise leave the shared bucket enabled. Telemetry stores event names and session IDs, not source or conversation text.

Seven-day expiry is checked on every access. TTL policies cover parent records and message/operation subcollections because deleting a Firestore parent does not delete descendants. The cleanup script also recursively deletes expired parents and should run daily in production. Resetting or creating another lesson does not immediately delete prior materials; use session deletion for conversation removal and expiry for retained extracted sources.

## Cloud Run preparation

The Dockerfile builds Next's standalone server and includes the extraction worker's production dependencies. This environment uses Webpack because Turbopack's CSS subprocess requires local port permissions unavailable in the task sandbox.

```sh
docker build --platform linux/amd64 -t teachback-ai .
```

Before deployment, create a Firestore database, an Artifact Registry image repository, and a dedicated runtime service account. Give the runtime `roles/datastore.user` and Secret Manager accessor on two secrets: `teachback-gemini-key` (the Gemini API key) and `teachback-rate-limit-secret` (a random 32+ character rate-limit secret). Deploy with Cloud Build (`gcloud builds submit` or a trigger using `cloudbuild.yaml`). Set the `_APP_ORIGIN` substitution to the service HTTPS URL. Do not set `FIRESTORE_EMULATOR_HOST` in production.

Deploy `firestore.rules` and `firestore.indexes.json`, including TTL fields. Schedule a Cloud Run Job using the same image and `node scripts/cleanup.mjs` daily, with Firestore access. Public IAM access should be enabled only for the app service when you are ready to launch. No cloud deployment is performed by this repository's local commands.

## Current boundaries

English interface; no voice, web search, standalone images, slides, or recordings as inputs. Custom material checks use model knowledge and source evidence, not independently verified external facts. Ambiguous material can yield unscored criteria. A generated simulation can be mathematically bounded without being a scientifically valid model; source assumptions and learner interpretation remain essential.
