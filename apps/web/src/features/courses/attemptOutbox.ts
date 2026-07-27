import type { LearningAttemptRequest } from "@nalanda/types";

export interface PendingLearningAttempt {
  attemptId: string;
  userId: string;
  sessionId: string;
  request: LearningAttemptRequest;
  createdAt: number;
  retryCount: number;
  nextAttemptAt: number;
}

const DATABASE = "nalanda-learning";
const VERSION = 1;
const STORE = "attempt-outbox";
const STORAGE_TIMEOUT_MS = 2_000;
const memory = new Map<string, PendingLearningAttempt>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

function openDatabase() {
  if (databasePromise) return databasePromise;
  if (!("indexedDB" in globalThis)) return Promise.resolve(null);
  databasePromise = new Promise((resolve) => {
    let settled = false;
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      if (!database) databasePromise = null;
      resolve(database);
    };
    const timer = window.setTimeout(() => finish(null), STORAGE_TIMEOUT_MS);
    try {
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "attemptId" });
          store.createIndex("user-session-revision", [
            "userId", "sessionId", "request.expectedRevision",
          ], { unique: false });
        }
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  return databasePromise;
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, done: (value: T) => void) => void,
  fallback: () => T,
) {
  const database = await openDatabase();
  if (!database) return fallback();
  return new Promise<T>((resolve) => {
    let timer: number | undefined;
    try {
      const tx = database.transaction(STORE, mode);
      let settled = false;
      const done = (value: T) => {
        if (!settled) {
          settled = true;
          if (timer != null) window.clearTimeout(timer);
          resolve(value);
        }
      };
      timer = window.setTimeout(() => done(fallback()), STORAGE_TIMEOUT_MS);
      work(tx.objectStore(STORE), done);
      tx.onerror = () => done(fallback());
      tx.onabort = () => done(fallback());
    } catch {
      if (timer != null) window.clearTimeout(timer);
      resolve(fallback());
    }
  });
}

export async function putPendingAttempt(entry: PendingLearningAttempt) {
  memory.set(entry.attemptId, entry);
  await transaction<void>("readwrite", (store, done) => {
    const request = store.put(entry);
    request.onsuccess = () => done();
    request.onerror = () => done();
  }, () => undefined);
}

export async function removePendingAttempt(attemptId: string) {
  memory.delete(attemptId);
  await transaction<void>("readwrite", (store, done) => {
    const request = store.delete(attemptId);
    request.onsuccess = () => done();
    request.onerror = () => done();
  }, () => undefined);
}

export async function listPendingAttempts(userId: string, sessionId: string) {
  const persisted = await transaction<PendingLearningAttempt[]>("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result as PendingLearningAttempt[])
      .filter((entry) => entry.userId === userId && entry.sessionId === sessionId)
      .sort((left, right) =>
        left.request.expectedRevision - right.request.expectedRevision
        || left.createdAt - right.createdAt));
    request.onerror = () => done([]);
  }, () => [...memory.values()]
    .filter((entry) => entry.userId === userId && entry.sessionId === sessionId)
    .sort((left, right) =>
      left.request.expectedRevision - right.request.expectedRevision
      || left.createdAt - right.createdAt));
  const merged = new Map(persisted.map((entry) => [entry.attemptId, entry]));
  for (const entry of memory.values()) {
    if (entry.userId === userId && entry.sessionId === sessionId) {
      merged.set(entry.attemptId, entry);
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.request.expectedRevision - right.request.expectedRevision
    || left.createdAt - right.createdAt);
}

export async function clearPendingAttemptsForUser(userId: string) {
  [...memory.values()].forEach((entry) => {
    if (entry.userId === userId) memory.delete(entry.attemptId);
  });
  const entries = await transaction<PendingLearningAttempt[]>("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done(request.result as PendingLearningAttempt[]);
    request.onerror = () => done([]);
  }, () => []);
  await Promise.all(entries
    .filter((entry) => entry.userId === userId)
    .map((entry) => removePendingAttempt(entry.attemptId)));
}

export function retryDelay(retryCount: number) {
  const base = Math.min(30_000, 1_000 * (2 ** Math.min(5, retryCount)));
  return base + Math.floor(Math.random() * Math.max(1, base * 0.2));
}
