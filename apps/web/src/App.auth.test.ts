import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authHarness = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: any) => void),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("./lib/supabase", () => ({
  supabaseConfigured: true,
  supabase: { auth: authHarness },
}));

vi.mock("./NalandaApp", async () => {
  const ReactModule = await import("react");
  return {
    NalandaApp: ({ onSignOut }: { onSignOut: () => void }) =>
      ReactModule.createElement("button", { onClick: onSignOut, "data-testid": "sign-out" }, "Sign out"),
  };
});

import { App } from "./App";

async function settle(work?: () => void | Promise<void>) {
  await act(async () => {
    await work?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("auth screen state", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    authHarness.callback = null;
    authHarness.getSession.mockResolvedValue({ data: { session: null }, error: null });
    authHarness.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });
    authHarness.signOut.mockResolvedValue({ error: null });
    authHarness.onAuthStateChange.mockImplementation((callback: typeof authHarness.callback) => {
      authHarness.callback = callback;
      return { data: { subscription: { unsubscribe: authHarness.unsubscribe } } };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await settle(() => root.render(React.createElement(App)));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resets loading after sign-in and sign-out, and shows sign-out errors to the user", async () => {
    const inputs = container.querySelectorAll("input");
    await settle(() => {
      setInput(inputs[0] as HTMLInputElement, "alice@example.edu");
      setInput(inputs[1] as HTMLInputElement, "password");
    });
    const login = [...container.querySelectorAll("button")].filter((button) => button.textContent === "Sign in").at(-1)!;
    await settle(() => login.click());
    expect(container.textContent).toContain("Working…");

    const session = { user: { id: "u1", email: "alice@example.edu" } };
    await settle(() => authHarness.callback?.("SIGNED_IN", session));
    expect(container.querySelector('[data-testid="sign-out"]')).not.toBeNull();

    authHarness.signOut.mockResolvedValueOnce({ error: new Error("offline") });
    await settle(() => (container.querySelector('[data-testid="sign-out"]') as HTMLButtonElement).click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign-out failed");

    await settle(() => authHarness.callback?.("SIGNED_OUT", null));
    expect(container.textContent).not.toContain("Working…");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Sign in")).toBe(true);

    authHarness.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: new Error("denied") });
    const retry = [...container.querySelectorAll("button")].filter((button) => button.textContent === "Sign in").at(-1)!;
    await settle(() => retry.click());
    expect(container.textContent).toContain("Incorrect email or password.");
    expect(container.textContent).not.toContain("Working…");

    await settle(() => root.unmount());
  });

  it("shows the recovery time for a sign-up 429 and does not attempt sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "RATE_LIMITED", message: "Too many requests", retryAfterSeconds: 42,
    }), { status: 429, headers: { "Content-Type": "application/json" } })));
    const signupTab = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign up")!;
    await settle(() => signupTab.click());
    const inputs = container.querySelectorAll("input");
    await settle(() => {
      setInput(inputs[0] as HTMLInputElement, "alice@example.edu");
      setInput(inputs[1] as HTMLInputElement, "password");
    });
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign up and continue")!;
    await settle(() => submit.click());
    expect(container.textContent).toContain("Too many sign-up attempts");
    expect(container.textContent).toContain("about 42 seconds");
    expect(authHarness.signInWithPassword).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Working…");
    await settle(() => root.unmount());
  });

  it("switches the sign-in screen and visible errors to Chinese and back", async () => {
    authHarness.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: new Error("denied") });
    const inputs = container.querySelectorAll("input");
    await settle(() => {
      setInput(inputs[0] as HTMLInputElement, "alice@example.edu");
      setInput(inputs[1] as HTMLInputElement, "password");
    });
    const login = [...container.querySelectorAll("button")].filter((button) => button.textContent === "Sign in").at(-1)!;
    await settle(() => login.click());
    expect(container.textContent).toContain("Incorrect email or password.");

    const languageButton = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "中文" || button.textContent === "EN")!;
    await settle(() => languageButton().click());
    expect(container.textContent).toContain("邮箱或密码错误");
    expect(container.textContent).toContain("密码");
    expect(languageButton().textContent).toBe("EN");

    await settle(() => languageButton().click());
    expect(container.textContent).toContain("Incorrect email or password.");
    await settle(() => root.unmount());
  });
});
