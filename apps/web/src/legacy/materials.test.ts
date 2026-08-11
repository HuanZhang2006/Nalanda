import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initMaterials, mountMaterials } from "./materials";

describe("资料错误处理", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    setLocale("en", { persist: false });
  });
  afterEach(() => {
    initMaterials(null, null, null);
    document.body.innerHTML = "";
    localStorage.clear();
    setLocale("en", { persist: false });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("Storage 删除/签名失败时不伪造数据库成功", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/ai-jobs")) return Promise.resolve(new Response("[]", { status: 200 }));
      if (url.includes("/api/profile/ai-quota")) return Promise.resolve(new Response(JSON.stringify({
        plan: "free", localDate: "2026-08-10", timezone: "UTC", resetsAt: "2026-08-11T00:00:00Z",
        generation: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
        grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (init?.method === "DELETE") return Promise.resolve(new Response(JSON.stringify({ code: "UPSTREAM_UNREACHABLE", message: "storage denied" }), { status: 503, headers: { "Content-Type": "application/json" } }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }));
    const supabase = createSupabaseMock(undefined, "u1", {
      storageErrors: { remove: "storage denied", createSignedUrl: "sign denied" },
    });
    const toast = vi.fn();
    const root = document.createElement("div");
    document.body.appendChild(root);
    initMaterials(supabase, { id: "u1", email: "alice@example.edu" }, toast);
    mountMaterials(root);
    await flush(16);

    click(root.querySelector('[data-mat="download"][data-id="m1"]'));
    await flush(8);
    expect(toast).toHaveBeenCalledWith("Could not create a file link");

    click(root.querySelector('[data-mat="delete"][data-id="m1"]'));
    click(document.querySelector('[data-delete-choice="keep"]'));
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.stringContaining("temporarily unavailable"));
    });
    expect(supabase.tables.materials.some((material) => material.id === "m1")).toBe(true);
    expect(supabase.operations.some((operation) => operation.table === "materials" && operation.action === "delete")).toBe(false);
  });

  it("shows only test generation as available, validates consent, and persists a queued job", async () => {
    const created: Array<Record<string, any>> = [];
    vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes("/api/profile/ai-quota")) return new Response(JSON.stringify({
        plan: "free", localDate: "2026-08-10", timezone: "UTC", resetsAt: "2026-08-11T00:00:00Z",
        generation: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
        grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/materials/m1/ai-jobs") && init.method === "POST") {
        created.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: "job-1", materialId: "m1", materialName: "Week 1.pdf", courseId: "c1",
          kind: "exam", status: "queued", stage: "queued", progress: 0, queuePosition: 1,
          settings: created[0].settings, errorCode: null, errorMessage: null, noteId: null,
          createdAt: new Date().toISOString(), startedAt: null, finishedAt: null }),
        { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/ai-jobs")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const root = document.createElement("div"); document.body.appendChild(root);
    const toast = vi.fn();
    initMaterials(createSupabaseMock(), { id: "u1", email: "alice@example.edu" }, toast);
    mountMaterials(root); await flush(16);

    click(root.querySelector('[data-mat="useAi"][data-id="m1"]'));
    const choices = document.querySelectorAll("[data-ai-choice]");
    expect(choices).toHaveLength(4);
    expect(document.querySelectorAll("[data-ai-choice]:disabled")).toHaveLength(3);
    expect(document.body.textContent).toContain("Coming soon");
    click(document.querySelector('[data-ai-choice="exam"]'));
    click(document.querySelector("[data-ai-submit]"));
    expect(document.querySelector("[data-ai-error]")?.textContent).toContain("Confirm AI processing consent");
    (document.querySelector("#ai-consent") as HTMLInputElement).click();
    click(document.querySelector("[data-ai-submit]"));
    await flush(20);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      idempotencyKey: "11111111-1111-4111-8111-111111111111", kind: "exam", consentVersion: 1,
      settings: { durationMinutes: 60, totalMarks: 100, answerDetail: "detailed" },
    });
    expect(localStorage.getItem("nalanda-material-ai-consent-v1:u1")).toBe("1");
    expect(toast).toHaveBeenCalledWith("Test paper generation queued", "check");
  });

  it("requires the versioned disclosure independently for each account", async () => {
    localStorage.setItem("nalanda-material-ai-consent-v1:u1", "1");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/profile/ai-quota")) return new Response(JSON.stringify({
        plan: "free", localDate: "2026-08-10", timezone: "UTC", resetsAt: "2026-08-11T00:00:00Z",
        generation: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
        grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/ai-jobs")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const root = document.createElement("div"); document.body.appendChild(root);
    initMaterials(createSupabaseMock(undefined, "u2"), { id: "u2", email: "bob@example.edu" }, vi.fn());
    mountMaterials(root); await flush(16);

    click(root.querySelector('[data-mat="useAi"][data-id="m1"]'));
    click(document.querySelector('[data-ai-choice="exam"]'));
    expect(document.querySelector("#ai-consent")).not.toBeNull();
    click(document.querySelector("[data-ai-submit]"));
    expect(document.querySelector("[data-ai-error]")?.textContent).toContain("Confirm AI processing consent");
    expect(localStorage.getItem("nalanda-material-ai-consent-v1:u2")).toBeNull();
  });

  it("restores the persistent queue and opens a completed result after remount", async () => {
    const openNote = vi.fn();
    const finished = { id: "job-1", materialId: "m1", materialName: "Week 1.pdf", courseId: "c1", kind: "exam",
      status: "succeeded", stage: "succeeded", progress: 100, queuePosition: null,
      settings: { language: "auto", difficulty: "mixed", durationMinutes: 60, totalMarks: 100,
        questionCounts: { singleChoice: 8, multipleChoice: 3, trueFalse: 4, fillBlank: 3, shortAnswer: 1, essay: 1 },
        answerDetail: "detailed", focus: "" },
      errorCode: null, errorMessage: null, noteId: "note-1", createdAt: "2026-08-10T00:00:00Z",
      startedAt: "2026-08-10T00:00:01Z", finishedAt: "2026-08-10T00:00:05Z" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/profile/ai-quota")) return new Response(JSON.stringify({
        plan: "free", localDate: "2026-08-10", timezone: "UTC", resetsAt: "2026-08-11T00:00:00Z",
        generation: { limit: 10, consumed: 1, reserved: 0, remaining: 9 },
        grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/ai-jobs")) return new Response(JSON.stringify([finished]), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const root = document.createElement("div"); document.body.appendChild(root);
    initMaterials(createSupabaseMock(), { id: "u1", email: "alice@example.edu" }, vi.fn(), openNote);
    mountMaterials(root); await flush(20);

    expect(root.textContent).toContain("AI generation queue");
    expect(root.textContent).toContain("Free today · 9/10");
    expect(root.textContent).toContain("Ready");
    click(root.querySelector('[data-mat="openAiNote"]'));
    expect(openNote).toHaveBeenCalledWith("note-1");
  });

  it("stops persistent AI polling when the Materials route unmounts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/profile/ai-quota")) return new Response(JSON.stringify({
        plan: "free", localDate: "2026-08-10", timezone: "UTC", resetsAt: "2026-08-11T00:00:00Z",
        generation: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
        grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const root = document.createElement("div"); document.body.appendChild(root);
    initMaterials(createSupabaseMock(), { id: "u1", email: "alice@example.edu" }, vi.fn());
    const cleanup = mountMaterials(root);
    await flush(16);
    const callsBeforeUnmount = fetchMock.mock.calls.length;

    cleanup?.();
    root.remove();
    await vi.advanceTimersByTimeAsync(12_000);

    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmount);
  });
});
