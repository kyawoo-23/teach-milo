# Data fetching and Firestore query audit

Implemented on 2026-10-12 against the installed Next.js 16.4.0 documentation and Firestore Standard edition. Production database edition was checked read-only; production data and configuration were not changed.

## Measured query changes

These counts describe application document reads in the tested paths, excluding authentication reads, transaction retries, and Firestore index-entry charges. Projections reduce transferred data; they do not reduce the charge for a document read.

| Path                                          | Result                                                                                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session history                               | Still returns 20 sessions with one lookahead document. New sessions store a safe lesson summary, eliminating up to 20 additional lesson reads per page. Legacy sessions retain the batched, projected lesson lookup. |
| Unchanged pending-session poll                | One projected session read for ownership, expiry, revision and operation status. No lesson read or message query. Previously each poll fetched the session, lesson and latest message window.                        |
| Changed pending-session poll                  | A metadata read followed by a fresh full session response. The extra metadata read is the deliberate tradeoff for cheaper unchanged polls.                                                                           |
| Successful turn, action or independent check  | Reuses the transaction's committed session and the already-loaded lesson when constructing the response, eliminating two redundant document reads. Cached operation retries still load the lesson when necessary.    |
| Message pagination                            | Uses a sequence cursor and 31-document lookahead to display 30 messages. A terminal page no longer triggers an unnecessary empty-page request.                                                                       |
| Message, telemetry and deletion authorization | Reads only the required session fields while always checking ownership and expiry.                                                                                                                                   |
| Retention cleanup                             | Reads document references without downloading document bodies. Still processes bounded batches of 100.                                                                                                               |

The unit query tests and isolated Firestore emulator tests assert these read paths, summary compatibility, pagination boundaries, ownership checks, operation idempotency and assessment restrictions. They measure query behavior rather than claiming a specific latency improvement.

## Browser request lifecycle

- Identical in-flight GETs share one request, including React Strict Mode's immediate effect teardown/setup. Each consumer has independent cancellation; the network request is aborted when no consumer remains.
- Resolved authenticated responses are not kept in a global cache. Starting or finishing a mutation clears the in-flight sharing pool so subsequent reads cannot reuse an earlier authentication epoch.
- Read requests time out after 30 seconds and can be retried. Uploads, model requests and other writes retain their existing timeouts and operation IDs; writes are never automatically retried or deduplicated by this client layer.
- Session loading waits for authentication. Pending-session polls are serialized, use revision metadata, pause while the page is hidden or a local write is running, and back off on failure. Polling resumes immediately when a pending session becomes visible.
- Navigation, dialog closure, account changes and newer reads cancel obsolete requests. Generation guards prevent old responses from replacing the current login, session, history, report evidence or onboarding state.
- Loaded conversation pages remain in chronological order across live updates, without duplicate messages. Opening a different session resets its UI state.
- Stable conversation-message components are memoized so typing does not rerender every saved message.

## Server and caching boundaries

Authenticated API responses retain `Cache-Control: no-store`; client fetches also use `cache: "no-store"`. No cross-user Next.js Data Cache or global response cache was introduced. Authentication, ownership and retention checks remain on every protected request.

The existing Firestore Admin client is shared across route bundles. Independent lesson/message reads and telemetry writes run concurrently after authorization. Model context remains bounded to the existing recent-message limits, with cited older evidence fetched in a batch. Material extraction and lesson generation keep their existing durable, idempotent operation records and usage-limit transactions.

Read-time readiness promotion now rechecks the current session in a transaction and respects active operation leases. A concurrent assessment transition cannot be overwritten by an older read or expose its teaching aids.

The daily global model quota remains a transactionally enforced limit. Sharding it would change its exact-limit semantics and is outside this optimization. Authentication's bounded session/user reads also remain authoritative rather than being cached across requests.

## Indexes and rollout

Added single-field index exemptions for `sessions.lessonSummary`, `sessions.activeOperation`, and message `createdAt`, `role`, and `kind`; these fields are never queried. Existing sequence ordering, history composite indexes, authentication indexes and TTL configuration remain intact. `expiresAt` stays indexed because history and cleanup query it.

Deploy the application through the existing Cloud Build / Cloud Run workflow. Apply the index configuration separately:

```sh
pnpm exec firebase deploy --only firestore:indexes --project teach-milo
```

This work did not run that deployment. No new composite query index is needed. Existing sessions continue working without a migration; only newly created sessions receive the embedded lesson summary, so legacy history savings are limited to the existing batched lookup. Confirm index operation completion in Firebase before treating the exemptions as live.

## Validation

- `pnpm typecheck`
- `pnpm test`: 72 passed; emulator-only tests are skipped without an emulator.
- Isolated Firestore emulator suite: 17 passed, using a separate demo project and port.
- Desktop/mobile browser coverage: request sharing, serialized polling, visibility pause/resume, authentication races, completed-chat pagination/retry, session history and the normal learning flow.
- Production build checked in an isolated copy to avoid disturbing the running development server.

## References

- [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices?hl=en): minimize index fanout, use cursors and run independent work asynchronously.
- [Firestore query cursors](https://firebase.google.com/docs/firestore/query-data/query-cursors): bounded cursor pagination.
- [Firestore pricing](https://firebase.google.com/docs/firestore/pricing): document and index-entry read accounting.
- [Next.js data fetching](https://nextjs.org/docs/app/getting-started/fetching-data): request scheduling and caching boundaries; implementation also checked against `node_modules/next/dist/docs/` for this repository's version.
