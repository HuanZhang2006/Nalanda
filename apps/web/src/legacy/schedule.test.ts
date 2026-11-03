import { afterEach, describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initSchedule, mountSchedule } from "./schedule";
import { initProfile } from "./profile";

afterEach(() => vi.unstubAllGlobals());

describe("study plan jsdom integration", () => {
  it("covers the three views, goals, course/material links, week view, task modal, and completion", async () => {
    const supabase = createSupabaseMock();
    const toast = vi.fn();
    const user = { id: "u1", email: "alice@example.edu" };
    initProfile(supabase, user, toast);
    initSchedule(supabase, user, toast);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountSchedule(root);
    await flush(24);

    expect(root.textContent).toContain("Study plan");
    expect(root.querySelectorAll('[data-sc="settab"]')).toHaveLength(3);
    expect(root.textContent).toContain("COGS 210 final");
    expect(root.textContent).toContain("Review working memory");
    expect(root.textContent).toContain("Week 1.pdf");
    expect(root.textContent).toContain("COGS 210");

    click(root.querySelector('[data-sc="settab"][data-t="week"]'));
    expect(root.querySelectorAll(".day-col")).toHaveLength(7);
    expect(root.textContent).toContain("Finish practice questions");

    click(root.querySelector('[data-sc="settab"][data-t="all"]'));
    expect(root.textContent).toContain("Review working memory");
    expect(root.textContent).toContain("Finish practice questions");

    click(root.querySelector('.page-head [data-sc="addtask"]'));
    expect(document.querySelector(".scrim")?.textContent).toContain("New task");
    const course = document.querySelector("#tk-course") as HTMLSelectElement;
    course.value = "c1";
    course.dispatchEvent(new Event("change", { bubbles: true }));
    const material = document.querySelector("#tk-material") as HTMLSelectElement;
    expect([...material.options].map((option) => option.textContent)).toContain("Week 1.pdf");
    material.value = "m1";
    (document.querySelector("#tk-title") as HTMLInputElement).value = "New linked task";
    click(document.querySelector('[data-x="save"]'));
    await flush(24);

    expect(supabase.tables.study_tasks.some((task) => task.title === "New linked task" && task.course_id === "c1" && task.material_id === "m1")).toBe(true);

    click(root.querySelector('.page-head [data-sc="addgoal"]'));
    (document.querySelector("#gl-title") as HTMLInputElement).value = "New goal";
    click(document.querySelector('[data-x="save"]'));
    await flush(24);
    expect(supabase.tables.study_goals.some((goal) => goal.title === "New goal")).toBe(true);
    expect(root.textContent).toContain("New goal");

    click(root.querySelector('[data-sc="settab"][data-t="today"]'));
    click(root.querySelector('[data-sc="toggle"][data-id="t1"]'));
    await flush(24);
    expect(supabase.tables.study_tasks.find((task) => task.id === "t1")?.done).toBe(true);
    expect(toast).toHaveBeenCalledWith("Task completed", "check");
    const toggle = [...supabase.operations].reverse().find((operation) =>
      operation.table === "study_tasks" && operation.action === "update");
    expect(toggle?.payload).toEqual({ done: true });
    expect(supabase.rpc).toHaveBeenCalledWith("get_point_reward_receipt", {
      p_event_type: "task_completed", p_source_id: "t1",
    });
  });

  it("keeps the task and reports an error when delete returns an error", async () => {
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

  it("merges independent course review schedules and carries Courses deep-link parameters", async () => {
    const today = new Date();
    const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify([{
      id: "review-1", courseId: "learning-course-1", unitId: "learning-unit-1", courseTitle: "Vocabulary course",
      unitName: "Unit 1", dueDate, skills: ["pronunciation", "spelling"], scope: "unlearned", status: "pending", completedAt: null,
    }]), { status: 200, headers: { "Content-Type": "application/json" } }))));
    const supabase = createSupabaseMock();
    initProfile(supabase, { id: "u1", email: "alice@example.edu" }, vi.fn());
    initSchedule(supabase, { id: "u1", email: "alice@example.edu" }, vi.fn());
    const root = document.createElement("div"); document.body.appendChild(root); mountSchedule(root);
    await flush(24);

    expect(root.textContent).toContain("Review Vocabulary course · Unit 1");
    expect(root.textContent).toContain("No regular task points");
    const link = root.querySelector('[data-go="courses"][data-schedule-id="review-1"]') as HTMLElement;
    expect(link?.dataset).toMatchObject({ courseId: "learning-course-1", unitId: "learning-unit-1", scheduleId: "review-1" });
  });

  it("does not fake an empty state when the review API fails and keeps showing regular tasks", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      code: "UPSTREAM_UNREACHABLE", message: "Review service unavailable",
    }), { status: 503, headers: { "Content-Type": "application/json" } }))));
    const supabase = createSupabaseMock();
    initProfile(supabase, { id: "u1", email: "alice@example.edu" }, vi.fn());
    initSchedule(supabase, { id: "u1", email: "alice@example.edu" }, vi.fn());
    const root = document.createElement("div"); document.body.appendChild(root); mountSchedule(root);
    await flush(24);
    expect(root.textContent).toContain("Review working memory");
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Review service unavailable");
  });
});
