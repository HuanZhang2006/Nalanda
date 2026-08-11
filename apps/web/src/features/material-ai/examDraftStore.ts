import type { ExamAnswerInput } from "@nalanda/types";

const DATABASE = "nalanda-material-ai";
const STORE = "exam-drafts";

export interface ExamDraft {
  key: string;
  userId: string;
  attemptId: string;
  revision: number;
  answers: ExamAnswerInput[];
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const draftKey = (userId: string, attemptId: string) => `${userId}:${attemptId}`;

export async function saveDraft(draft: ExamDraft) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(draft);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDraft(userId: string, attemptId: string): Promise<ExamDraft | null> {
  const db = await openDatabase();
  if (!db) return null;
  const result = await new Promise<ExamDraft | null>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(draftKey(userId, attemptId));
    request.onsuccess = () => resolve((request.result as ExamDraft | undefined) || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function deleteDraft(userId: string, attemptId: string) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(draftKey(userId, attemptId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearOtherAccounts(activeUserId: string) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const draft = cursor.value as ExamDraft;
      if (draft.userId !== activeUserId) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

