// @ts-nocheck
// Feedback：提交反馈 + 我的工单列表（真后端，Supabase 直连，RLS）。提交后顺带生成一条通知。
import { ICON } from "./icons";
import { notify } from "./notifications";

let sb = null, USER = null, toastFn = () => {};
let rootEl = null;
const state = { loading: true, error: "", tickets: [], category: "Bug", saving: false };
let sessionVersion = 0;

const CATS = ["Bug", "功能建议", "内容问题", "支付", "创作者支持"];
const STATUS = { open: ["处理中", "warn"], in_progress: ["处理中", "warn"], planned: ["已计划", "info"], resolved: ["已解决", "good"] };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function fmtDate(s) { const d = new Date(s); return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

export function initFeedback(supabase, user, toast) {
  sessionVersion++;
  sb = supabase; USER = user; toastFn = toast || (() => {});
  rootEl = null;
  Object.assign(state, { loading: true, error: "", tickets: [], category: "Bug", saving: false });
}

export function mountFeedback(el) { rootEl = el; if (!rootEl) return; render(); load(); }

async function load() {
  const currentVersion = sessionVersion;
  if (!sb) { state.loading = false; state.error = "未配置 Supabase"; render(); return; }
  state.loading = true; render();
  try {
    const { data, error } = await sb.from("feedback").select("*").order("created_at", { ascending: false });
    if (currentVersion !== sessionVersion) return;
    if (error) throw error;
    state.tickets = data || []; state.error = "";
  } catch (e) { if (currentVersion !== sessionVersion) return; state.error = e.message || "加载失败"; }
  if (currentVersion !== sessionVersion) return;
  state.loading = false; render();
}

function render() {
  if (!rootEl) return;
  rootEl.innerHTML = `<div class="wrap">
    <div class="eyebrow">Support</div><h1 class="page-title">Feedback</h1>
    <p class="page-sub">告诉我们哪里出了问题、或你想要什么功能。提交后可在右侧追踪状态。</p>
    <div class="grid" style="grid-template-columns:1fr 320px;align-items:start;margin-top:22px">
      <div class="card card-pad">
        <h3 class="serif" style="font-size:17px;margin-bottom:14px">提交反馈</h3>
        <div style="font-size:12px;font-weight:600;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">分类</div>
        <div class="row gap-6 wrap-flex" style="margin-bottom:16px">
          ${CATS.map((c) => `<button class="chip ${state.category === c ? "chip-accent" : "chip-outline"}" data-fb="cat" data-c="${esc(c)}">${esc(c)}</button>`).join("")}
        </div>
        <input id="fb-summary" class="search" style="background:var(--card-2);margin-bottom:12px;width:100%" placeholder="一句话概括"/>
        <textarea id="fb-body" class="search" style="background:var(--card-2);width:100%;min-height:120px;align-items:flex-start" placeholder="详细描述：你做了什么、期望什么、实际发生了什么…"></textarea>
        <div class="row between mt-16">
          <span class="faint" style="font-size:12px">提交后会进入「我的反馈」并生成一条通知</span>
          <button class="btn btn-primary" data-fb="submit">提交</button>
        </div>
      </div>
      <div class="card card-pad">
        <h3 class="serif" style="font-size:16px;margin-bottom:12px">我的反馈</h3>
        ${state.loading ? `<div class="muted" style="font-size:13px">加载中…</div>`
          : state.error ? `<div style="color:var(--pink);font-size:13px">出错了：${esc(state.error)}</div>`
          : state.tickets.length === 0 ? `<div class="muted" style="font-size:13px">还没有反馈记录。</div>`
          : state.tickets.map(ticketHtml).join("")}
      </div>
    </div>
  </div>`;
  wire();
}

function ticketHtml(t) {
  const st = STATUS[t.status] || ["处理中", "warn"];
  return `<div style="padding:11px 0;border-bottom:1px solid var(--border-soft)">
    <div class="row between">
      <span class="chip chip-tag">${esc(t.category || "其它")}</span>
      <span class="chip" style="background:color-mix(in srgb,var(--${st[1]}) 16%,var(--card));color:var(--${st[1]})">${esc(st[0])}</span>
    </div>
    <div style="font-size:13px;font-weight:600;margin-top:6px">${esc(t.summary)}</div>
    ${t.body ? `<div class="muted" style="font-size:12px;margin-top:2px">${esc(t.body)}</div>` : ""}
    <div class="faint" style="font-size:11.5px;margin-top:4px">${fmtDate(t.created_at)}</div>
  </div>`;
}

function wire() {
  rootEl.querySelectorAll("[data-fb]").forEach((el) => {
    el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handle(el.dataset.fb, el); };
  });
}

function handle(action, el) {
  if (action === "cat") { state.category = el.dataset.c; render(); }
  else if (action === "submit") submit(el);
}

async function submit(btn) {
  if (state.saving) return;
  const currentVersion = sessionVersion;
  const client = sb;
  const summary = rootEl.querySelector("#fb-summary").value.trim();
  const body = rootEl.querySelector("#fb-body").value.trim();
  if (!summary) { toastFn("请填写一句话概括"); return; }
  state.saving = true;
  btn.disabled = true; btn.textContent = "提交中…";
  try {
    const { error } = await client.from("feedback").insert({ category: state.category, summary, body: body || null });
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    await notify("反馈已收到", summary, "feedback");
    if (currentVersion !== sessionVersion) return;
    toastFn("反馈已提交，谢谢！", "check");
    await load();
  } catch (e) {
    if (currentVersion !== sessionVersion) return;
    state.saving = false;
    toastFn("提交失败：" + (e.message || ""));
    render();
    return;
  }
  state.saving = false;
}
