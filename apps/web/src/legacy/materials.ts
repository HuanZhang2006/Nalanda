// @ts-nocheck
// 真后端的 Materials 模块：课程 + 资料的增删改查 + 文件上传 + 软件内多格式预览（Supabase 直连，RLS 保护）。
// 渲染进 legacy 应用提供的 #mat-root 容器，自管状态与事件。
import { ICON } from "./icons";
import { marked } from "marked";

let sb = null;
let USER = null;
let toastFn = (_m) => {};

const state = { loading: true, error: "", courses: [], materials: [], course: "all" };
let rootEl = null;
let fileInput = null;
let uploading = false;
let sessionVersion = 0;

const FT = { pdf: "pdf", ppt: "ppt", pptx: "ppt", doc: "doc", docx: "doc", md: "md", markdown: "md", html: "html", htm: "html", txt: "txt" };
const IMG = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
const TEXTY = ["txt", "csv", "json", "log", "xml", "yml", "yaml", "tex"];
const OFFICE = ["ppt", "pptx", "doc", "docx", "xls", "xlsx"];

const extOf = (n) => (n.split(".").pop() || "bin").toLowerCase();
const typeOf = (n) => FT[extOf(n)] || "txt";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function fmtSize(b) {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB"]; let i = 0, n = b;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + u[i];
}
function fmtDate(s) {
  const d = new Date(s); const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return days + " days ago";
  return d.toLocaleDateString();
}
function previewKind(ext) {
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (IMG.includes(ext)) return "image";
  if (ext === "html" || ext === "htm") return "html";
  if (TEXTY.includes(ext)) return "text";
  if (OFFICE.includes(ext)) return "office";
  return "unsupported";
}

export function initMaterials(supabase, user, toast) {
  sessionVersion++;
  sb = supabase; USER = user; toastFn = toast || (() => {});
  Object.assign(state, { loading: true, error: "", courses: [], materials: [], course: "all" });
  rootEl = null;
  uploading = false;
  if (fileInput) fileInput.remove();
  fileInput = null;
}

export function mountMaterials(el) {
  rootEl = el; if (!rootEl) return;
  render();
  load();
}

async function load() {
  const currentVersion = sessionVersion;
  if (!sb) { state.loading = false; state.error = "未配置 Supabase"; render(); return; }
  state.loading = true; render();
  try {
    const [c, m] = await Promise.all([
      sb.from("courses").select("*").order("created_at", { ascending: true }),
      sb.from("materials").select("*").order("created_at", { ascending: false }),
    ]);
    if (currentVersion !== sessionVersion) return;
    if (c.error) throw c.error;
    if (m.error) throw m.error;
    state.courses = c.data || [];
    state.materials = m.data || [];
    if (state.course !== "all" && !state.courses.some((x) => x.id === state.course)) state.course = "all";
    state.error = "";
  } catch (e) {
    if (currentVersion !== sessionVersion) return;
    state.error = e.message || "加载失败（数据库迁移已应用了吗？）";
  }
  if (currentVersion !== sessionVersion) return;
  state.loading = false; render();
}

const courseById = (id) => state.courses.find((c) => c.id === id);

/* ---------- 应用内确认弹窗（替代浏览器原生 confirm） ---------- */
function confirmDialog({ title, message, confirmText = "删除", danger = true }) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `<div class="modal"><div class="modal-pad">
      <h2 class="serif" style="font-size:19px;margin-bottom:10px">${esc(title)}</h2>
      <p class="muted" style="font-size:13.5px;line-height:1.55;margin-bottom:20px">${esc(message)}</p>
      <div class="row gap-8" style="justify-content:flex-end">
        <button class="btn" data-cf="no">取消</button>
        <button class="btn ${danger ? "" : "btn-primary"}" data-cf="yes"
          style="${danger ? "background:var(--pink);color:#fff;border-color:transparent" : ""}">${esc(confirmText)}</button>
      </div>
    </div></div>`;
    document.body.appendChild(scrim);
    const done = (v) => { scrim.remove(); resolve(v); };
    scrim.addEventListener("click", (e) => { if (e.target === scrim) done(false); });
    scrim.querySelector('[data-cf="no"]').onclick = () => done(false);
    scrim.querySelector('[data-cf="yes"]').onclick = () => done(true);
  });
}

function render() {
  if (!rootEl) return;
  const cur = state.course;
  const sel = cur !== "all" ? courseById(cur) : null;
  const list = cur === "all" ? state.materials : state.materials.filter((m) => m.course_id === cur);
  const chips = [["all", "All courses"]].concat(state.courses.map((c) => [c.id, c.code || c.name]));

  rootEl.innerHTML = `<div class="wrap">
    <div class="page-head">
      <div><div class="eyebrow">Course library</div><h1 class="page-title">Materials</h1>
        <p class="page-sub">上传、整理、预览学习资料；每份归属一个课程，作为 AI 笔记的输入。</p></div>
      <div class="row gap-8">
        <button class="btn" data-mat="newCourse">${ICON("plus")}<span>新建课程</span></button>
        <button class="btn btn-primary" data-mat="upload">${ICON("upload")}<span>上传资料</span></button>
      </div>
    </div>

    <div class="row gap-8 wrap-flex" style="margin-bottom:14px">
      ${chips.map(([id, l]) => `<button class="chip ${cur === id ? "chip-accent" : "chip-outline"}" data-mat="setCourse" data-c="${esc(id)}">${esc(l)}</button>`).join("")}
    </div>

    ${sel ? `<div class="row gap-8" style="margin-bottom:16px;font-size:12.5px;color:var(--ink-soft)">
        <span>当前课程：<b>${esc(sel.name)}</b>${sel.code ? ` · ${esc(sel.code)}` : ""}</span>
        <button class="btn btn-sm" data-mat="editCourse" data-id="${sel.id}">${ICON("edit")}<span>重命名</span></button>
        <button class="btn btn-sm" data-mat="deleteCourse" data-id="${sel.id}">${ICON("close")}<span>删除课程</span></button>
      </div>` : ""}

    ${state.error ? `<div class="card card-pad" style="color:var(--pink)">出错了：${esc(state.error)}</div>` : ""}

    ${state.loading
      ? `<div class="card card-pad muted row gap-8"><span class="spin"></span>加载中…</div>`
      : state.courses.length === 0
        ? emptyNoCourse()
        : `<div class="card card-pad" style="padding:10px">
            <div class="mat-row" style="border:0;color:var(--ink-faint);font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">
              <span style="width:40px">Type</span><span>Name</span><span class="nowrap">Course</span><span>Actions</span>
            </div>
            ${list.length === 0
              ? `<div class="muted" style="padding:18px 14px">该范围暂无资料，点「上传资料」添加。</div>`
              : list.map(rowHtml).join("")}
          </div>
          <div class="card card-pad hoverable mt-16" id="mat-drop" data-mat="upload" style="cursor:pointer;border-style:dashed;text-align:center;color:var(--ink-faint)">
            <div class="stat-ic" style="margin:0 auto 8px">${ICON("upload")}</div>
            <div style="font-weight:600;color:var(--ink-soft)">拖拽文件到此或点击上传</div>
            <div style="font-size:12px">PDF · PPT · Word · Markdown · HTML · TXT${cur === "all" ? "（先选择一个课程）" : ""}</div>
          </div>`}
  </div>
  <style>
    .spin{width:15px;height:15px;border-radius:50%;border:2px solid var(--border-strong);border-top-color:var(--accent);display:inline-block;animation:matspin .7s linear infinite}
    @keyframes matspin{to{transform:rotate(360deg)}}
  </style>`;

  wire();
}

function emptyNoCourse() {
  return `<div class="card card-pad center" style="padding:40px">
    <div class="stat-ic" style="margin:0 auto 12px">${ICON("folder")}</div>
    <h3 class="serif" style="font-size:18px;margin-bottom:6px">还没有课程</h3>
    <p class="muted" style="margin-bottom:16px">先创建一个课程，再往里上传资料。</p>
    <button class="btn btn-primary" data-mat="newCourse" style="margin:0 auto">${ICON("plus")}<span>新建课程</span></button>
  </div>`;
}

function rowHtml(m) {
  const c = courseById(m.course_id) || {};
  const t = m.type || "txt";
  return `<div class="mat-row">
    <div class="mat-ic">${ICON("file")}<span class="ftype ft-${t}" style="position:absolute;bottom:-7px">${esc((t || "").toUpperCase())}</span></div>
    <div class="fill"><div style="font-weight:650;font-size:13.5px">${esc(m.name)}</div>
      <div class="faint" style="font-size:12px">${fmtSize(m.size_bytes)} · ${fmtDate(m.created_at)}</div></div>
    <span class="chip chip-outline nowrap" style="border-color:${(c.color || "#9c6a39")}55;color:${c.color || "#9c6a39"}">${esc(c.code || c.name || "—")}</span>
    <div class="row gap-6">
      <button class="icon-btn" data-mat="preview" data-id="${m.id}" title="预览" style="width:32px;height:32px">${ICON("eye")}</button>
      <button class="icon-btn" data-mat="download" data-id="${m.id}" title="下载" style="width:32px;height:32px">${ICON("download")}</button>
      <button class="icon-btn" data-mat="delete" data-id="${m.id}" title="删除" style="width:32px;height:32px">${ICON("close")}</button>
    </div>
  </div>`;
}

function wire() {
  rootEl.querySelectorAll("[data-mat]").forEach((el) => {
    el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handle(el.dataset.mat, el); };
  });
  const dz = rootEl.querySelector("#mat-drop");
  if (dz) {
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.style.borderColor = "var(--accent)"; });
    dz.addEventListener("dragleave", () => { dz.style.borderColor = ""; });
    dz.addEventListener("drop", (e) => {
      e.preventDefault(); dz.style.borderColor = "";
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
      if (files.length) doUpload(files);
    });
  }
}

function handle(action, el) {
  if (action === "setCourse") { state.course = el.dataset.c; render(); }
  else if (action === "newCourse") courseModal(null);
  else if (action === "editCourse") courseModal(courseById(el.dataset.id));
  else if (action === "deleteCourse") deleteCourse(el.dataset.id);
  else if (action === "upload") pickFiles();
  else if (action === "preview") previewMaterial(el.dataset.id);
  else if (action === "download") downloadMaterial(el.dataset.id);
  else if (action === "delete") delMaterial(el.dataset.id);
}

/* ---------- 课程：新建 / 重命名（带加载态 + 防重复提交） ---------- */
function courseModal(existing) {
  const isEdit = !!existing;
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal"><div class="modal-pad">
    <h2 class="serif" style="font-size:20px;margin-bottom:14px">${isEdit ? "重命名课程" : "新建课程"}</h2>
    <div class="eyebrow">课程代码（可选）</div>
    <input id="nc-code" class="search" style="width:100%;background:var(--card-2);margin:6px 0 12px" placeholder="如 COGS 210" value="${esc(existing && existing.code || "")}"/>
    <div class="eyebrow">课程名称</div>
    <input id="nc-name" class="search" style="width:100%;background:var(--card-2);margin:6px 0 4px" placeholder="如 Foundations of Cognition" value="${esc(existing && existing.name || "")}"/>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn" data-nc="cancel">取消</button>
      <button class="btn btn-primary" data-nc="save">${isEdit ? "保存" : "创建"}</button>
    </div>
  </div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  const saveBtn = scrim.querySelector('[data-nc="save"]');
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector('[data-nc="cancel"]').onclick = close;

  let saving = false;
  saveBtn.onclick = async () => {
    if (saving) return; // 防重复点击 → 防止建出两个同名课程
    const currentVersion = sessionVersion, client = sb;
    const code = scrim.querySelector("#nc-code").value.trim();
    const name = scrim.querySelector("#nc-name").value.trim() || code;
    if (!name) { toastFn("请填写课程名称"); return; }
    saving = true;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spin"></span><span>${isEdit ? "保存中…" : "创建中…"}</span>`;
    try {
      if (isEdit) {
        const { error } = await client.from("courses").update({ code, name }).eq("id", existing.id);
        if (error) throw error;
        if (currentVersion !== sessionVersion) return;
        close(); toastFn("已保存", "check"); await load();
      } else {
        const { data, error } = await client.from("courses").insert({ code, name }).select().single();
        if (error) throw error;
        if (currentVersion !== sessionVersion) return;
        close(); toastFn("课程已创建", "check");
        await load();
        if (data) { state.course = data.id; render(); }
      }
    } catch (e) {
      if (currentVersion !== sessionVersion) return;
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? "保存" : "创建";
      toastFn((isEdit ? "保存" : "创建") + "失败：" + (e.message || ""));
    }
  };
}

async function deleteCourse(id) {
  const currentVersion = sessionVersion, client = sb;
  const c = courseById(id); if (!c) return;
  const mats = state.materials.filter((m) => m.course_id === id);
  const okToGo = await confirmDialog({
    title: "删除课程",
    message: `将删除课程「${c.code || c.name}」及其下 ${mats.length} 份资料，且不可撤销。`,
    confirmText: "删除课程",
  });
  if (currentVersion !== sessionVersion) return;
  if (!okToGo) return;
  toastFn("删除中…");
  try {
    const paths = mats.map((m) => m.storage_path).filter(Boolean);
    if (paths.length) {
      const { error } = await client.storage.from("materials").remove(paths); // 先删存储文件（级联只删表行）
      if (error) throw error;
    }
    const { error } = await client.from("courses").delete().eq("id", id);
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    if (state.course === id) state.course = "all";
    toastFn("课程已删除", "check");
  } catch (e) {
    if (currentVersion !== sessionVersion) return;
    toastFn("删除失败：" + (e.message || ""));
  }
  await load();
}

/* ---------- 上传 ---------- */
function pickFiles() {
  if (state.courses.length === 0) { toastFn("先新建一个课程", "folder"); courseModal(null); return; }
  if (state.course === "all") { toastFn("请先在上方选择一个课程再上传"); return; }
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.multiple = true; fileInput.style.display = "none";
    document.body.appendChild(fileInput);
    fileInput.addEventListener("change", () => {
      const f = [...(fileInput.files || [])]; fileInput.value = "";
      if (f.length) doUpload(f);
    });
  }
  fileInput.click();
}

async function doUpload(files) {
  const currentVersion = sessionVersion, client = sb, userId = USER.id;
  const course = state.course;
  if (course === "all") { toastFn("请先选择课程"); return; }
  if (uploading) return;
  uploading = true;
  toastFn(`上传中… (0/${files.length})`, "upload");
  let ok = 0;
  for (const f of files) {
    try {
      const path = `${userId}/${crypto.randomUUID()}.${extOf(f.name)}`;
      const up = await client.storage.from("materials").upload(path, f, { upsert: false, contentType: f.type || undefined });
      if (up.error) throw up.error;
      if (currentVersion !== sessionVersion) return;
      const ins = await client.from("materials").insert({ course_id: course, name: f.name, type: typeOf(f.name), size_bytes: f.size, storage_path: path });
      if (ins.error) {
        const cleanup = await client.storage.from("materials").remove([path]);
        if (cleanup.error) console.error("Failed to clean up orphaned material upload", cleanup.error);
        throw ins.error;
      }
      if (currentVersion !== sessionVersion) return;
      ok++;
      toastFn(`上传中… (${ok}/${files.length})`, "upload");
    } catch (e) {
      if (currentVersion !== sessionVersion) return;
      toastFn("上传失败：" + (e.message || f.name));
    }
  }
  uploading = false;
  if (ok) toastFn(ok + " 个文件已上传", "check");
  await load();
}

async function delMaterial(id) {
  const currentVersion = sessionVersion, client = sb;
  const m = state.materials.find((x) => x.id === id); if (!m) return;
  const okToGo = await confirmDialog({ title: "删除资料", message: `删除「${m.name}」？此操作不可撤销。`, confirmText: "删除" });
  if (currentVersion !== sessionVersion) return;
  if (!okToGo) return;
  try {
    const storage = await client.storage.from("materials").remove([m.storage_path]);
    if (storage.error) throw storage.error;
    const { error } = await client.from("materials").delete().eq("id", id);
    if (error) throw error;
    if (currentVersion !== sessionVersion) return;
    toastFn("已删除", "check");
  } catch (e) {
    if (currentVersion !== sessionVersion) return;
    toastFn("删除失败：" + (e.message || ""));
  }
  await load();
}

/* ---------- 下载（不跳新页，触发浏览器下载） ---------- */
async function downloadMaterial(id) {
  const currentVersion = sessionVersion, client = sb;
  const m = state.materials.find((x) => x.id === id); if (!m) return;
  const { data, error } = await client.storage.from("materials").createSignedUrl(m.storage_path, 120, { download: m.name });
  if (currentVersion !== sessionVersion) return;
  if (error || !data) { toastFn("无法获取文件链接"); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl; a.download = m.name; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- 软件内预览（多格式） ---------- */
async function previewMaterial(id) {
  const currentVersion = sessionVersion, client = sb;
  const m = state.materials.find((x) => x.id === id); if (!m) return;
  const ext = extOf(m.name);
  const kind = previewKind(ext);
  const { data, error } = await client.storage.from("materials").createSignedUrl(m.storage_path, 600); // 10 分钟
  if (currentVersion !== sessionVersion) return;
  if (error || !data) { toastFn("无法获取文件链接"); return; }
  const url = data.signedUrl;

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div style="width:92vw;height:90vh;max-width:1100px;background:var(--card);border:1px solid var(--border-strong);border-radius:16px;box-shadow:var(--shadow-lg);display:flex;flex-direction:column;overflow:hidden">
    <div class="row between" style="padding:12px 16px;border-bottom:1px solid var(--border);gap:12px">
      <div class="row gap-8" style="min-width:0">
        <span class="ftype ft-${m.type || "txt"}">${esc(ext.toUpperCase())}</span>
        <b style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.name)}</b>
      </div>
      <div class="row gap-8">
        <span id="pv-tools" class="row gap-8"></span>
        <button class="btn btn-sm" data-pv="download">${ICON("download")}<span>下载</span></button>
        <button class="icon-btn" data-pv="close">${ICON("close")}</button>
      </div>
    </div>
    <div id="pv-body" style="flex:1;min-height:0;background:var(--bg);position:relative"></div>
  </div>`;
  document.body.appendChild(scrim);
  const close = () => { scrim.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector('[data-pv="close"]').onclick = close;
  scrim.querySelector('[data-pv="download"]').onclick = () => downloadMaterial(id);
  document.addEventListener("keydown", onKey);

  const body = scrim.querySelector("#pv-body");
  const tools = scrim.querySelector("#pv-tools");
  const fill = "position:absolute;inset:0;width:100%;height:100%;border:0";
  const center = "position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:24px;color:var(--ink-soft)";
  const preStyle = "position:absolute;inset:0;overflow:auto;margin:0;padding:18px;white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);font-size:13px;color:var(--ink);background:var(--card)";

  if (kind === "pdf") {
    body.innerHTML = `<iframe src="${url}" style="${fill}"></iframe>`;
  } else if (kind === "image") {
    body.innerHTML = `<div style="${center}"><img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain"/></div>`;
  } else if (kind === "html") {
    body.innerHTML = `<iframe src="${url}" sandbox="" style="${fill};background:#fff"></iframe>`;
  } else if (kind === "markdown") {
    body.innerHTML = `<div style="${center}"><span class="spin"></span></div>`;
    let txt = "";
    try { txt = await (await fetch(url)).text(); }
    catch { body.innerHTML = `<div style="${center}">无法加载内容，请下载查看。</div>`; return; }
    let mode = "rendered";
    const mdCss = "body{font:15px/1.7 -apple-system,system-ui,sans-serif;color:#222;background:#fff;padding:28px;max-width:820px;margin:0 auto}pre{background:#f4f4f4;padding:12px;border-radius:8px;overflow:auto}code{background:#f0f0f0;padding:2px 5px;border-radius:4px;font-family:ui-monospace,monospace}pre code{background:none;padding:0}h1,h2,h3{line-height:1.3}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}blockquote{border-left:3px solid #ccc;margin:0 0 1em;padding-left:14px;color:#555}a{color:#9c6a39}";
    const draw = () => {
      if (mode === "rendered") {
        const doc = `<!doctype html><meta charset="utf-8"><style>${mdCss}</style>${marked.parse(txt)}`;
        body.innerHTML = `<iframe sandbox="" style="${fill};background:#fff" srcdoc="${esc(doc)}"></iframe>`;
      } else {
        body.innerHTML = `<pre style="${preStyle}">${esc(txt)}</pre>`;
      }
      tools.innerHTML = `<button class="btn btn-sm" data-md="t">${mode === "rendered" ? "查看源码" : "查看渲染"}</button>`;
      tools.querySelector('[data-md="t"]').onclick = () => { mode = mode === "rendered" ? "source" : "rendered"; draw(); };
    };
    draw();
  } else if (kind === "text") {
    body.innerHTML = `<div style="${center}"><span class="spin"></span></div>`;
    try {
      const txt = await (await fetch(url)).text();
      body.innerHTML = `<pre style="${preStyle}">${esc(txt.slice(0, 200000))}</pre>`;
    } catch {
      body.innerHTML = `<div style="${center}">无法加载文本内容，请下载查看。</div>`;
    }
  } else if (kind === "office") {
    body.innerHTML = `<div style="${center}">
      <div>
        <div style="font-weight:600;color:var(--ink);margin-bottom:6px">${esc(ext.toUpperCase())} 文件</div>
        <p style="margin-bottom:16px;max-width:360px">浏览器无法原生预览此格式。可用 Microsoft 在线预览（会把该文件临时发送到微软服务器），或直接下载。</p>
        <div class="row gap-8" style="justify-content:center">
          <button class="btn btn-primary btn-sm" data-pv="office">用 Microsoft 在线预览</button>
          <button class="btn btn-sm" data-pv="dl2">下载查看</button>
        </div>
      </div></div>`;
    body.querySelector('[data-pv="dl2"]').onclick = () => downloadMaterial(id);
    body.querySelector('[data-pv="office"]').onclick = () => {
      const v = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
      body.innerHTML = `<iframe src="${v}" style="${fill}"></iframe>`;
    };
  } else {
    body.innerHTML = `<div style="${center}">此格式暂不支持内嵌预览，请下载查看。</div>`;
  }
}
