// @ts-nocheck
// 通知：顶栏铃铛点击弹出面板（真后端，Supabase 直连）。未读角标、标记已读、全部已读、空态。
import { ICON } from "./icons";

let sb = null, USER = null, toastFn = () => {};
let items = [];
let sessionVersion = 0;

export function initNotifications(supabase, user, toast) {
  sessionVersion++;
  sb = supabase; USER = user; toastFn = toast || (() => {});
  items = [];
  document.getElementById("notif-pop")?.remove();
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function timeAgo(s) {
  const d = new Date(s), m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60); if (h < 24) return h + " 小时前";
  const days = Math.floor(h / 24); if (days < 7) return days + " 天前";
  return d.toLocaleDateString();
}

export async function refreshNotifBadge() {
  const currentVersion = sessionVersion, client = sb;
  const el = document.getElementById("notif-badge");
  if (!el || !sb) return;
  try {
    const { count, error } = await client.from("notifications").select("id", { count: "exact", head: true }).eq("read", false);
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    if (count > 0) { el.textContent = count > 99 ? "99+" : String(count); el.style.display = ""; }
    else el.style.display = "none";
  } catch (e) {
    if (currentVersion !== sessionVersion) return;
    el.style.display = "none";
    toastFn("通知状态加载失败：" + (e.message || ""));
  }
}

export async function openNotifications() {
  const currentVersion = sessionVersion, client = sb;
  const existing = document.getElementById("notif-pop");
  if (existing) { existing.remove(); return; } // 再点收起

  const pop = document.createElement("div");
  pop.id = "notif-pop";
  pop.innerHTML = `
    <div id="notif-backdrop" style="position:fixed;inset:0;z-index:70"></div>
    <div style="position:fixed;top:56px;right:22px;width:360px;max-width:92vw;max-height:70vh;display:flex;flex-direction:column;
       background:var(--card);border:1px solid var(--border-strong);border-radius:14px;box-shadow:var(--shadow-lg);z-index:71;overflow:hidden">
      <div class="row between" style="padding:12px 14px;border-bottom:1px solid var(--border)">
        <b style="font-size:14px">通知</b>
        <button class="btn btn-sm" data-nt="readall">全部已读</button>
      </div>
      <div id="notif-list" style="overflow:auto"></div>
    </div>`;
  document.body.appendChild(pop);
  const listEl = pop.querySelector("#notif-list");
  pop.querySelector("#notif-backdrop").onclick = () => pop.remove();
  pop.querySelector('[data-nt="readall"]').onclick = async () => {
    try {
      const { error } = await client.from("notifications").update({ read: true }).eq("read", false);
      if (error) throw error;
      if (currentVersion !== sessionVersion) return;
      await reload(); refreshNotifBadge();
    } catch (e) { if (currentVersion === sessionVersion) toastFn("标记已读失败：" + (e.message || "")); }
  };

  async function reload() {
    listEl.innerHTML = `<div class="muted" style="padding:28px;text-align:center;font-size:13px">加载中…</div>`;
    try {
      const { data, error } = await client.from("notifications").select("*").order("created_at", { ascending: false }).limit(40);
      if (error) throw error;
      if (currentVersion !== sessionVersion) { pop.remove(); return; }
      items = data || [];
      draw();
    } catch (e) {
      if (currentVersion !== sessionVersion) return;
      listEl.innerHTML = `<div class="muted" style="padding:28px;text-align:center;font-size:13px">加载失败：${esc(e.message || "")}</div>`;
    }
  }
  function draw() {
    if (!items.length) {
      listEl.innerHTML = `<div class="muted" style="padding:42px 20px;text-align:center">
        <div style="opacity:.45;font-size:22px;margin-bottom:6px">${ICON("bell")}</div>
        <div style="font-size:13px">暂无通知</div></div>`;
      return;
    }
    listEl.innerHTML = items.map((n) => `
      <div class="notif-item" data-id="${n.id}" style="display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border-soft);cursor:pointer;${n.read ? "" : "background:var(--accent-tint)"}">
        <span style="width:7px;height:7px;border-radius:50%;margin-top:6px;flex:none;background:${n.read ? "transparent" : "var(--accent)"}"></span>
        <div class="fill" style="min-width:0">
          <div style="font-weight:650;font-size:13px">${esc(n.title)}</div>
          ${n.body ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${esc(n.body)}</div>` : ""}
          <div class="faint" style="font-size:11.5px;margin-top:3px">${timeAgo(n.created_at)}</div>
        </div>
      </div>`).join("");
    listEl.querySelectorAll(".notif-item").forEach((el) => {
      el.onclick = async () => {
        const n = items.find((x) => x.id === el.dataset.id);
        if (n && !n.read) {
          try {
            const { error } = await client.from("notifications").update({ read: true }).eq("id", n.id);
            if (error) throw error;
            if (currentVersion !== sessionVersion) return;
            n.read = true; draw(); refreshNotifBadge();
          } catch (e) { if (currentVersion === sessionVersion) toastFn("标记已读失败：" + (e.message || "")); }
        }
      };
    });
  }
  reload();
}

// 供其它模块产生通知（如提交反馈后）
export async function notify(title, body, type) {
  const currentVersion = sessionVersion, client = sb;
  if (!sb) return false;
  try {
    const { error } = await client.from("notifications").insert({ title, body: body || null, type: type || null });
    if (error) throw error;
    if (currentVersion !== sessionVersion) return false;
    refreshNotifBadge();
    return true;
  } catch (e) {
    if (currentVersion !== sessionVersion) return false;
    toastFn("通知写入失败：" + (e.message || ""));
    return false;
  }
}
