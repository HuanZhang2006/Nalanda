import { afterEach, describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initSchedule, mountSchedule } from "./schedule";
import { initProfile } from "./profile";

afterEach(() => vi.unstubAllGlobals());

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
    expect(toast).toHaveBeenCalledWith("任务已完成", "check");
  });

  it("删除返回 error 时保留任务并向用户报错", async () => {
    const supabase = createSupabaseMock(undefined, "u1", { errors: { study_tasks: { delete: "delete denied" } } });
    const toast = vi.fn();
    initProfile(supabase, { id: "u1", email: "alice@example.edu" }, toast);
    initSchedule(supabase, { id: "u1", email: "alice@example.edu" }, toast);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountSchedule(root);
    await flush(20);

    click(root.querySelector('[data-sc="del"][data-id="t1"]'));
    await flush(16);

    expect(supabase.tables.study_tasks.some((task) => task.id === "t1")).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("delete denied"));
  });

  it("合并独立课程复习日程并携带 Courses 深链参数", async () => {
    const today = new Date();
    const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify([{
      id: "review-1", courseId: "learning-course-1", unitId: "learning-unit-1", courseTitle: "词汇课",
      unitName: "Unit 1", dueDate, skills: ["pronunciation", "spelling"], scope: "unlearned", status: "pending", completedAt: null,
    }]), { status: 200, headers: { "Content-Type": "application/json" } }))));
    const supabase = createSupabaseMock();
    initProfile(supabase, { id: "u1", email: "alice@example.edu" }, vi.fn());
    initSchedule(supabase, { id: "u1", email: "alice@example.edu" }, vi.fn());
    const root = document.createElement("div"); document.body.appendChild(root); mountSchedule(root);
    await flush(24);

    expect(root.textContent).toContain("复习 词汇课 · Unit 1");
    expect(root.textContent).toContain("不触发普通任务积分");
    const link = root.querySelector('[data-go="courses"][data-schedule-id="review-1"]') as HTMLElement;
    expect(link?.dataset).toMatchObject({ courseId: "learning-course-1", unitId: "learning-unit-1", scheduleId: "review-1" });
  });

  it("复习 API 失败时不伪装为空状态，并继续显示普通任务", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      code: "UPSTREAM_UNREACHABLE", message: "复习服务不可用",
    }), { status: 503, headers: { "Content-Type": "application/json" } }))));
    const supabase = createSupabaseMock();
    initProfile(supabase, { id: "u1", email: "alice@example.edu" }, vi.fn());
    initSchedule(supabase, { id: "u1", email: "alice@example.edu" }, vi.fn());
    const root = document.createElement("div"); document.body.appendChild(root); mountSchedule(root);
    await flush(24);
    expect(root.textContent).toContain("复习工作记忆");
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("复习服务不可用");
  });
});
