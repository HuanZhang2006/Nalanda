// @ts-nocheck
// 真后端的 Materials 模块：课程 + 资料的增删查 + 文件上传/下载/预览（Supabase 直连，RLS 保护）。
// 渲染进 legacy 应用提供的 #mat-root 容器，自管状态与事件。
import { ICON } from "./icons";

let sb = null;
let USER = null;
let toastFn = (_m) => {};

const state = { loading: true, error: "", courses: [], materials: [], course: "all" };
let rootEl = null;
let fileInput = null;

const FT = { pdf: "pdf", ppt: "ppt", pptx: "ppt", doc: "doc", docx: "doc", md: "md", markdown: "md", html: "html", htm: "html", txt: "txt" };
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

export function initMaterials(supabase, user, toast) {
  sb = supabase; USER = user; if (toast) toastFn = toast;
}

export function mountMaterials(el) {
  rootEl = el; if (!rootEl) return;
  render();
  load();
}

async function load() {
  if (!sb) { state.loading = false; state.error = "未配置 Supabase"; render(); return; }
  state.loading = true; render();
  try {
    const [c, m] = await Promise.all([
      sb.from("courses").select("*").order("created_at", { ascending: true }),
      sb.from("materials").select("*").order("created_at", { ascending: false }),
    ]);
    if (c.error) throw c.error;
    if (m.error) throw m.error;
    state.courses = c.data || [];
    state.materials = m.data || [];
    state.error = "";
  } catch (e) {
    state.error = e.message || "加载失败（数据库迁移已应用了吗？）";
  }
  state.loading = false; render();
}

const courseById = (id) => state.courses.find((c) => c.id === id);

function render() {
  if (!rootEl) return;
  const cur = state.course;
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

    <div class="row gap-8 wrap-flex" style="margin-bottom:18px">
      ${chips.map(([id, l]) => `<button class="chip ${cur === id ? "chip-accent" : "chip-outline"}" data-mat="setCourse" data-c="${esc(id)}">${esc(l)}</button>`).join("")}
    </div>

    ${state.error ? `<div class="card card-pad" style="color:var(--pink)">出错了：${esc(state.error)}</div>` : ""}

    ${state.loading
      ? `<div class="card card-pad muted">加载中…</div>`
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
  </div>`;

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
  else if (action === "newCourse") newCourse();
  else if (action === "upload") pickFiles();
  else if (action === "preview") openMaterial(el.dataset.id, false);
  else if (action === "download") openMaterial(el.dataset.id, true);
  else if (action === "delete") delMaterial(el.dataset.id);
}

function pickFiles() {
  if (state.courses.length === 0) { toastFn("先新建一个课程", "folder"); newCourse(); return; }
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
  const course = state.course;
  if (course === "all") { toastFn("请先选择课程"); return; }
  toastFn("上传中…", "upload");
  let ok = 0;
  for (const f of files) {
    try {
      const path = `${USER.id}/${crypto.randomUUID()}.${extOf(f.name)}`;
      const up = await sb.storage.from("materials").upload(path, f, { upsert: false, contentType: f.type || undefined });
      if (up.error) throw up.error;
      const ins = await sb.from("materials").insert({ course_id: course, name: f.name, type: typeOf(f.name), size_bytes: f.size, storage_path: path });
      if (ins.error) { await sb.storage.from("materials").remove([path]); throw ins.error; }
      ok++;
    } catch (e) {
      toastFn("上传失败：" + (e.message || f.name));
    }
  }
  if (ok) toastFn(ok + " 个文件已上传", "check");
  await load();
}

async function openMaterial(id, download) {
  const m = state.materials.find((x) => x.id === id); if (!m) return;
  const { data, error } = await sb.storage.from("materials").createSignedUrl(m.storage_path, 60, download ? { download: m.name } : undefined);
  if (error || !data) { toastFn("无法获取文件链接"); return; }
  window.open(data.signedUrl, "_blank");
}

async function delMaterial(id) {
  const m = state.materials.find((x) => x.id === id); if (!m) return;
  if (!window.confirm(`删除「${m.name}」？此操作不可撤销。`)) return;
  try {
    await sb.storage.from("materials").remove([m.storage_path]);
    const { error } = await sb.from("materials").delete().eq("id", id);
    if (error) throw error;
    toastFn("已删除", "check");
  } catch (e) {
    toastFn("删除失败：" + (e.message || ""));
  }
  await load();
}

function newCourse() {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal"><div class="modal-pad">
    <h2 class="serif" style="font-size:20px;margin-bottom:14px">新建课程</h2>
    <div class="eyebrow">课程代码（可选）</div>
    <input id="nc-code" class="search" style="width:100%;background:var(--card-2);margin:6px 0 12px" placeholder="如 COGS 210"/>
    <div class="eyebrow">课程名称</div>
    <input id="nc-name" class="search" style="width:100%;background:var(--card-2);margin:6px 0 4px" placeholder="如 Foundations of Cognition"/>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn" data-nc="cancel">取消</button>
      <button class="btn btn-primary" data-nc="save">创建</button>
    </div>
  </div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector('[data-nc="cancel"]').onclick = close;
  scrim.querySelector('[data-nc="save"]').onclick = async () => {
    const code = scrim.querySelector("#nc-code").value.trim();
    const name = scrim.querySelector("#nc-name").value.trim() || code;
    if (!name) { toastFn("请填写课程名称"); return; }
    try {
      const { data, error } = await sb.from("courses").insert({ code, name }).select().single();
      if (error) throw error;
      close();
      toastFn("课程已创建", "check");
      await load();
      if (data) { state.course = data.id; render(); }
    } catch (e) {
      toastFn("创建失败：" + (e.message || ""));
    }
  };
}
