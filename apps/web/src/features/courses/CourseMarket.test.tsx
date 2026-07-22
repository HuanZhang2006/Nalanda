import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { CourseMarket } from "./CourseMarket";

async function settle(work?: () => void | Promise<void>) {
  await act(async () => {
    await work?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Course Market locale and shared styling", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await settle(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("defaults to English, switches to Chinese, and uses Nalanda card/button primitives", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify([{
      id: "11111111-1111-4111-8111-111111111111",
      publicationId: "22222222-2222-4222-8222-222222222222",
      title: "Academic English",
      description: null,
      authorName: "Alice",
      hasUnits: true,
      unitCount: 2,
      wordCount: 40,
      version: 1,
      cloneCount: 3,
      units: [],
    }]), { status: 200, headers: { "Content-Type": "application/json" } }))));

    await settle(() => root.render(<CourseMarket />));
    expect(container.textContent).toContain("English vocabulary");
    expect(container.textContent).toContain("Free");
    expect(container.textContent).toContain("2 units · 40 words");
    expect(container.querySelector("article")?.classList.contains("card")).toBe(true);
    expect(container.querySelector("article .btn-primary")?.textContent).toContain("Clone for free");

    await settle(() => setLocale("zh"));
    expect(container.textContent).toContain("英语单词");
    expect(container.textContent).toContain("免费");
    expect(container.textContent).toContain("2 个单元 · 40 个词");
  });
});
