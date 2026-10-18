export const BOARD_DRAFT_PREFIX = "teach-milo-board:";
export function moveBoardDrafts(fromOwnerId: string, toOwnerId: string) {
  if (fromOwnerId === toOwnerId) return;
  window.dispatchEvent(
    new CustomEvent("teach-milo-board-migrating", {
      detail: { fromOwnerId, toOwnerId },
    }),
  );
  try {
    const prefix = `${BOARD_DRAFT_PREFIX}${fromOwnerId}:`;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      const target = `${BOARD_DRAFT_PREFIX}${toOwnerId}:${key.slice(prefix.length)}`;
      if (localStorage.getItem(target) === null)
        localStorage.setItem(target, value);
      localStorage.removeItem(key);
    }
  } catch {
    // Storage can be disabled; server-side sessions still transfer.
  }
}
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
    new CustomEvent("teach-milo-board-cleared", {
      detail: { ownerId, sessionId },
    }),
  );
}
