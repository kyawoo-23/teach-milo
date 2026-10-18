# Retention and locale

Default retention is 7 days (`SESSION_RETENTION_DAYS`, `expiresAt()` in `src/server/db.ts`). Sessions, including their messages and operations, plus extracted materials and lessons, receive `expiresAt` when they are created. Materials receive it at upload. Persist extracted text, and drop the original PDF and DOCX bytes after extraction. Reaching the report does not extend expiry.

After expiry the API returns 410, history omits the session, and `/session/…` reads as missing. Firestore TTL on `expiresAt` is declared in `firestore.indexes.json`. `pnpm cleanup` (`scripts/cleanup.mjs`) deletes expired documents. TTL deletion itself is asynchronous.

Auth cookies in `user_sessions` last 30 days. Keep that lifetime independent of the 7-day session retention. A learner can delete a session at any time with `DELETE /api/sessions/:id`.

`GET /api/sessions` returns 20 sessions per page (`PAGE_SIZE`) using a cursor. The history modal’s Load more control requests the next page. A guest-owned session stays under the guest owner until sign-in claim sets `ownerId`.

Query counts for history and polls are in [data-fetching.md](../data-fetching.md). Extraction-cache expiry is in [ocr-extraction.md](../ocr-extraction.md).

## Locale

The UI locale cookie `teach-milo-locale` is `en`, `zh-CN`, `ja`, `ko`, or `th` (`src/lib/i18n/locales.ts` and the matching JSON dictionaries).

Teaching-language options also include `vi`, `id`, `ms`, and `my`. Copy for those teaching-only locales lives in `src/lib/i18n/teaching-phrases.ts`.
