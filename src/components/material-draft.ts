// Keeps the learner's unsent material across a sign-in redirect (e.g. Google OAuth).
// Text fields live in sessionStorage; the chosen file is kept in IndexedDB.
export type MaterialDraft = {
  mode: "upload" | "paste";
  notes: string;
  topic: string;
  level: string;
};

const KEY = "teachback:material-draft";
const DB = "teachback-drafts";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function fileStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveDraft(draft: MaterialDraft, file: File | null) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
    if (file) await fileStore("readwrite", (s) => s.put(file, KEY));
    else await fileStore("readwrite", (s) => s.delete(KEY));
  } catch {
    /* Storage may be disabled; the learner can re-enter the material. */
  }
}

export async function takeDraft(): Promise<{
  draft: MaterialDraft;
  file: File | null;
} | null> {
  let draft: MaterialDraft | null = null;
  try {
    draft = JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch {
    /* Ignore unreadable drafts. */
  }
  if (!draft) return null;
  let file: File | null = null;
  try {
    const stored = await fileStore<File | undefined>("readonly", (s) =>
      s.get(KEY),
    );
    if (stored instanceof File) file = stored;
  } catch {
    /* The file could not be restored; the learner can choose it again. */
  }
  await clearDraft();
  return { draft, file };
}

export async function clearDraft() {
  try {
    sessionStorage.removeItem(KEY);
    await fileStore("readwrite", (s) => s.delete(KEY));
  } catch {
    /* Nothing to clear. */
  }
}
