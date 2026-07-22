import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ApiErrorFilter } from "./api-error.filter";

describe("ApiErrorFilter", () => {
  it("preserves the dependency readiness response", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    };
    const payload = {
      status: "error",
      service: "nalanda-api",
      time: "2026-07-22T00:00:00.000Z",
      deps: { redis: "unset", ai: "unset", supabase: "unavailable" },
    };

    new ApiErrorFilter().catch(new ServiceUnavailableException(payload), host as never);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(payload);
  });

  it("keeps product errors on the normalized API envelope", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    };

    new ApiErrorFilter().catch(new ServiceUnavailableException("provider failed"), host as never);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ code: "INTERNAL_ERROR", message: "provider failed" });
  });
});
