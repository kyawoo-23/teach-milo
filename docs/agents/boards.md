# Boards and lesson prep

Boards are composed from the 17-component catalog in `src/lib/board-catalog.ts`. The prompt’s board section is `catalogPrompt()`.

Lesson prep asks Gemini for structured JSON matching `LessonGeneratedSchema`.

`BoardStateSchema` omits JSON Schema `minimum` and `maximum` on `min` and `max`. Gemini rejects those keywords in a large schema. Runtime bounds live in `compileBoard` in `src/lib/board-catalog.ts`.

The model-facing `BoardGeneratedSchema` omits `version`, so the schema has no JSON Schema `const`. The server stamps `version: 2`.

The server re-runs `calculate` (`src/server/calculation.ts`) for board snapshots.

Lesson prep runs `prepareTransferReference` (`src/server/transfer-reference.ts`). `verifyNumericTransfer` executes the model’s `transfer.numeric` program and stores those metrics as the field’s authoritative `expected` value. Mark the field `corrected` when Gemini’s numbers disagree. Drop the key when the program is invalid. Reference prose uses `{{fieldId}}` placeholders filled from those values.

Report evaluation passes the server `matches` result for each numeric field, so the model does not recompute the arithmetic. The independent-check card badge uses `statusOf(report.scores.transfer)`, the same status as the “Applying it on your own” skill row.
