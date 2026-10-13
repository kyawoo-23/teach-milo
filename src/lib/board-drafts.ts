export const BOARD_DRAFT_PREFIX = "teachback-board:";
export function clearBoardDrafts(ownerId?: string, sessionId?: string) {
  try {
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith(BOARD_DRAFT_PREFIX) &&
        (!ownerId || key.startsWith(`${BOARD_DRAFT_PREFIX}${ownerId}:`)) &&
        (!sessionId || key.endsWith(`:${sessionId}`))
      )
        localStorage.removeItem(key);
    }
  } catch {
    /* Storage can be disabled; in-memory work remains usable. */
  }
  window.dispatchEvent(
    new CustomEvent("teachback-board-cleared", {
      detail: { ownerId, sessionId },
    }),
  );
}
