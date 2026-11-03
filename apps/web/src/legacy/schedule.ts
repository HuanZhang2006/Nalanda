// @ts-nocheck
// Study plan: today/week/all views, task create/edit/delete + completion (points + streak), goal countdowns,
// linked courses/materials (shared with Materials), and one-click review tasks from courses. Direct Supabase + RLS.
import { localize } from "../i18n";
import { ICON } from "./icons";
import { syncShellUser } from "./profile";
import { apiJson } from "../lib/api";
import { showPointRewardReceipt } from "./point-receipt";

let sb = null, USER = null, toastFn = () => {};
let rootEl = null;
const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const state = { loading: true, error: "", reviewError: "", tab: "today", tasks: [], reviews: [], goals: [], courses: [], materials: [], streak: 0, timezone: DEVICE_TIMEZONE };
let sessionVersion = 0;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: state.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch { return dstr(new Date()); }
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const WK = [["Sun", "周日"], ["Mon", "周一"], ["Tue", "周二"], ["Wed", "周三"], ["Thu", "周四"], ["Fri", "周五"], ["Sat", "周六"]];
const TODAY = () => localize("Today", "今天");
const courseById = (id) => state.courses.find((c) => c.id === id);
const materialById = (id) => state.materials.find((m) => m.id === id);

export function initSchedule(supabase, user, toast) {
  sessionVersion++;
  sb = supabase; USER = user; toastFn = toast || (() => {});
  rootEl = null;
  Object.assign(state, { loading: true, error: "", reviewError: "", tab: "today", tasks: [], reviews: [], goals: [], courses: [], materials: [], streak: 0, timezone: DEVICE_TIMEZONE });
}
export function mountSchedule(el) { rootEl = el; if (!rootEl) return; render(); load(); }

async function load() {
  const currentVersion = sessionVersion;
  if (!sb) { state.loading = false; state.error = localize("Supabase is not configured", "未配置 Supabase"); render(); return; }
  state.loading = true; render();
  try {
    const since = dstr(addDays(new Date(), -14));
    const [t, g, c, m, p, reviews] = await Promise.all([
      sb.from("study_tasks").select("*").gte("due_date", since).order("due_date", { ascending: true }),
      sb.from("study_goals").select("*").order("exam_date", { ascending: true }),
      sb.from("courses").select("id,code,name,color").order("created_at", { ascending: true }),
      sb.from("materials").select("id,name,course_id,type").order("created_at", { ascending: false }),
      sb.from("profiles").select("streak,timezone").eq("id", USER.id).single(),
      apiJson("/api/learning-review-schedules", {}, true, false)
        .then((data) => ({ data, error: "" }))
        .catch((error) => ({ data: [], error: error?.message || localize("Course review schedules could not be loaded", "课程复习日程加载失败") })),
    ]);
    if (currentVersion !== sessionVersion) return;
    const failed = [t, g, c, m, p].find((result) => result.error);
    if (failed) throw failed.error;
    state.tasks = t.data || []; state.goals = g.data || []; state.courses = c.data || []; state.materials = m.data || [];
    state.reviews = (reviews.data || []).filter((review) => review.status !== "cancelled");
    state.reviewError = reviews.error;
    state.streak = (p.data && p.data.streak) || 0;
    state.timezone = (p.data && p.data.timezone) || DEVICE_TIMEZONE;
    state.error = "";
  } catch (e) { if (currentVersion !== sessionVersion) return; state.error = e.message || localize("Load failed", "加载失败"); }
  if (currentVersion !== sessionVersion) return;
  state.loading = false; render();
}

function stats() {
  const today = todayStr();
  const wkEnd = dstr(addDays(new Date(`${today}T12:00:00`), 6));
  const wk = state.tasks.filter((t) => t.due_date >= today && t.due_date <= wkEnd);
  const wkReviews = state.reviews.filter((review) => review.dueDate >= today && review.dueDate <= wkEnd);
  const wkDone = wk.filter((t) => t.done).length + wkReviews.filter((review) => review.status === "completed").length;
  const overdue = state.tasks.filter((t) => !t.done && t.due_date < today).length
    + state.reviews.filter((review) => review.status === "pending" && review.dueDate < today).length;
  return { wkTotal: wk.length + wkReviews.length, wkDone, overdue };
}

function goalsBar() {
  if (!state.goals.length) return "";
  const today = new Date(todayStr());
  return `<div class="row gap-8 wrap-flex" style="margin-bottom:16px">${state.goals.map((g) => {
    const d = g.exam_date ? Math.round((new Date(g.exam_date) - today) / 86400000) : null;
    const lbl = d == null ? localize("No date", "无日期") : d > 0 ? `D-${d}` : d === 0 ? TODAY() : localize(`${-d} d ago`, `已过 ${-d} 天`);
    return `<span class="chip ${d != null && d <= 7 && d >= 0 ? "chip-accent" : "chip-outline"}">${ICON("exam")} ${esc(g.title)} · ${lbl}
      <span data-sc="delgoal" data-id="${g.id}" style="cursor:pointer;margin-left:4px;opacity:.6">✕</span></span>`;
  }).join("")}</div>`;
}

function matChip(id) {
  const m = materialById(id); if (!m) return "";
  return `<span class="chip chip-tag" data-go="materials" style="cursor:pointer">${ICON("file")} ${esc(m.name)}</span>`;
}

function taskRow(t) {
  const c = courseById(t.course_id);
  const overdue = !t.done && t.due_date < todayStr();
  return `<div class="row gap-10" style="padding:9px 10px;border-radius:10px;border:1px solid var(--border);background:var(--card-2);margin-bottom:8px;${t.done ? "opacity:.6" : ""}">
    <button data-sc="toggle" data-id="${t.id}" style="width:20px;height:20px;border-radius:6px;flex:none;display:grid;place-items:center;border:1.5px solid ${t.done ? "var(--good)" : "var(--border-strong)"};background:${t.done ? "var(--good)" : "transparent"};color:#fff">${t.done ? ICON("check") : ""}</button>
    <div class="fill" style="min-width:0">
      <div style="font-size:13.5px;font-weight:600;${t.done ? "text-decoration:line-through" : ""}">${esc(t.title)}</div>
      <div class="row gap-6 wrap-flex" style="margin-top:3px">
        ${c ? `<span class="chip chip-outline nowrap" data-go="materials" style="cursor:pointer;border-color:${(c.color || "#9c6a39")}55;color:${c.color || "#9c6a39"}">${esc(c.code || c.name)}</span>` : ""}
        ${matChip(t.material_id)}
        ${overdue ? `<span class="chip" style="background:color-mix(in srgb,var(--pink) 16%,var(--card));color:var(--pink)">${localize("Overdue", "逾期")}</span>` : ""}
      </div>
    </div>
    <button class="icon-btn" data-sc="edit" data-id="${t.id}" style="width:30px;height:30px">${ICON("edit")}</button>
    <button class="icon-btn" data-sc="del" data-id="${t.id}" style="width:30px;height:30px">${ICON("close")}</button>
  </div>`;
}

function reviewRow(review) {
  const done = review.status === "completed";
  const labels = (review.skills || []).map((skill) => skill === "pronunciation" ? localize("Pronunciation", "发音") : skill === "translation" ? localize("Translation", "翻译") : localize("Spelling", "拼写")).join(" · ");
  return `<div class="row gap-10" style="padding:9px 10px;border-radius:10px;border:1px solid var(--accent-line);background:var(--accent-tint);margin-bottom:8px;${done ? "opacity:.6" : ""}">
    <div style="width:20px;height:20px;border-radius:6px;display:grid;place-items:center;background:${done ? "var(--good)" : "var(--accent)"};color:var(--on-accent)">${done ? ICON("check") : ICON("clock")}</div>
    <div class="fill"><div style="font-size:13.5px;font-weight:650;${done ? "text-decoration:line-through" : ""}">${localize("Review", "复习")} ${esc(review.courseTitle || localize("English vocabulary course", "英语单词课程"))} · ${esc(review.unitName || localize("Word list", "词表"))}</div>
      <div class="faint" style="font-size:11.5px;margin-top:3px">${localize("Independent course review", "独立课程复习")} · ${esc(labels)} · ${review.scope === "all" ? localize("All words", "全部单词") : localize("Not yet mastered", "尚未熟练")} · ${localize("No regular task points", "不触发普通任务积分")}</div></div>
    ${done ? `<span class="chip">${localize("Completed", "已完成")}</span>` : `<button class="btn btn-primary btn-sm" data-go="courses" data-course-id="${review.courseId}" data-unit-id="${review.unitId}" data-schedule-id="${review.id}">${ICON("play")}<span>${localize("Start review", "开始复习")}</span></button>`}
  </div>`;
}

function body() {
  if (state.loading) return `<div class="card card-pad muted">${localize("Loading…", "加载中…")}</div>`;
  if (state.error) return `<div class="card card-pad" style="color:var(--pink)">${localize("Something went wrong: ", "出错了：")}${esc(state.error)}</div>`;
  const today = todayStr();
  if (state.tab === "today") {
    const overdue = state.tasks.filter((t) => !t.done && t.due_date < today);
    const overdueReviews = state.reviews.filter((review) => review.status === "pending" && review.dueDate < today);
    const todays = state.tasks.filter((t) => t.due_date === today);
    const todayReviews = state.reviews.filter((review) => review.dueDate === today);
    return `${overdue.length || overdueReviews.length ? `<div class="sec-h" style="margin-top:0"><h2 class="serif" style="font-size:16px;color:var(--pink)">${localize("Overdue", "逾期")} ${overdue.length + overdueReviews.length}</h2></div>${overdue.map(taskRow).join("")}${overdueReviews.map(reviewRow).join("")}` : ""}
      <div class="sec-h" style="margin-top:${overdue.length || overdueReviews.length ? 18 : 0}px"><h2 class="serif" style="font-size:16px">${TODAY()}</h2><button class="btn btn-sm" data-sc="addtask" data-date="${today}">${ICON("plus")}<span>${localize("Add task", "加任务")}</span></button></div>
      ${todays.length || todayReviews.length ? todays.map(taskRow).join("") + todayReviews.map(reviewRow).join("") : `<div class="card card-pad muted" style="text-align:center">${localize("No tasks or course reviews today.", "今天没有任务或课程复习。")}</div>`}`;
  }
  if (state.tab === "week") {
    const days = [];
    for (let i = 0; i < 7; i++) { const d = addDays(new Date(`${today}T12:00:00`), i); days.push(dstr(d)); }
    return `<div class="grid" style="grid-template-columns:repeat(7,1fr);gap:10px">${days.map((ds, i) => {
      const dt = new Date(ds);
      const list = state.tasks.filter((t) => t.due_date === ds);
      const reviews = state.reviews.filter((review) => review.dueDate === ds);
      return `<div class="day-col" style="min-height:140px">
        <div class="row between" style="margin-bottom:6px"><b style="font-size:12.5px">${i === 0 ? TODAY() : localize(...WK[dt.getDay()])}</b><span class="faint" style="font-size:11px">${dt.getMonth() + 1}/${dt.getDate()}</span></div>
        ${list.map((t) => `<div data-sc="toggle" data-id="${t.id}" class="task ${t.done ? "done" : ""}" style="cursor:pointer">${esc(t.title)}</div>`).join("")}
        ${reviews.map((review) => `<div class="task ${review.status === "completed" ? "done" : ""}" data-go="courses" data-course-id="${review.courseId}" data-unit-id="${review.unitId}" data-schedule-id="${review.id}" style="cursor:pointer;border-left-color:var(--good)">${localize("Review", "复习")} ${esc(review.courseTitle || localize("English vocabulary", "英语词汇"))}</div>`).join("")}
        <button class="btn btn-sm" data-sc="addtask" data-date="${ds}" style="width:100%;justify-content:center;margin-top:8px">${ICON("plus")}</button>
      </div>`;
    }).join("")}</div>`;
  }
  // all
  const upcoming = state.tasks.filter((t) => !t.done || t.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const upcomingReviews = state.reviews.filter((review) => review.status !== "completed" || review.dueDate >= today);
  if (!upcoming.length && !upcomingReviews.length) return `<div class="card card-pad muted" style="text-align:center">${localize("No tasks or course reviews yet.", "还没有任务或课程复习。")}</div>`;
  const byDate = {};
  upcoming.forEach((t) => { (byDate[t.due_date] = byDate[t.due_date] || []).push(t); });
  const reviewsByDate = {}; upcomingReviews.forEach((review) => { (reviewsByDate[review.dueDate] = reviewsByDate[review.dueDate] || []).push(review); });
  return [...new Set([...Object.keys(byDate), ...Object.keys(reviewsByDate)])].sort().map((d) => `<div class="sec-h" style="margin-top:14px"><h2 class="serif" style="font-size:15px">${d === today ? TODAY() : d}</h2></div>${(byDate[d] || []).map(taskRow).join("")}${(reviewsByDate[d] || []).map(reviewRow).join("")}`).join("");
}

function render() {
  if (!rootEl) return;
  const st = state.loading ? { wkTotal: 0, wkDone: 0, overdue: 0 } : stats();
  const tabs = [["today", TODAY()], ["week", localize("This week", "本周")], ["all", localize("All", "全部")]];
  rootEl.innerHTML = `<div class="wrap wrap-wide">
    <div class="page-head">
      <div><div class="eyebrow">${localize("Study plan", "学习计划")}</div><h1 class="page-title">${localize("Study plan", "学习计划")}</h1>
        <p class="page-sub">${localize("Regular study tasks and independent Courses review schedules are shown together; only regular tasks use the task points rules.", "普通学习任务与 Courses 独立复习日程合并展示；只有普通任务使用任务积分规则。")}</p></div>
      <div class="row gap-8">
        <button class="btn" data-sc="autoplan">${ICON("sparkles")}<span>${localize("Auto-fill", "智能填充")}</span></button>
        <button class="btn" data-sc="addgoal">${ICON("exam")}<span>${localize("New goal", "新建目标")}</span></button>
        <button class="btn btn-primary" data-sc="addtask">${ICON("plus")}<span>${localize("Add task", "加任务")}</span></button>
      </div>
    </div>

    <div class="grid g-3" style="margin-bottom:18px">
      <div class="stat"><div class="stat-ic">${ICON("check")}</div><div class="stat-n" style="font-size:22px">${st.wkDone}/${st.wkTotal}</div><div class="stat-l">${localize("Done this week", "本周完成")}</div></div>
      <div class="stat"><div class="stat-ic">${ICON("flame")}</div><div class="stat-n" style="font-size:22px">${state.streak}</div><div class="stat-l">${localize("Study streak (days)", "连续学习(天)")}</div></div>
      <div class="stat"><div class="stat-ic">${ICON("clock")}</div><div class="stat-n" style="font-size:22px;${st.overdue ? "color:var(--pink)" : ""}">${st.overdue}</div><div class="stat-l">${localize("Overdue", "逾期")}</div></div>
    </div>

    ${state.reviewError ? `<div role="alert" class="course-feedback wrong" style="margin-bottom:16px">${localize("Course review schedules are temporarily unavailable: ", "课程复习日程暂不可用：")}${esc(state.reviewError)}</div>` : ""}

    ${goalsBar()}
    <div class="tabs">${tabs.map(([k, label]) => `<button class="tab ${state.tab === k ? "active" : ""}" data-sc="settab" data-t="${k}">${label}</button>`).join("")}</div>
    ${body()}
  </div>`;
  wire();
}

function wire() {
  rootEl.querySelectorAll("[data-sc]").forEach((el) => { el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handle(el.dataset.sc, el); }; });
}
function handle(action, el) {
  if (action === "settab") { state.tab = el.dataset.t; render(); }
  else if (action === "toggle") toggleTask(el.dataset.id);
  else if (action === "edit") taskModal(state.tasks.find((t) => t.id === el.dataset.id));
  else if (action === "del") delTask(el.dataset.id);
  else if (action === "addtask") taskModal(null, el.dataset.date);
  else if (action === "addgoal") goalModal();
  else if (action === "delgoal") delGoal(el.dataset.id);
  else if (action === "autoplan") autoplan();
}

async function toggleTask(id) {
  const currentVersion = sessionVersion, client = sb;
  const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const done = !t.done;
  try {
    const { error } = await client.from("study_tasks").update({ done }).eq("id", id);
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    // The same business fingerprint may be an idempotent replay rather than a new reward; the client cannot see the ledger
    // transition, so only confirm the task state here instead of claiming 5 points were definitely added.
    if (done) {
      toastFn(localize("Task completed", "任务已完成"), "check");
      void showPointRewardReceipt(client, "task_completed", id, toastFn,
        () => currentVersion === sessionVersion);
    }
    await load();
    syncShellUser();
  } catch (e) { if (currentVersion === sessionVersion) toastFn(localize("Action failed: ", "操作失败：") + (e.message || "")); }
}

async function delTask(id) {
  const currentVersion = sessionVersion, client = sb;
  try { const { error } = await client.from("study_tasks").delete().eq("id", id); if (error) throw error; if (currentVersion !== sessionVersion) return; toastFn(localize("Deleted", "已删除"), "check"); await load(); }
  catch (e) { if (currentVersion === sessionVersion) toastFn(localize("Delete failed: ", "删除失败：") + (e.message || "")); }
}
async function delGoal(id) {
  const currentVersion = sessionVersion, client = sb;
  try { const { error } = await client.from("study_goals").delete().eq("id", id); if (error) throw error; if (currentVersion !== sessionVersion) return; await load(); }
  catch (e) { if (currentVersion === sessionVersion) toastFn(localize("Delete failed: ", "删除失败：") + (e.message || "")); }
}

function modalShell(inner) {
  const scrim = document.createElement("div"); scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal"><div class="modal-pad">${inner}</div></div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) scrim.remove(); });
  return scrim;
}

function taskModal(existing, presetDate) {
  const isEdit = !!existing;
  const date = (existing && existing.due_date) || presetDate || todayStr();
  const courseOpts = [`<option value=''>${localize("No course", "无课程")}</option>`].concat(state.courses.map((c) => `<option value="${c.id}" ${existing && existing.course_id === c.id ? "selected" : ""}>${esc(c.code || c.name)}</option>`)).join("");
  const scrim = modalShell(`<h2 class="serif" style="font-size:20px;margin-bottom:12px">${isEdit ? localize("Edit task", "编辑任务") : localize("New task", "新任务")}</h2>
    <input id="tk-title" class="search" style="width:100%;background:var(--card-2);margin-bottom:10px" placeholder="${localize("Task, e.g. “Review working memory”", "任务，如「复习工作记忆」")}" value="${esc(existing && existing.title || "")}"/>
    <div class="row gap-8" style="margin-bottom:10px">
      <div class="fill"><div class="eyebrow">${localize("Date", "日期")}</div><input id="tk-date" type="date" class="search" style="width:100%;background:var(--card-2);margin-top:4px" value="${date}"/></div>
      <div class="fill"><div class="eyebrow">${localize("Course", "课程")}</div><select id="tk-course" class="search" style="width:100%;background:var(--card-2);margin-top:4px">${courseOpts}</select></div>
    </div>
    <div class="eyebrow">${localize("Linked material (optional)", "关联资料（可选）")}</div>
    <select id="tk-material" class="search" style="width:100%;background:var(--card-2);margin:4px 0 4px"></select>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-x="cancel">${localize("Cancel", "取消")}</button><button class="btn btn-primary" data-x="save">${isEdit ? localize("Save", "保存") : localize("Add", "添加")}</button></div>`);

  const matSel = scrim.querySelector("#tk-material");
  const drawMats = () => {
    const cid = scrim.querySelector("#tk-course").value;
    const mats = state.materials.filter((m) => !cid || m.course_id === cid);
    matSel.innerHTML = [`<option value=''>${localize("None", "无")}</option>`].concat(mats.map((m) => `<option value="${m.id}" ${existing && existing.material_id === m.id ? "selected" : ""}>${esc(m.name)}</option>`)).join("");
  };
  drawMats();
  scrim.querySelector("#tk-course").onchange = drawMats;
  scrim.querySelector('[data-x="cancel"]').onclick = () => scrim.remove();
  const btn = scrim.querySelector('[data-x="save"]'); let saving = false;
  btn.onclick = async () => {
    if (saving) return;
    const currentVersion = sessionVersion, client = sb;
    const title = scrim.querySelector("#tk-title").value.trim();
    if (!title) { toastFn(localize("Enter a task", "请填写任务")); return; }
    const row = {
      title, due_date: scrim.querySelector("#tk-date").value || todayStr(),
      course_id: scrim.querySelector("#tk-course").value || null,
      material_id: scrim.querySelector("#tk-material").value || null,
    };
    saving = true; btn.disabled = true; btn.textContent = localize("Saving…", "保存中…");
    try {
      if (isEdit) { const { error } = await client.from("study_tasks").update(row).eq("id", existing.id); if (error) throw error; }
      else { const { error } = await client.from("study_tasks").insert(row); if (error) throw error; }
      if (currentVersion !== sessionVersion) return;
      scrim.remove(); toastFn(isEdit ? localize("Saved", "已保存") : localize("Added", "已添加"), "check"); await load();
    } catch (e) { if (currentVersion !== sessionVersion) return; saving = false; btn.disabled = false; btn.textContent = isEdit ? localize("Save", "保存") : localize("Add", "添加"); toastFn(localize("Failed: ", "失败：") + (e.message || "")); }
  };
}

function goalModal() {
  const scrim = modalShell(`<h2 class="serif" style="font-size:20px;margin-bottom:12px">${localize("New goal / exam", "新建目标 / 考试")}</h2>
    <input id="gl-title" class="search" style="width:100%;background:var(--card-2);margin-bottom:10px" placeholder="${localize("e.g. “COGS 210 final”", "如「COGS 210 期末」")}"/>
    <div class="eyebrow">${localize("Date", "日期")}</div><input id="gl-date" type="date" class="search" style="width:100%;background:var(--card-2);margin:4px 0 4px" value="${todayStr()}"/>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-x="cancel">${localize("Cancel", "取消")}</button><button class="btn btn-primary" data-x="save">${localize("Create", "创建")}</button></div>`);
  scrim.querySelector('[data-x="cancel"]').onclick = () => scrim.remove();
  const btn = scrim.querySelector('[data-x="save"]'); let saving = false;
  btn.onclick = async () => {
    if (saving) return;
    const currentVersion = sessionVersion, client = sb;
    const title = scrim.querySelector("#gl-title").value.trim();
    if (!title) { toastFn(localize("Enter a title", "请填写标题")); return; }
    saving = true; btn.disabled = true; btn.textContent = localize("Creating…", "创建中…");
    try { const { error } = await client.from("study_goals").insert({ title, exam_date: scrim.querySelector("#gl-date").value || null }); if (error) throw error; if (currentVersion !== sessionVersion) return; scrim.remove(); toastFn(localize("Created", "已创建"), "check"); await load(); }
    catch (e) { if (currentVersion !== sessionVersion) return; saving = false; btn.disabled = false; btn.textContent = localize("Create", "创建"); toastFn(localize("Failed: ", "失败：") + (e.message || "")); }
  };
}

async function autoplan() {
  const currentVersion = sessionVersion, client = sb;
  if (!state.courses.length) { toastFn(localize("Create a course in Materials before using auto-fill", "先在 Materials 建课程，才能智能填充")); return; }
  toastFn(localize("Creating review tasks…", "生成复习任务中…"));
  try {
    const rows = state.courses.slice(0, 6).map((c, i) => ({ title: localize(`Review ${c.code || c.name}`, `复习 ${c.code || c.name}`), due_date: dstr(addDays(new Date(`${todayStr()}T12:00:00`), i)), course_id: c.id }));
    const { error } = await client.from("study_tasks").insert(rows);
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    toastFn(localize(`${rows.length} review tasks added to this week`, `${rows.length} 个复习任务已加入本周`), "check");
    state.tab = "week"; await load();
  } catch (e) { if (currentVersion === sessionVersion) toastFn(localize("Failed: ", "失败：") + (e.message || "")); }
}
