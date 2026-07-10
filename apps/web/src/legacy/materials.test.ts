import { describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initMaterials, mountMaterials } from "./materials";

describe("资料错误处理", () => {
  it("Storage 删除/签名失败时不伪造数据库成功", async () => {
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
    expect(toast).toHaveBeenCalledWith("无法获取文件链接");

    click(root.querySelector('[data-mat="delete"][data-id="m1"]'));
    click(document.querySelector('[data-cf="yes"]'));
    await flush(12);
    expect(supabase.tables.materials.some((material) => material.id === "m1")).toBe(true);
    expect(supabase.operations.some((operation) => operation.table === "materials" && operation.action === "delete")).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("storage denied"));
  });
});
