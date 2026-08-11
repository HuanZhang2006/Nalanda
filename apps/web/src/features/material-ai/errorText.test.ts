import { describe, expect, it } from "vitest";
import { materialAiErrorText } from "./errorText";

describe("materialAiErrorText", () => {
  const en = (english: string) => english;
  const zh = (_english: string, chinese: string) => chinese;

  it("localizes stable provider and safety errors through the shared locale", () => {
    expect(materialAiErrorText({ code: "PROMPT_INJECTION_REJECTED" }, "fallback", en))
      .toBe("Unsafe embedded instructions were detected, so this job was refused.");
    expect(materialAiErrorText({ code: "OPENROUTER_ZDR_UNAVAILABLE" }, "fallback", zh))
      .toBe("当前没有符合零数据保留要求的模型端点。");
  });

  it("preserves a useful unknown Error message and otherwise uses the caller fallback", () => {
    expect(materialAiErrorText(new Error("network down"), "fallback", en)).toBe("network down");
    expect(materialAiErrorText({ code: "UNKNOWN" }, "fallback", en)).toBe("fallback");
  });
});
