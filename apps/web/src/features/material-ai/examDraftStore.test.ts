import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearOtherAccounts, loadDraft, saveDraft } from "./examDraftStore";

async function resetDatabase() {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("nalanda-material-ai");
    request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
  });
}

describe("exam draft account isolation", () => {
  beforeEach(resetDatabase);

  it("removes another account's pending draft without touching the active account", async () => {
    await saveDraft({ key: "user-1:attempt-1", userId: "user-1", attemptId: "attempt-1", revision: 1,
      answers: [{ questionId: "q1", value: "first" }], updatedAt: new Date().toISOString() });
    await saveDraft({ key: "user-2:attempt-2", userId: "user-2", attemptId: "attempt-2", revision: 2,
      answers: [{ questionId: "q2", value: "second" }], updatedAt: new Date().toISOString() });

    await clearOtherAccounts("user-2");

    expect(await loadDraft("user-1", "attempt-1")).toBeNull();
    expect(await loadDraft("user-2", "attempt-2")).toMatchObject({ revision: 2, answers: [{ questionId: "q2", value: "second" }] });
  });
});
