import { describe, expect, it } from "vitest";
import { IpaService } from "./ipa.service";

describe("CMUdict IPA adapter", () => {
  it("converts known US-English words and composes phrases locally", () => {
    const service = new IpaService();
    expect(service.lookup("apple")).toBeTruthy();
    const phrase = service.lookup("take part");
    expect(phrase).toBeTruthy();
    expect(phrase!.split(" ")).toHaveLength(2);
  });

  it("returns null when any phrase token is unavailable", () => {
    expect(new IpaService().lookup("notawordxyz take")).toBeNull();
  });
});
