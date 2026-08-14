import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initMaterials, mountMaterials } from "./materials";

const capabilities = {
  materialId: "m1",
  capabilities: [
    { pipeline: "luna_native_file_v1", available: true, default: true, model: "openai/gpt-5.6-luna", provider: "OpenAI", reasonCode: null },
    { pipeline: "document_ir_v1", available: true, default: false, model: "deepseek/deepseek-v4-flash-0731", provider: "OpenRouter routed ZDR provider", reasonCode: null },
  ],
};

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
      if (url.includes("/api/materials/m1/ai-capabilities")) return new Response(JSON.stringify(capabilities), { status: 200, headers: { "Content-Type": "application/json" } });
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

  it("shows test and knowledge-map generation, validates consent, and persists a queued exam job", async () => {
    const created: Array<Record<string, any>> = [];
    vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes("/api/materials/m1/ai-capabilities")) return new Response(JSON.stringify(capabilities), { status: 200, headers: { "Content-Type": "application/json" } });
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
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-ai-choice]")).toHaveLength(4);
    });
    expect(document.querySelectorAll("[data-ai-choice]:disabled")).toHaveLength(2);
    expect(document.body.textContent).toContain("Organize knowledge points");
    expect(document.body.textContent).toContain("Coming soon");
    click(document.querySelector('[data-ai-choice="exam"]'));
    click(document.querySelector("[data-ai-submit]"));
    expect(document.querySelector("[data-ai-error]")?.textContent).toContain("Confirm AI processing consent");
    (document.querySelector("#ai-consent") as HTMLInputElement).click();
    click(document.querySelector("[data-ai-submit]"));
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      idempotencyKey: "11111111-1111-4111-8111-111111111111", kind: "exam", consentVersion: 1,
      pipeline: "luna_native_file_v1",
      settings: { durationMinutes: 60, totalMarks: 100, answerDetail: "detailed" },
    });
    expect(localStorage.getItem("nalanda-material-ai-consent-v1:u1")).toBe("1");
    expect(toast).toHaveBeenCalledWith("Test paper generation queued", "check");
  });

  it("requires the versioned disclosure independently for each account", async () => {
    localStorage.setItem("nalanda-material-ai-consent-v1:u1", "1");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/materials/m1/ai-capabilities")) return new Response(JSON.stringify(capabilities), { status: 200, headers: { "Content-Type": "application/json" } });
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
    await vi.waitFor(() => {
      expect(document.querySelector('[data-ai-choice="exam"]')).not.toBeNull();
    });
    click(document.querySelector('[data-ai-choice="exam"]'));
    expect(document.querySelector("#ai-consent")).not.toBeNull();
    click(document.querySelector("[data-ai-submit]"));
    expect(document.querySelector("[data-ai-error]")?.textContent).toContain("Confirm AI processing consent");
    expect(localStorage.getItem("nalanda-material-ai-consent-v1:u2")).toBeNull();
  });

  it("keeps Materials English in Chinese global locale and queues knowledge-point organization", async () => {
    setLocale("zh", { persist: false });
    localStorage.setItem("nalanda-material-ai-consent-v1:u1", "1");
    const created: Array<Record<string, any>> = [];
    vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes("/api/materials/m1/ai-capabilities")) return new Response(JSON.stringify(capabilities), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/profile/ai-quota")) return new Response(JSON.stringify({
        plan: "free", localDate: "2026-08-10", timezone: "UTC", resetsAt: "2026-08-11T00:00:00Z",
        generation: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
        grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/materials/m1/ai-jobs") && init.method === "POST") {
        created.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: "job-graph", materialId: "m1", materialName: "Week 1.pdf", courseId: "c1",
          kind: "knowledge_graph", status: "queued", stage: "queued", progress: 0, queuePosition: 1,
          settings: created[0].settings, errorCode: null, errorMessage: null, noteId: null, retryable: false,
          resumeUntil: null, checkpointStage: null, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null }),
        { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/ai-jobs")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const root = document.createElement("div"); document.body.appendChild(root);
    initMaterials(createSupabaseMock(), { id: "u1", email: "alice@example.edu" }, vi.fn());
    mountMaterials(root); await flush(16);
    expect(root.textContent).toContain("Upload material");
    expect(root.textContent).not.toMatch(/上传|资料库|新建科目/);

    click(root.querySelector('[data-mat="useAi"][data-id="m1"]'));
    await vi.waitFor(() => {
      expect(document.querySelector('[data-ai-choice="knowledge_graph"]')).not.toBeNull();
    });
    click(document.querySelector('[data-ai-choice="knowledge_graph"]'));
    expect(document.body.textContent).toContain("Build a comprehensive knowledge map in source order");
    expect(document.body.textContent).not.toMatch(/知识点|取消|语言/);
    click(document.querySelector("[data-ai-submit]"));
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      kind: "knowledge_graph",
      pipeline: "luna_native_file_v1",
      consentVersion: 1,
      settings: { language: "auto", detail: "comprehensive", focus: "" },
    });
  });

  it("resumes the same retryable job instead of creating a replacement", async () => {
    const retry = vi.fn();
    const failed = { id: "job-1", materialId: "m1", materialName: "Week 1.pdf", courseId: "c1", kind: "exam",
      status: "failed", stage: "failed", progress: 70, queuePosition: null, settings: {},
      errorCode: "AI_WORKER_TIMEOUT", errorMessage: "Timed out", noteId: null, retryable: true,
      resumeUntil: "2026-08-12T00:00:00Z", checkpointStage: "document_ready",
      createdAt: "2026-08-10T00:00:00Z", startedAt: "2026-08-10T00:00:01Z", finishedAt: "2026-08-10T00:05:00Z" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes("/api/profile/ai-quota")) return new Response(JSON.stringify({
        plan: "free", localDate: "2026-08-10", timezone: "UTC", resetsAt: "2026-08-11T00:00:00Z",
        generation: { limit: 10, consumed: 0, reserved: 0, remaining: 10 }, grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/api/ai-jobs/job-1/retry") && init.method === "POST") {
        retry(); return new Response(JSON.stringify({ ...failed, status: "queued", stage: "generating", retryable: false }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/ai-jobs")) return new Response(JSON.stringify([failed]), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const root = document.createElement("div"); document.body.appendChild(root);
    initMaterials(createSupabaseMock(), { id: "u1", email: "alice@example.edu" }, vi.fn());
    mountMaterials(root); await flush(20);
    click(root.querySelector('[data-mat="retryAiJob"]'));
    await flush(12);
    expect(retry).toHaveBeenCalledOnce();
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
    expect(root.textContent).toContain("Test paper · Ready");
    expect(root.textContent).toContain("Ready");
    click(root.querySelector('[data-mat="openAiNote"]'));
    expect(openNote).toHaveBeenCalledWith("note-1");
  });

  it("requires in-app confirmation, interrupts one active job, and clears only terminal history", async () => {
    const active = { id: "job-active", materialId: "m1", materialName: "Week 1.pdf", courseId: "c1", kind: "exam",
      pipeline: "luna_native_file_v1", model: "openai/gpt-5.6-luna", status: "processing", stage: "generating", progress: 70,
      queuePosition: null, settings: {}, errorCode: null, errorMessage: null, noteId: null, retryable: false,
      resumeUntil: null, checkpointStage: "native_audited", createdAt: "2026-08-10T00:00:00Z",
      startedAt: "2026-08-10T00:00:01Z", finishedAt: null };
    const finished = { ...active, id: "job-finished", status: "succeeded", stage: "succeeded", progress: 100,
      noteId: "note-1", finishedAt: "2026-08-10T00:03:00Z" };
    let jobs = [active, finished];
    const deleted: string[] = [];
    let clearCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes("/api/profile/ai-quota")) return new Response(JSON.stringify({
        plan: "free", localDate: "2026-08-10", timezone: "UTC", resetsAt: "2026-08-11T00:00:00Z",
        generation: { limit: 10, consumed: 0, reserved: 1, remaining: 9 }, grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/api/ai-jobs/job-active") && init.method === "DELETE") {
        deleted.push("job-active"); jobs = [{ ...active, status: "deleting", stage: "cleaning" }, finished];
        return new Response(JSON.stringify({ jobId: "job-active", status: "cleaning", quotaConsumed: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/ai-jobs/clear-history") && init.method === "POST") {
        clearCalls += 1; jobs = jobs.filter((job) => job.status === "deleting");
        return new Response(JSON.stringify({ requested: 1, deleted: 0, cleaning: 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/ai-jobs")) return new Response(JSON.stringify(jobs), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const root = document.createElement("div"); document.body.appendChild(root);
    initMaterials(createSupabaseMock(), { id: "u1", email: "alice@example.edu" }, vi.fn());
    mountMaterials(root); await flush(20);

    click(root.querySelector('[data-mat="deleteAiJob"][data-id="job-active"]'));
    expect(document.body.textContent).toContain("One free generation is consumed");
    click(document.querySelector('[data-cf="no"]'));
    expect(deleted).toEqual([]);

    click(root.querySelector('[data-mat="deleteAiJob"][data-id="job-active"]'));
    click(document.querySelector('[data-cf="yes"]'));
    await flush(16);
    expect(deleted).toEqual(["job-active"]);
    await vi.waitFor(() => expect(root.textContent).toContain("Cleaning up…"));

    click(root.querySelector('[data-mat="clearAiHistory"]'));
    expect(document.body.textContent).toContain("Active tasks are not affected");
    click(document.querySelector('[data-cf="yes"]'));
    await flush(16);
    await vi.waitFor(() => expect(clearCalls).toBe(1));
    await vi.waitFor(() => expect(root.querySelector('[data-mat="clearAiHistory"]')).toBeNull());
    expect(root.textContent).toContain("Cleaning up…");
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
