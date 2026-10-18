# Teaching turns

Phase `ready_for_check` (the “Milo understood” UI) is `readyForCheck()` on the cumulative ledger after each turn. Chat tone does not set the phase. `inferLedgerGaps` can backfill an empty demonstration. Lesson prep `concerns` affect report scoring.

The teaching-turn system prompt is `STUDENT_PROMPT` in `src/content/prompts.ts`, with the prep prompt, the evaluate prompt, and `languageInstruction()`. `src/server/sessions.ts` appends `languageInstruction(lesson.teachingLanguage)` on each turn.

The same structured reply may store a learner-safe `thought` (emotion and reason) on Milo’s message. The evidence ledger stays private. `visibleThought()` in `src/lib/message-thought.ts` drops a generic or reply-duplicative reason. `conversation-message.tsx` shows the remaining reason in a collapsed disclosure excluded from copy.

The session chat shows the learner’s message immediately through `outgoing` in `session-experience.tsx`. The scroll effect depends on `messageCount`, `outgoingId`, and `busy`.

Gemini client timeouts in `src/server/model.ts` match route `maxDuration`: 120 seconds for text and 240 seconds for PDF. Student turns run `normalizeStudentReply` before `validateStudent`, so a minor formatting miss does not fail the turn.
