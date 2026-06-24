// @ts-nocheck
// Profile：真数据（profiles 表 + 实时计数），可编辑，并同步顶栏/侧栏用户信息。
import { ICON } from "./icons";
import { DB } from "./data";

let sb = null, USER = null, toastFn = () => {};
let rootEl = null;
const state = { loading: true, error: "", profile: null, counts: { materials: 0, courses: 0, feedback: 0 } };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initialsOf = (name) => String(name || "?").trim().slice(0, 2).toUpperCase();

export function initProfile(supabase, user, toast) { sb = supabase; USER = user; if (toast) toastFn = toast; }

export function mountProfile(el) { rootEl = el; if (!rootEl) return; render(); load(); }

async function fetchProfile() {
  const [p, mc, cc, fc] = await Promise.all([
    sb.from("profiles").select("*").eq("id", USER.id).single(),
    sb.from("materials").select("id", { count: "exact", head: true }),
    sb.from("courses").select("id", { count: "exact", head: true }),
    sb.from("feedback").select("id", { count: "exact", head: true }),
  ]);
  return { profile: p.data, counts: { materials: mc.count || 0, courses: cc.count || 0, feedback: fc.count || 0 } };
}

async function load() {
  if (!sb) { state.loading = false; state.error = "未配置 Supabase"; render(); return; }
  state.loading = true; render();
  try {
    const r = await fetchProfile();
    state.profile = r.profile; state.counts = r.counts; state.error = "";
  } catch (e) { state.error = e.message || "加载失败"; }
  state.loading = false; render();
}

function render() {
  if (!rootEl) return;
  if (state.loading) { rootEl.innerHTML = `<div class="wrap"><div class="card card-pad muted">加载中…</div></div>`; return; }
  if (state.error || !state.profile) {
    rootEl.innerHTML = `<div class="wrap"><div class="card card-pad" style="color:var(--pink)">出错了：${esc(state.error || "无资料")}</div></div>`;
    return;
  }
  const u = state.profile;
  const c = state.counts;
  const vip = u.vip_until && new Date(u.vip_until) > new Date();
  const name = u.username || (u.email || "").split("@")[0] || "用户";
  const badges = [
    { name: "首份资料", icon: "✦", got: c.materials > 0, desc: "上传第一份资料" },
    { name: "建课新手", icon: "❖", got: c.courses > 0, desc: "创建第一个课程" },
    { name: "资料达人", icon: "✸", got: c.materials >= 10, desc: "上传 10 份资料" },
    { name: "反馈者", icon: "✿", got: c.feedback > 0, desc: "提交一次反馈" },
  ];
  const stats = [
    ["folder", "资料", c.materials],
    ["notes", "课程", c.courses],
    ["coin", "积分", u.credits || 0],
  ];

  rootEl.innerHTML = `<div class="wrap wrap-wide">
    <div class="card card-pad" style="background:linear-gradient(120deg,var(--accent-tint),var(--card));border-color:var(--accent-line);margin-bottom:24px">
      <div class="row between wrap-flex gap-20">
        <div class="row gap-16">
          <div class="avatar" style="background:${DB.user.color || "var(--accent)"};width:72px;height:72px;font-size:28px">${esc(initialsOf(name))}</div>
          <div>
            <div class="row gap-8"><h1 class="serif" style="font-size:26px">${esc(name)}</h1>${vip ? `<span class="chip chip-accent">${ICON("crown")} VIP</span>` : ""}</div>
            <p class="muted" style="font-size:13.5px">${esc(u.email || "")}</p>
            <p class="faint" style="font-size:12.5px">${esc([u.university, u.major, u.year].filter(Boolean).join(" · ") || "未填写学校 / 专业")}</p>
            <button class="btn btn-sm mt-8" data-pf="edit">${ICON("edit")}<span>编辑资料</span></button>
          </div>
        </div>
        <div class="row gap-24">
          <div class="center"><div class="lvl-ring" style="--p:0">
            <div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Level</div>
              <div style="font-family:var(--font-serif);font-size:30px;font-weight:600">${u.level || 1}</div>
              <div style="font-size:11px;color:var(--accent);font-weight:600">${esc(u.level_name || "Novice")}</div></div></div>
          </div>
          <div class="center" style="align-self:center">
            <div class="stat-ic" style="margin:0 auto 8px;width:38px;height:38px">${ICON("coin")}</div>
            <div class="stat-n" style="font-size:30px">${(u.credits || 0).toLocaleString()}</div>
            <div class="stat-l">Credits</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start;gap:24px">
      <div>
        <div class="sec-h" style="margin-top:0"><h2 class="serif" style="font-size:18px">你的数据</h2></div>
        <div class="grid g-3">
          ${stats.map(([ic, l, n]) => `<div class="stat"><div class="stat-ic">${ICON(ic)}</div><div class="stat-n" style="font-size:22px">${Number(n).toLocaleString()}</div><div class="stat-l">${l}</div></div>`).join("")}
        </div>
        <div class="card card-pad mt-16">
          <div class="row gap-12"><div class="stat-ic" style="margin:0">${ICON("sparkles")}</div>
            <div class="fill"><div style="font-weight:700;font-size:14px">真实数据</div>
              <div class="muted" style="font-size:12.5px">资料 / 课程为你账号下的实时统计；积分与等级随成长系统开放后增长。</div></div></div>
        </div>
      </div>
      <div>
        <div class="sec-h" style="margin-top:0"><h2 class="serif" style="font-size:18px">徽章</h2><span class="faint" style="font-size:12.5px">${badges.filter((b) => b.got).length}/${badges.length} 已获得</span></div>
        <div class="grid g-3">
          ${badges.map((b) => `<div class="badge-tile ${b.got ? "" : "locked"}">
            <div class="badge-medal">${b.got ? b.icon : ICON("lock")}</div>
            <div style="font-weight:650;font-size:13px">${esc(b.name)}</div>
            <div class="faint" style="font-size:11px;margin-top:2px">${esc(b.desc)}</div></div>`).join("")}
        </div>
      </div>
    </div>
  </div>`;
  wire();
}

function wire() {
  rootEl.querySelectorAll("[data-pf]").forEach((el) => {
    el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (el.dataset.pf === "edit") editModal(); };
  });
}

function editModal() {
  const u = state.profile;
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const field = (id, label, val, ph) => `<div class="eyebrow" style="margin-top:10px">${label}</div>
    <input id="${id}" class="search" style="width:100%;background:var(--card-2);margin:6px 0 2px" placeholder="${ph}" value="${esc(val || "")}"/>`;
  scrim.innerHTML = `<div class="modal"><div class="modal-pad">
    <h2 class="serif" style="font-size:20px;margin-bottom:8px">编辑资料</h2>
    ${field("pf-username", "用户名", u.username, "你的昵称")}
    ${field("pf-university", "学校", u.university, "如 Westlake University")}
    ${field("pf-major", "专业", u.major, "如 Cognitive Science")}
    ${field("pf-year", "年级", u.year, "如 Sophomore")}
    <div class="eyebrow" style="margin-top:10px">界面语言</div>
    <select id="pf-language" class="search" style="width:100%;background:var(--card-2);margin:6px 0 2px">
      <option value="zh" ${u.language === "zh" ? "selected" : ""}>中文</option>
      <option value="en" ${u.language === "en" ? "selected" : ""}>English</option>
    </select>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:18px">
      <button class="btn" data-ed="cancel">取消</button>
      <button class="btn btn-primary" data-ed="save">保存</button>
    </div>
  </div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector('[data-ed="cancel"]').onclick = close;
  const saveBtn = scrim.querySelector('[data-ed="save"]');
  let saving = false;
  saveBtn.onclick = async () => {
    if (saving) return;
    const patch = {
      username: scrim.querySelector("#pf-username").value.trim() || null,
      university: scrim.querySelector("#pf-university").value.trim() || null,
      major: scrim.querySelector("#pf-major").value.trim() || null,
      year: scrim.querySelector("#pf-year").value.trim() || null,
      language: scrim.querySelector("#pf-language").value,
    };
    saving = true; saveBtn.disabled = true; saveBtn.textContent = "保存中…";
    try {
      const { error } = await sb.from("profiles").update(patch).eq("id", USER.id);
      if (error) throw error;
      close(); toastFn("已保存", "check");
      await load();
      syncShellUser();
    } catch (e) {
      saving = false; saveBtn.disabled = false; saveBtn.textContent = "保存";
      toastFn("保存失败：" + (e.message || ""));
    }
  };
}

// 用真实 profile 同步侧栏/顶栏的用户名、等级、积分、首字母
export async function syncShellUser() {
  if (!sb) return;
  try {
    const { data } = await sb.from("profiles").select("*").eq("id", USER.id).single();
    if (!data) return;
    const name = data.username || (data.email || "").split("@")[0] || "用户";
    DB.user.name = name;
    DB.user.initials = initialsOf(name);
    DB.user.credits = data.credits || 0;
    DB.user.level = data.level || 1;
    DB.user.levelName = data.level_name || "Novice";
    const nm = document.querySelector(".uchip-name");
    if (nm) nm.textContent = name;
    const sub = document.querySelector(".uchip-sub");
    if (sub) sub.textContent = `Lv ${DB.user.level} · ${DB.user.levelName} · ${DB.user.credits.toLocaleString()} cr`;
    document.querySelectorAll(".avatar").forEach((a) => { if (a.dataset.go === "profile" || a.closest(".uchip")) a.textContent = DB.user.initials; });
  } catch {}
}
