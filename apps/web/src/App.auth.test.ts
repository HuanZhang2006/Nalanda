import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      ReactModule.createElement("button", { onClick: onSignOut, "data-testid": "sign-out" }, "退出"),
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

describe("认证界面状态", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
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

  it("登录成功及退出后会复位 loading，并把退出错误展示给用户", async () => {
    const inputs = container.querySelectorAll("input");
    await settle(() => {
      setInput(inputs[0] as HTMLInputElement, "alice@example.edu");
      setInput(inputs[1] as HTMLInputElement, "password");
    });
    const login = [...container.querySelectorAll("button")].filter((button) => button.textContent === "登录").at(-1)!;
    await settle(() => login.click());
    expect(container.textContent).toContain("处理中…");

    const session = { user: { id: "u1", email: "alice@example.edu" } };
    await settle(() => authHarness.callback?.("SIGNED_IN", session));
    expect(container.querySelector('[data-testid="sign-out"]')).not.toBeNull();

    authHarness.signOut.mockResolvedValueOnce({ error: new Error("offline") });
    await settle(() => (container.querySelector('[data-testid="sign-out"]') as HTMLButtonElement).click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("退出登录失败");

    await settle(() => authHarness.callback?.("SIGNED_OUT", null));
    expect(container.textContent).not.toContain("处理中…");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "登录")).toBe(true);

    authHarness.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: new Error("denied") });
    const retry = [...container.querySelectorAll("button")].filter((button) => button.textContent === "登录").at(-1)!;
    await settle(() => retry.click());
    expect(container.textContent).toContain("邮箱或密码错误");
    expect(container.textContent).not.toContain("处理中…");

    await settle(() => root.unmount());
  });
});
