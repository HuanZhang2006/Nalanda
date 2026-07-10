import { describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initSchedule, mountSchedule } from "./schedule";
import { initProfile } from "./profile";

describe("学习计划 jsdom 集成", () => {
  it("覆盖三视图、目标、课程/资料关联、周视图、任务弹窗与完成", async () => {
    const supabase = createSupabaseMock();
    const toast = vi.fn();
    const user = { id: "u1", email: "alice@example.edu" };
    initProfile(supabase, user, toast);
    initSchedule(supabase, user, toast);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountSchedule(root);
    await flush(24);

    expect(root.textContent).toContain("学习计划");
    expect(root.querySelectorAll('[data-sc="settab"]')).toHaveLength(3);
    expect(root.textContent).toContain("COGS 210 期末");
    expect(root.textContent).toContain("复习工作记忆");
    expect(root.textContent).toContain("Week 1.pdf");
    expect(root.textContent).toContain("COGS 210");

    click(root.querySelector('[data-sc="settab"][data-t="week"]'));
    expect(root.querySelectorAll(".day-col")).toHaveLength(7);
    expect(root.textContent).toContain("完成练习题");

    click(root.querySelector('[data-sc="settab"][data-t="all"]'));
    expect(root.textContent).toContain("复习工作记忆");
    expect(root.textContent).toContain("完成练习题");

    click(root.querySelector('.page-head [data-sc="addtask"]'));
    expect(document.querySelector(".scrim")?.textContent).toContain("新任务");
    const course = document.querySelector("#tk-course") as HTMLSelectElement;
    course.value = "c1";
    course.dispatchEvent(new Event("change", { bubbles: true }));
    const material = document.querySelector("#tk-material") as HTMLSelectElement;
    expect([...material.options].map((option) => option.textContent)).toContain("Week 1.pdf");
    material.value = "m1";
    (document.querySelector("#tk-title") as HTMLInputElement).value = "新建关联任务";
    click(document.querySelector('[data-x="save"]'));
    await flush(24);

    expect(supabase.tables.study_tasks.some((task) => task.title === "新建关联任务" && task.course_id === "c1" && task.material_id === "m1")).toBe(true);

    click(root.querySelector('.page-head [data-sc="addgoal"]'));
    (document.querySelector("#gl-title") as HTMLInputElement).value = "新目标";
    click(document.querySelector('[data-x="save"]'));
    await flush(24);
    expect(supabase.tables.study_goals.some((goal) => goal.title === "新目标")).toBe(true);
    expect(root.textContent).toContain("新目标");

    click(root.querySelector('[data-sc="settab"][data-t="today"]'));
    click(root.querySelector('[data-sc="toggle"][data-id="t1"]'));
    await flush(24);
    expect(supabase.tables.study_tasks.find((task) => task.id === "t1")?.done).toBe(true);
    expect(toast).toHaveBeenCalledWith("完成 +5 积分", "check");
  });
});

