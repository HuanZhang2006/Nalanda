import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingAttemptsForUser,
  listPendingAttempts,
  putPendingAttempt,
  removePendingAttempt,
  retryDelay,
} from "./attemptOutbox";

const userId = "user-outbox";
const sessionId = "session-outbox";

afterEach(() => clearPendingAttemptsForUser(userId));

describe("learning attempt IndexedDB outbox", () => {
  it("persists attempts in revision order and removes only the acknowledged id", async () => {
    await putPendingAttempt({
      attemptId: "later", userId, sessionId, createdAt: 2, retryCount: 0, nextAttemptAt: 0,
      request: { attemptId: "later", expectedRevision: 3, wordId: "word-b", skill: "spelling", answer: { text: "b" } },
    });
    await putPendingAttempt({
      attemptId: "first", userId, sessionId, createdAt: 1, retryCount: 0, nextAttemptAt: 0,
      request: { attemptId: "first", expectedRevision: 2, wordId: "word-a", skill: "spelling", answer: { text: "a" } },
    });
    expect((await listPendingAttempts(userId, sessionId)).map((entry) => entry.attemptId))
      .toEqual(["first", "later"]);
    await removePendingAttempt("first");
    expect((await listPendingAttempts(userId, sessionId)).map((entry) => entry.attemptId))
      .toEqual(["later"]);
  });

  it("keeps accounts isolated and uses bounded exponential retry delays", async () => {
    await putPendingAttempt({
      attemptId: "isolated", userId, sessionId, createdAt: 1, retryCount: 0, nextAttemptAt: 0,
      request: { attemptId: "isolated", expectedRevision: 0, wordId: "word", skill: "translation", answer: { translations: ["词"] } },
    });
    expect(await listPendingAttempts("another-user", sessionId)).toEqual([]);
    expect(retryDelay(0)).toBeGreaterThanOrEqual(1_000);
    expect(retryDelay(20)).toBeLessThanOrEqual(36_000);
  });
});
