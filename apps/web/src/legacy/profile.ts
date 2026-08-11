// @ts-nocheck
// Profile：真数据（profiles 表 + 实时计数），可编辑；显示活动积分(points)与分级徽章；同步顶栏/侧栏。
import { ICON } from "./icons";
import { DB } from "./data";
import { apiJson } from "../lib/api";
import { getLocale, localize } from "../i18n";

let sb = null, USER = null, toastFn = () => {};
let rootEl = null;
const EMPTY_LEARNING = { courses: 0, learnedWords: 0, reviewDays: 0, badges: [] };
const state = { loading: true, error: "", learningError: "", quotaError: "", profile: null, counts: { posts: 0, materials: 0, courses: 0, feedback: 0 }, learning: { ...EMPTY_LEARNING }, quota: null };
let sessionVersion = 0;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initialsOf = (s) => String(s || "?").trim().slice(0, 2).toUpperCase();
const TIER_BG = ["", "linear-gradient(135deg,#c9925f,#a97142)", "linear-gradient(135deg,#cdd2d8,#9aa1ab)", "linear-gradient(135deg,#ecc961,#c9a233)"];
const TIER_NAME = ["", "铜", "银", "金"];
const tierOf = (v, th) => th.reduce((t, x) => t + (v >= x ? 1 : 0), 0);
const l = (en, zh) => localize(en, zh, getLocale());

export function initProfile(supabase, user, toast) {
  sessionVersion++;
  sb = supabase; USER = user; toastFn = toast || (() => {});
  rootEl = null;
  Object.assign(state, { loading: true, error: "", learningError: "", quotaError: "", profile: null, counts: { posts: 0, materials: 0, courses: 0, feedback: 0 }, learning: { ...EMPTY_LEARNING }, quota: null });
}
export function mountProfile(el) { rootEl = el; if (!rootEl) return; render(); load(); }

async function fetchProfile() {
  const [p, pc, mc, cc, fc, learning, quota] = await Promise.all([
    sb.from("profiles").select("*").eq("id", USER.id).single(),
    sb.from("posts").select("id", { count: "exact", head: true }).eq("user_id", USER.id).is("repost_of", null),
    sb.from("materials").select("id", { count: "exact", head: true }),
    sb.from("courses").select("id", { count: "exact", head: true }),
    sb.from("feedback").select("id", { count: "exact", head: true }),
    apiJson("/api/profile/learning-summary", {}, true, false)
      .then((data) => ({ data, error: "" }))
      .catch((error) => ({ data: { ...EMPTY_LEARNING }, error: error?.message || "课程学习统计加载失败" })),
    apiJson("/api/profile/ai-quota", {}, true, false)
      .then((data) => data && data.generation && data.grading
        ? ({ data, error: "" })
        : ({ data: null, error: l("AI allowance could not be loaded", "AI 额度加载失败") }))
      .catch((error) => ({ data: null, error: error?.message || l("AI allowance could not be loaded", "AI 额度加载失败") })),
  ]);
  const failed = [p, pc, mc, cc, fc].find((result) => result.error);
  if (failed) throw failed.error;
  return { profile: p.data, counts: { posts: pc.count || 0, materials: mc.count || 0, courses: cc.count || 0, feedback: fc.count || 0 },
    learning: learning.data, learningError: learning.error, quota: quota.data, quotaError: quota.error };
}

async function load() {
  const currentVersion = sessionVersion;
  if (!sb) { state.loading = false; state.error = "未配置 Supabase"; render(); return; }
  state.loading = true; render();
  try { const r = await fetchProfile(); if (currentVersion !== sessionVersion) return; state.profile = r.profile; state.counts = r.counts; state.learning = r.learning; state.learningError = r.learningError; state.quota = r.quota; state.quotaError = r.quotaError; state.error = ""; }
  catch (e) { if (currentVersion !== sessionVersion) return; state.error = e.message || "加载失败"; }
  if (currentVersion !== sessionVersion) return;
  state.loading = false; render();
}

const LEVEL_TH = [50, 150, 350, 700, 1200];
function nextLevelInfo(points) {
  let lo = 0;
  for (const th of LEVEL_TH) { if (points < th) return { next: th, pct: Math.round(((points - lo) / (th - lo)) * 100) }; lo = th; }
  return { next: null, pct: 100 };
}

function render() {
  if (!rootEl) return;
  if (state.loading) { rootEl.innerHTML = `<div class="wrap"><div class="card card-pad muted">加载中…</div></div>`; return; }
  if (state.error || !state.profile) { rootEl.innerHTML = `<div class="wrap"><div class="card card-pad" style="color:var(--pink)">出错了：${esc(state.error || "无资料")}</div></div>`; return; }
  const u = state.profile, c = state.counts, learning = state.learning;
  const points = u.points || 0;
  const vip = u.vip_until && new Date(u.vip_until) > new Date();
  const name = u.username || (u.email || "").split("@")[0] || "用户";
  const ni = nextLevelInfo(points);

  const badges = [
    { name: "发帖手", icon: "✍️", val: c.posts, th: [1, 10, 50], desc: "发布帖子" },
    { name: "创作者", icon: "📚", val: c.materials, th: [1, 10, 30], desc: "上传资料" },
    { name: "学科建课人", icon: "🏗️", val: c.courses, th: [1, 3, 8], desc: "创建 Materials 学科课程" },
    { name: "学者", icon: "🎓", val: points, th: [50, 350, 1200], desc: "累积积分" },
    { name: "反馈者", icon: "💡", val: c.feedback, th: [1, 3, 10], desc: "提交反馈" },
  ];
  const stats = [["notes", "发帖", c.posts], ["folder", "资料", c.materials], ["chart", "学习课程", learning.courses], ["coin", "积分", points]];
  const courseBadges = learning.badges || [];

  rootEl.innerHTML = `<div class="wrap wrap-wide">
    ${state.learningError ? `<div role="alert" class="course-feedback wrong" style="margin-bottom:16px">课程学习统计暂不可用：${esc(state.learningError)}</div>` : ""}
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
          <div class="center"><div class="lvl-ring" style="--p:${ni.pct}">
            <div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Level</div>
              <div style="font-family:var(--font-serif);font-size:30px;font-weight:600">${u.level || 1}</div>
              <div style="font-size:11px;color:var(--accent);font-weight:600">${esc(u.level_name || "Novice")}</div></div></div>
            <div class="faint center" style="font-size:11.5px;margin-top:8px">${ni.next ? `还差 ${ni.next - points} 积分升级` : "已满级"}</div>
          </div>
          <div class="center" style="align-self:center">
            <div class="stat-ic" style="margin:0 auto 8px;width:38px;height:38px">${ICON("coin")}</div>
            <div class="stat-n" style="font-size:30px">${points.toLocaleString()}</div>
            <div class="stat-l">积分 Points</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:24px">
      <div class="row between wrap-flex gap-12"><div><div class="eyebrow">${l("AI plan", "AI 方案")}</div><h2 class="serif" style="font-size:18px">${l("Free Plan", "免费方案")}</h2></div>
        ${state.quota ? `<span class="chip chip-accent">${esc(state.quota.timezone)}</span>` : ""}</div>
      ${state.quotaError ? `<div class="course-feedback wrong" role="alert">${esc(state.quotaError)}</div>` : state.quota ? `<div class="grid g-2 mt-16">
        <div class="stat"><div class="stat-n" style="font-size:24px">${state.quota.generation.remaining}/${state.quota.generation.limit}</div><div class="stat-l">${l("Test paper generations remaining today", "今日剩余试卷生成次数")}</div><div class="faint" style="font-size:11px">${l("Used", "已用")} ${state.quota.generation.consumed} · ${l("Reserved", "已预留")} ${state.quota.generation.reserved}</div></div>
        <div class="stat"><div class="stat-n" style="font-size:24px">${state.quota.grading.remaining}/${state.quota.grading.limit}</div><div class="stat-l">${l("Subjective grading runs remaining today", "今日剩余主观题评分次数")}</div><div class="faint" style="font-size:11px">${l("Used", "已用")} ${state.quota.grading.consumed} · ${l("Reserved", "已预留")} ${state.quota.grading.reserved}</div></div>
      </div><p class="faint" style="font-size:11.5px;margin-top:10px">${l("Resets at", "重置时间")} ${new Date(state.quota.resetsAt).toLocaleString()} · ${l("Only successful generations or grading runs consume allowance. Credits are not used.", "仅成功的生成或评分会消耗额度，不使用 credits。")}</p>` : `<p class="muted">${l("AI allowance is loading…", "AI 额度加载中…")}</p>`}
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start;gap:24px">
      <div>
        <div class="sec-h" style="margin-top:0"><h2 class="serif" style="font-size:18px">你的数据</h2></div>
        <div class="grid g-4">
          ${stats.map(([ic, l, n]) => `<div class="stat"><div class="stat-ic">${ICON(ic)}</div><div class="stat-n" style="font-size:22px">${Number(n).toLocaleString()}</div><div class="stat-l">${l}</div></div>`).join("")}
        </div>
        <div class="card card-pad mt-16">
          <div class="row gap-12"><div class="stat-ic" style="margin:0">${ICON("sparkles")}</div>
            <div class="fill"><div style="font-weight:700;font-size:14px">积分怎么来</div>
              <div class="muted" style="font-size:12.5px">发帖 +10、转发 +3、评论 +2、点赞 +1、普通任务首次有效完成 +5；至少 20 个不同词且 100% 熟练的词表首次 +20。所有奖励按业务键幂等。积分≠钱包 credits。</div></div></div>
        </div>
        <div class="grid g-3 mt-16">
          <div class="stat"><div class="stat-n" style="font-size:22px">${Number(learning.courses || 0).toLocaleString()}</div><div class="stat-l">学习课程数</div></div>
          <div class="stat"><div class="stat-n" style="font-size:22px">${Number(learning.learnedWords || 0).toLocaleString()}</div><div class="stat-l">熟练的不同英文词</div></div>
          <div class="stat"><div class="stat-n" style="font-size:22px">${Number(learning.reviewDays || 0).toLocaleString()}</div><div class="stat-l">不同复习日期</div></div>
        </div>
      </div>
      <div>
        <div class="sec-h" style="margin-top:0"><h2 class="serif" style="font-size:18px">徽章</h2><span class="faint" style="font-size:12.5px">分铜/银/金三级</span></div>
        <div class="grid g-3">
          ${badges.map((b) => {
            const t = tierOf(b.val, b.th);
            const cap = b.th[Math.min(t, b.th.length - 1)];
            const pct = t >= b.th.length ? 100 : Math.min(100, Math.round((b.val / cap) * 100));
            return `<div class="badge-tile ${t ? "" : "locked"}">
              <div class="badge-medal" style="${t ? `background:${TIER_BG[t]};box-shadow:var(--shadow-md)` : ""}">${t ? b.icon : ICON("lock")}</div>
              <div style="font-weight:650;font-size:13px">${b.name}${t ? ` · ${TIER_NAME[t]}` : ""}</div>
              <div class="faint" style="font-size:11px;margin-top:2px">${b.desc} ${b.val}${t >= b.th.length ? " · 满级" : ` / ${cap}`}</div>
              <div class="bar" style="margin-top:6px"><i style="width:${pct}%"></i></div>
            </div>`;
          }).join("")}
        </div>
        <div class="sec-h"><h2 class="serif" style="font-size:18px">课程徽章</h2><span class="faint" style="font-size:12px">由服务端持久发放</span></div>
        ${courseBadges.length ? `<div class="grid g-3">${courseBadges.map((badge) => `<div class="badge-tile">
          <div class="badge-medal" style="background:${TIER_BG[badge.tier]}">${esc(badge.icon)}</div>
          <div style="font-weight:650;font-size:13px">${esc(badge.name)} · ${TIER_NAME[badge.tier]}</div>
          <div class="faint" style="font-size:11px;margin-top:3px">${esc(badge.description)}</div>
          <div class="faint" style="font-size:10.5px;margin-top:5px">获得于 ${new Date(badge.awardedAt).toLocaleDateString()}</div>
        </div>`).join("")}</div>` : `<div class="card card-pad muted">通过拼写与发音考试形成词汇掌握，并保持跨日期复习，可获得课程系列徽章。</div>`}
      </div>
    </div>
  </div>`;
  wire();
}

function wire() {
  rootEl.querySelectorAll("[data-pf]").forEach((el) => { el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (el.dataset.pf === "edit") editModal(); }; });
}

function editModal() {
  const u = state.profile;
  const field = (id, label, val, ph) => `<div class="eyebrow" style="margin-top:10px">${label}</div>
    <input id="${id}" class="search" style="width:100%;background:var(--card-2);margin:6px 0 2px" placeholder="${ph}" value="${esc(val || "")}"/>`;
  const scrim = document.createElement("div"); scrim.className = "scrim";
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
    ${field("pf-timezone", "时区（IANA）", u.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", "如 Asia/Shanghai")}
    <div class="row gap-8" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-ed="cancel">取消</button><button class="btn btn-primary" data-ed="save">保存</button></div>
  </div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector('[data-ed="cancel"]').onclick = close;
  const saveBtn = scrim.querySelector('[data-ed="save"]'); let saving = false;
  saveBtn.onclick = async () => {
    if (saving) return;
    const currentVersion = sessionVersion, client = sb, userId = USER.id;
    const patch = {
      username: scrim.querySelector("#pf-username").value.trim() || null,
      university: scrim.querySelector("#pf-university").value.trim() || null,
      major: scrim.querySelector("#pf-major").value.trim() || null,
      year: scrim.querySelector("#pf-year").value.trim() || null,
      language: scrim.querySelector("#pf-language").value,
      timezone: scrim.querySelector("#pf-timezone").value.trim() || "UTC",
    };
    saving = true; saveBtn.disabled = true; saveBtn.textContent = "保存中…";
    try {
      const { error } = await client.from("profiles").update(patch).eq("id", userId);
      if (error) throw error;
      if (currentVersion !== sessionVersion) return;
      close(); toastFn("已保存", "check"); await load(); syncShellUser();
    } catch (e) {
      if (currentVersion !== sessionVersion) return;
      saving = false; saveBtn.disabled = false; saveBtn.textContent = "保存"; toastFn("保存失败：" + (e.message || ""));
    }
  };
}

export async function syncShellUser() {
  if (!sb) return;
  const currentVersion = sessionVersion, client = sb, userId = USER.id;
  try {
    const { data, error } = await client.from("profiles").select("*").eq("id", userId).single();
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    if (!data) return;
    const name = data.username || (data.email || "").split("@")[0] || "用户";
    DB.user.name = name; DB.user.initials = initialsOf(name);
    DB.user.points = data.points || 0; DB.user.credits = data.credits || 0; DB.user.level = data.level || 1; DB.user.levelName = data.level_name || "Novice";
    const nm = document.querySelector(".uchip-name"); if (nm) nm.textContent = name;
    const sub = document.querySelector(".uchip-sub"); if (sub) sub.textContent = `Lv ${DB.user.level} · ${DB.user.levelName} · ${DB.user.points.toLocaleString()} 积分`;
    document.querySelectorAll(".avatar").forEach((a) => { if (a.dataset.go === "profile" || a.closest(".uchip")) a.textContent = DB.user.initials; });
  } catch (e) { if (currentVersion === sessionVersion) toastFn("资料同步失败：" + (e.message || "")); }
}
