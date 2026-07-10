// @ts-nocheck
// 学习计划：今天/本周/全部视图，任务增删改 + 完成(加分+streak)，目标倒计时，
// 关联课程/资料(联动 Materials)，从课程一键智能填充复习任务。Supabase 直连 + RLS。
import { ICON } from "./icons";
import { syncShellUser } from "./profile";

let sb = null, USER = null, toastFn = () => {};
let rootEl = null;
const state = { loading: true, error: "", tab: "today", tasks: [], goals: [], courses: [], materials: [], streak: 0 };
let sessionVersion = 0;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => dstr(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const WK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const courseById = (id) => state.courses.find((c) => c.id === id);
const materialById = (id) => state.materials.find((m) => m.id === id);

export function initSchedule(supabase, user, toast) {
  sessionVersion++;
  sb = supabase; USER = user; toastFn = toast || (() => {});
  rootEl = null;
  Object.assign(state, { loading: true, error: "", tab: "today", tasks: [], goals: [], courses: [], materials: [], streak: 0 });
}
export function mountSchedule(el) { rootEl = el; if (!rootEl) return; render(); load(); }

async function load() {
  const currentVersion = sessionVersion;
  if (!sb) { state.loading = false; state.error = "未配置 Supabase"; render(); return; }
  state.loading = true; render();
  try {
    const since = dstr(addDays(new Date(), -14));
    const [t, g, c, m, p] = await Promise.all([
      sb.from("study_tasks").select("*").gte("due_date", since).order("due_date", { ascending: true }),
      sb.from("study_goals").select("*").order("exam_date", { ascending: true }),
      sb.from("courses").select("id,code,name,color").order("created_at", { ascending: true }),
      sb.from("materials").select("id,name,course_id,type").order("created_at", { ascending: false }),
      sb.from("profiles").select("streak").eq("id", USER.id).single(),
    ]);
    if (currentVersion !== sessionVersion) return;
    const failed = [t, g, c, m, p].find((result) => result.error);
    if (failed) throw failed.error;
    state.tasks = t.data || []; state.goals = g.data || []; state.courses = c.data || []; state.materials = m.data || [];
    state.streak = (p.data && p.data.streak) || 0;
    state.error = "";
  } catch (e) { if (currentVersion !== sessionVersion) return; state.error = e.message || "加载失败"; }
  if (currentVersion !== sessionVersion) return;
  state.loading = false; render();
}

function stats() {
  const today = todayStr();
  const wkEnd = dstr(addDays(new Date(), 6));
  const wk = state.tasks.filter((t) => t.due_date >= today && t.due_date <= wkEnd);
  const wkDone = wk.filter((t) => t.done).length;
  const overdue = state.tasks.filter((t) => !t.done && t.due_date < today).length;
  return { wkTotal: wk.length, wkDone, overdue };
}

function goalsBar() {
  if (!state.goals.length) return "";
  const today = new Date(todayStr());
  return `<div class="row gap-8 wrap-flex" style="margin-bottom:16px">${state.goals.map((g) => {
    const d = g.exam_date ? Math.round((new Date(g.exam_date) - today) / 86400000) : null;
    const lbl = d == null ? "无日期" : d > 0 ? `D-${d}` : d === 0 ? "今天" : `已过 ${-d} 天`;
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
        ${overdue ? `<span class="chip" style="background:color-mix(in srgb,var(--pink) 16%,var(--card));color:var(--pink)">逾期</span>` : ""}
      </div>
    </div>
    <button class="icon-btn" data-sc="edit" data-id="${t.id}" style="width:30px;height:30px">${ICON("edit")}</button>
    <button class="icon-btn" data-sc="del" data-id="${t.id}" style="width:30px;height:30px">${ICON("close")}</button>
  </div>`;
}

function body() {
  if (state.loading) return `<div class="card card-pad muted">加载中…</div>`;
  if (state.error) return `<div class="card card-pad" style="color:var(--pink)">出错了：${esc(state.error)}</div>`;
  const today = todayStr();
  if (state.tab === "today") {
    const overdue = state.tasks.filter((t) => !t.done && t.due_date < today);
    const todays = state.tasks.filter((t) => t.due_date === today);
    return `${overdue.length ? `<div class="sec-h" style="margin-top:0"><h2 class="serif" style="font-size:16px;color:var(--pink)">逾期 ${overdue.length}</h2></div>${overdue.map(taskRow).join("")}` : ""}
      <div class="sec-h" style="margin-top:${overdue.length ? 18 : 0}px"><h2 class="serif" style="font-size:16px">今天</h2><button class="btn btn-sm" data-sc="addtask" data-date="${today}">${ICON("plus")}<span>加任务</span></button></div>
      ${todays.length ? todays.map(taskRow).join("") : `<div class="card card-pad muted" style="text-align:center">今天没有任务，享受或加点学习目标。</div>`}`;
  }
  if (state.tab === "week") {
    const days = [];
    for (let i = 0; i < 7; i++) { const d = addDays(new Date(), i); days.push(dstr(d)); }
    return `<div class="grid" style="grid-template-columns:repeat(7,1fr);gap:10px">${days.map((ds, i) => {
      const dt = new Date(ds);
      const list = state.tasks.filter((t) => t.due_date === ds);
      return `<div class="day-col" style="min-height:140px">
        <div class="row between" style="margin-bottom:6px"><b style="font-size:12.5px">${i === 0 ? "今天" : WK[dt.getDay()]}</b><span class="faint" style="font-size:11px">${dt.getMonth() + 1}/${dt.getDate()}</span></div>
        ${list.map((t) => `<div data-sc="toggle" data-id="${t.id}" class="task ${t.done ? "done" : ""}" style="cursor:pointer">${esc(t.title)}</div>`).join("")}
        <button class="btn btn-sm" data-sc="addtask" data-date="${ds}" style="width:100%;justify-content:center;margin-top:8px">${ICON("plus")}</button>
      </div>`;
    }).join("")}</div>`;
  }
  // all
  const upcoming = state.tasks.filter((t) => !t.done || t.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (!upcoming.length) return `<div class="card card-pad muted" style="text-align:center">还没有任务。</div>`;
  const byDate = {};
  upcoming.forEach((t) => { (byDate[t.due_date] = byDate[t.due_date] || []).push(t); });
  return Object.keys(byDate).sort().map((d) => `<div class="sec-h" style="margin-top:14px"><h2 class="serif" style="font-size:15px">${d === today ? "今天" : d}</h2></div>${byDate[d].map(taskRow).join("")}`).join("");
}

function render() {
  if (!rootEl) return;
  const st = state.loading ? { wkTotal: 0, wkDone: 0, overdue: 0 } : stats();
  const tabs = [["today", "今天"], ["week", "本周"], ["all", "全部"]];
  rootEl.innerHTML = `<div class="wrap wrap-wide">
    <div class="page-head">
      <div><div class="eyebrow">Study plan</div><h1 class="page-title">学习计划</h1>
        <p class="page-sub">安排每日任务，关联课程与资料；完成任务积累积分与连续学习天数。</p></div>
      <div class="row gap-8">
        <button class="btn" data-sc="autoplan">${ICON("sparkles")}<span>智能填充</span></button>
        <button class="btn" data-sc="addgoal">${ICON("exam")}<span>新建目标</span></button>
        <button class="btn btn-primary" data-sc="addtask">${ICON("plus")}<span>加任务</span></button>
      </div>
    </div>

    <div class="grid g-3" style="margin-bottom:18px">
      <div class="stat"><div class="stat-ic">${ICON("check")}</div><div class="stat-n" style="font-size:22px">${st.wkDone}/${st.wkTotal}</div><div class="stat-l">本周完成</div></div>
      <div class="stat"><div class="stat-ic">${ICON("flame")}</div><div class="stat-n" style="font-size:22px">${state.streak}</div><div class="stat-l">连续学习(天)</div></div>
      <div class="stat"><div class="stat-ic">${ICON("clock")}</div><div class="stat-n" style="font-size:22px;${st.overdue ? "color:var(--pink)" : ""}">${st.overdue}</div><div class="stat-l">逾期</div></div>
    </div>

    ${goalsBar()}
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${state.tab === k ? "active" : ""}" data-sc="settab" data-t="${k}">${l}</button>`).join("")}</div>
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
    const { error } = await client.from("study_tasks").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", id);
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    // 相同业务指纹可能是幂等恢复而非新奖励；客户端拿不到账本 transition，
    // 因此这里只确认任务状态，不虚报本次一定增加了 5 points。
    if (done) toastFn("任务已完成", "check");
    await load();
    syncShellUser();
  } catch (e) { if (currentVersion === sessionVersion) toastFn("操作失败：" + (e.message || "")); }
}

async function delTask(id) {
  const currentVersion = sessionVersion, client = sb;
  try { const { error } = await client.from("study_tasks").delete().eq("id", id); if (error) throw error; if (currentVersion !== sessionVersion) return; toastFn("已删除", "check"); await load(); }
  catch (e) { if (currentVersion === sessionVersion) toastFn("删除失败：" + (e.message || "")); }
}
async function delGoal(id) {
  const currentVersion = sessionVersion, client = sb;
  try { const { error } = await client.from("study_goals").delete().eq("id", id); if (error) throw error; if (currentVersion !== sessionVersion) return; await load(); }
  catch (e) { if (currentVersion === sessionVersion) toastFn("删除失败：" + (e.message || "")); }
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
  const courseOpts = ["<option value=''>无课程</option>"].concat(state.courses.map((c) => `<option value="${c.id}" ${existing && existing.course_id === c.id ? "selected" : ""}>${esc(c.code || c.name)}</option>`)).join("");
  const scrim = modalShell(`<h2 class="serif" style="font-size:20px;margin-bottom:12px">${isEdit ? "编辑任务" : "新任务"}</h2>
    <input id="tk-title" class="search" style="width:100%;background:var(--card-2);margin-bottom:10px" placeholder="任务，如「复习工作记忆」" value="${esc(existing && existing.title || "")}"/>
    <div class="row gap-8" style="margin-bottom:10px">
      <div class="fill"><div class="eyebrow">日期</div><input id="tk-date" type="date" class="search" style="width:100%;background:var(--card-2);margin-top:4px" value="${date}"/></div>
      <div class="fill"><div class="eyebrow">课程</div><select id="tk-course" class="search" style="width:100%;background:var(--card-2);margin-top:4px">${courseOpts}</select></div>
    </div>
    <div class="eyebrow">关联资料（可选）</div>
    <select id="tk-material" class="search" style="width:100%;background:var(--card-2);margin:4px 0 4px"></select>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-x="cancel">取消</button><button class="btn btn-primary" data-x="save">${isEdit ? "保存" : "添加"}</button></div>`);

  const matSel = scrim.querySelector("#tk-material");
  const drawMats = () => {
    const cid = scrim.querySelector("#tk-course").value;
    const mats = state.materials.filter((m) => !cid || m.course_id === cid);
    matSel.innerHTML = ["<option value=''>无</option>"].concat(mats.map((m) => `<option value="${m.id}" ${existing && existing.material_id === m.id ? "selected" : ""}>${esc(m.name)}</option>`)).join("");
  };
  drawMats();
  scrim.querySelector("#tk-course").onchange = drawMats;
  scrim.querySelector('[data-x="cancel"]').onclick = () => scrim.remove();
  const btn = scrim.querySelector('[data-x="save"]'); let saving = false;
  btn.onclick = async () => {
    if (saving) return;
    const currentVersion = sessionVersion, client = sb;
    const title = scrim.querySelector("#tk-title").value.trim();
    if (!title) { toastFn("请填写任务"); return; }
    const row = {
      title, due_date: scrim.querySelector("#tk-date").value || todayStr(),
      course_id: scrim.querySelector("#tk-course").value || null,
      material_id: scrim.querySelector("#tk-material").value || null,
    };
    saving = true; btn.disabled = true; btn.textContent = "保存中…";
    try {
      if (isEdit) { const { error } = await client.from("study_tasks").update(row).eq("id", existing.id); if (error) throw error; }
      else { const { error } = await client.from("study_tasks").insert(row); if (error) throw error; }
      if (currentVersion !== sessionVersion) return;
      scrim.remove(); toastFn(isEdit ? "已保存" : "已添加", "check"); await load();
    } catch (e) { if (currentVersion !== sessionVersion) return; saving = false; btn.disabled = false; btn.textContent = isEdit ? "保存" : "添加"; toastFn("失败：" + (e.message || "")); }
  };
}

function goalModal() {
  const scrim = modalShell(`<h2 class="serif" style="font-size:20px;margin-bottom:12px">新建目标 / 考试</h2>
    <input id="gl-title" class="search" style="width:100%;background:var(--card-2);margin-bottom:10px" placeholder="如「COGS 210 期末」"/>
    <div class="eyebrow">日期</div><input id="gl-date" type="date" class="search" style="width:100%;background:var(--card-2);margin:4px 0 4px" value="${todayStr()}"/>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-x="cancel">取消</button><button class="btn btn-primary" data-x="save">创建</button></div>`);
  scrim.querySelector('[data-x="cancel"]').onclick = () => scrim.remove();
  const btn = scrim.querySelector('[data-x="save"]'); let saving = false;
  btn.onclick = async () => {
    if (saving) return;
    const currentVersion = sessionVersion, client = sb;
    const title = scrim.querySelector("#gl-title").value.trim();
    if (!title) { toastFn("请填写标题"); return; }
    saving = true; btn.disabled = true; btn.textContent = "创建中…";
    try { const { error } = await client.from("study_goals").insert({ title, exam_date: scrim.querySelector("#gl-date").value || null }); if (error) throw error; if (currentVersion !== sessionVersion) return; scrim.remove(); toastFn("已创建", "check"); await load(); }
    catch (e) { if (currentVersion !== sessionVersion) return; saving = false; btn.disabled = false; btn.textContent = "创建"; toastFn("失败：" + (e.message || "")); }
  };
}

async function autoplan() {
  const currentVersion = sessionVersion, client = sb;
  if (!state.courses.length) { toastFn("先在 Materials 建课程，才能智能填充"); return; }
  toastFn("生成复习任务中…");
  try {
    const rows = state.courses.slice(0, 6).map((c, i) => ({ title: `复习 ${c.code || c.name}`, due_date: dstr(addDays(new Date(), i)), course_id: c.id }));
    const { error } = await client.from("study_tasks").insert(rows);
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    toastFn(rows.length + " 个复习任务已加入本周", "check");
    state.tab = "week"; await load();
  } catch (e) { if (currentVersion === sessionVersion) toastFn("失败：" + (e.message || "")); }
}
