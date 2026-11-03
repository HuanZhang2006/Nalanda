// @ts-nocheck
// Real-backend Materials module: course + material CRUD, file uploads, and in-app multi-format preview (direct Supabase, RLS-protected).
// Renders into the #mat-root container provided by the legacy app and manages its own state and events.
import { localize } from "../i18n";
import { ICON } from "./icons";
import { marked } from "marked";
import { materialsAiApi } from "../features/material-ai/api";
import { materialAiErrorText } from "../features/material-ai/errorText";

let sb = null;
let USER = null;
let toastFn = (_m) => {};
let openNoteFn = (_id) => {};

const state = { loading: true, error: "", courses: [], materials: [], course: "all", jobs: [], jobsError: "", quota: null };
let rootEl = null;
let fileInput = null;
let uploading = false;
let sessionVersion = 0;
let jobsTimer = null;
const l = (en, zh) => localize(en, zh);
const AI_EXT = new Set(["pdf", "docx", "pptx", "md", "markdown", "html", "htm", "txt", "json", "csv", "png", "jpg", "jpeg", "webp"]);

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
  if (days <= 0) return l("today", "今天");
  if (days === 1) return l("yesterday", "昨天");
  if (days < 7) return l(`${days} days ago`, `${days} 天前`);
  return d.toLocaleDateString("en-US");
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

export function initMaterials(supabase, user, toast, openNote = () => {}) {
  sessionVersion++;
  sb = supabase; USER = user; toastFn = toast || (() => {}); openNoteFn = openNote || (() => {});
  Object.assign(state, { loading: true, error: "", courses: [], materials: [], course: "all", jobs: [], jobsError: "", quota: null });
  rootEl = null;
  uploading = false;
  clearTimeout(jobsTimer); jobsTimer = null;
  if (fileInput) fileInput.remove();
  fileInput = null;
}

export function mountMaterials(el) {
  rootEl = el; if (!rootEl) return;
  const mountedRoot = rootEl;
  render();
  load();
  loadAiJobs();
  return () => {
    if (rootEl !== mountedRoot) return;
    rootEl = null;
    sessionVersion++;
    clearTimeout(jobsTimer); jobsTimer = null;
  };
}

function scheduleJobsPoll() {
  clearTimeout(jobsTimer);
  if (!rootEl?.isConnected || !USER) return;
  jobsTimer = setTimeout(loadAiJobs, document.hidden ? 10000 : 2000);
}

async function loadAiJobs() {
  const currentVersion = sessionVersion;
  try {
    const [jobs, quota] = await Promise.all([materialsAiApi.jobs(), materialsAiApi.quota()]);
    if (currentVersion !== sessionVersion || !rootEl?.isConnected) return;
    state.jobs = jobs; state.quota = quota; state.jobsError = ""; render();
  } catch (error) {
    if (currentVersion !== sessionVersion || !rootEl?.isConnected) return;
    state.jobsError = error?.message || l("AI jobs are temporarily unavailable.", "AI 任务暂不可用。");
  } finally {
    if (currentVersion === sessionVersion && rootEl?.isConnected) scheduleJobsPoll();
  }
}

async function load() {
  const currentVersion = sessionVersion;
  if (!sb) { state.loading = false; state.error = l("Supabase is not configured.", "未配置 Supabase"); render(); return; }
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
    state.error = e.message || l("Materials could not be loaded.", "资料加载失败");
  }
  if (currentVersion !== sessionVersion) return;
  state.loading = false; render();
}

const courseById = (id) => state.courses.find((c) => c.id === id);

function aiJobsHtml() {
  if (!state.jobs.length && !state.jobsError) return "";
  const stage = {
    queued: l("Queued", "排队中"), validating: l("Validating", "验证中"), extracting: l("Extracting", "解析中"),
    auditing: l("Safety review", "安全审查"), visualRecovery: l("Visual recovery", "视觉补全"),
    generating: l("Generating", "生成中"), organizing: l("Organizing knowledge points", "梳理知识点"),
    answering: l("Answering", "回答中"), reviewing: l("Reviewing", "复核中"), saving: l("Saving", "保存中"),
    preparingSource: l("Preparing source", "准备源文件"), cleaning: l("Cleaning up…", "正在清理…"),
    succeeded: l("Ready", "已完成"), failed: l("Failed", "失败"), cancelled: l("Cancelled", "已取消"),
  };
  const jobKind = {
    exam: l("Test paper", "试卷"),
    knowledge_graph: l("Knowledge map", "知识图"),
    knowledge_question: l("Knowledge question", "知识点提问"),
  };
  return `<section class="card card-pad" style="margin-bottom:18px" aria-label="${l("AI generation queue", "AI 生成队列")}">
    <div class="row between wrap-flex gap-12" style="margin-bottom:12px">
      <div><div class="eyebrow">${l("AI generation queue", "AI 生成队列")}</div>
        <h2 class="serif" style="font-size:17px">${l("Materials AI", "资料 AI")}</h2></div>
      <div class="row gap-8 wrap-flex">
        ${state.quota ? `<span class="chip chip-accent">${l("Free today", "今日免费额度")} · ${state.quota.generation.remaining}/${state.quota.generation.limit}</span>` : ""}
        ${state.jobs.some((job) => ["succeeded", "failed", "cancelled"].includes(job.status)) ? `<button class="btn btn-sm" data-mat="clearAiHistory">${l("Clear history", "清除历史")}</button>` : ""}
      </div>
    </div>
    ${state.jobsError ? `<div class="course-feedback wrong" role="alert">${esc(state.jobsError)}</div>` : ""}
    ${state.jobs.slice(0, 10).map((job) => `<div class="list-row" style="padding:11px 0">
      <div class="stat-ic" style="margin:0">${job.status === "succeeded" ? ICON("check") : job.status === "failed" ? ICON("close") : ICON("sparkles")}</div>
      <div class="fill"><div style="font-weight:650;font-size:13px">${esc(job.materialName)}</div>
        <div class="faint" style="font-size:11.5px">${esc(jobKind[job.kind] || job.kind)} · ${esc(stage[job.stage] || job.stage)} · ${esc(job.pipeline === "luna_native_file_v1" ? l("Luna native file", "Luna 原生文件") : "Document IR")}${job.queuePosition ? ` · ${l("queue", "队列")} #${job.queuePosition}` : ""}</div>
        <div class="bar" style="margin-top:6px"><i style="width:${Math.max(0, Math.min(100, job.progress))}%"></i></div>
        ${job.errorCode ? `<div class="course-feedback wrong" style="margin-top:7px">${esc(job.errorCode)} · ${esc(materialAiErrorText(job.errorCode, job.errorMessage || l("Try again later.", "请稍后重试。"), l))}</div>` : ""}
      </div>
      <div class="row gap-6">
        ${job.status === "succeeded" && job.noteId ? `<button class="btn btn-sm" data-mat="openAiNote" data-note-id="${job.noteId}">${l("Open result", "打开结果")}</button>` : ""}
        ${job.status === "queued" || job.status === "processing" ? `<button class="btn btn-sm" data-mat="cancelAiJob" data-id="${job.id}">${l("Cancel", "取消")}</button>` : ""}
        ${job.status === "failed" && job.retryable ? `<button class="btn btn-sm" data-mat="retryAiJob" data-id="${job.id}">${l("Resume", "继续")}</button>` : ""}
        ${job.status === "deleting" ? `<button class="btn btn-sm" disabled><span class="spin"></span>${l("Cleaning up…", "正在清理…")}</button>` : `<button class="icon-btn" data-mat="deleteAiJob" data-id="${job.id}" title="${l("Delete task", "删除任务")}" aria-label="${l("Delete task", "删除任务")}" style="width:32px;height:32px">${ICON("close")}</button>`}
      </div>
    </div>`).join("")}
  </section>`;
}

/* ---------- In-app confirmation dialog (replaces the browser's native confirm) ---------- */
function confirmDialog({ title, message, confirmText = l("Delete", "删除"), danger = true }) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-pad">
      <h2 class="serif" style="font-size:19px;margin-bottom:10px">${esc(title)}</h2>
      <p class="muted" style="font-size:13.5px;line-height:1.55;margin-bottom:20px">${esc(message)}</p>
      <div class="row gap-8" style="justify-content:flex-end">
        <button class="btn" data-cf="no">${l("Cancel", "取消")}</button>
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

function aiResultDeleteDialog({ title, message }) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div"); scrim.className = "scrim";
    scrim.innerHTML = `<div class="modal"><div class="modal-pad">
      <h2 class="serif" style="font-size:19px;margin-bottom:8px">${esc(title)}</h2>
      <p class="muted" style="font-size:13px;line-height:1.55">${esc(message)}</p>
      <div class="card card-pad" style="margin-top:14px;font-size:12.5px"><b>${l("Keep AI results", "保留 AI 结果")}</b><div class="muted">${l("Generated AI notes move to Unfiled and remain available.", "生成的 AI 笔记会移入 Unfiled 并继续保留。")}</div></div>
      <div class="row gap-8 wrap-flex" style="justify-content:flex-end;margin-top:18px">
        <button class="btn" data-delete-choice="cancel">${l("Cancel", "取消")}</button>
        <button class="btn" data-delete-choice="keep">${l("Keep results and delete source", "保留结果并删除源文件")}</button>
        <button class="btn" data-delete-choice="delete" style="background:var(--pink);color:#fff;border-color:transparent">${l("Delete source and results", "同时删除源文件和结果")}</button>
      </div>
    </div></div>`;
    document.body.appendChild(scrim);
    const done = (value) => { scrim.remove(); resolve(value); };
    scrim.addEventListener("click", (event) => { if (event.target === scrim) done(false); });
    scrim.querySelectorAll("[data-delete-choice]").forEach((button) => {
      button.onclick = () => done(button.dataset.deleteChoice === "cancel" ? false : button.dataset.deleteChoice);
    });
  });
}

function render() {
  if (!rootEl) return;
  const cur = state.course;
  const sel = cur !== "all" ? courseById(cur) : null;
  const list = cur === "all" ? state.materials : state.materials.filter((m) => m.course_id === cur);
  const chips = [["all", l("All courses", "全部科目")]].concat(state.courses.map((c) => [c.id, c.code || c.name]));

  rootEl.innerHTML = `<div class="wrap">
    <div class="page-head">
      <div><div class="eyebrow">${l("Course library", "科目资料库")}</div><h1 class="page-title">Materials</h1>
        <p class="page-sub">${l("Upload, organize, and preview study files. Each file belongs to a Materials course and can be used as private AI input.", "上传、整理并预览学习资料；每份文件归属一个 Materials 科目，也可作为私有 AI 输入。")}</p></div>
      <div class="row gap-8">
        <button class="btn" data-mat="newCourse">${ICON("plus")}<span>${l("New course", "新建科目")}</span></button>
        <button class="btn btn-primary" data-mat="upload">${ICON("upload")}<span>${l("Upload material", "上传资料")}</span></button>
      </div>
    </div>

    <div class="row gap-8 wrap-flex" style="margin-bottom:14px">
      ${chips.map(([id, l]) => `<button class="chip ${cur === id ? "chip-accent" : "chip-outline"}" data-mat="setCourse" data-c="${esc(id)}">${esc(l)}</button>`).join("")}
    </div>

    ${sel ? `<div class="row gap-8" style="margin-bottom:16px;font-size:12.5px;color:var(--ink-soft)">
        <span>${l("Current course", "当前科目")}：<b>${esc(sel.name)}</b>${sel.code ? ` · ${esc(sel.code)}` : ""}</span>
        <button class="btn btn-sm" data-mat="editCourse" data-id="${sel.id}">${ICON("edit")}<span>${l("Rename", "重命名")}</span></button>
        <button class="btn btn-sm" data-mat="deleteCourse" data-id="${sel.id}">${ICON("close")}<span>${l("Delete course", "删除科目")}</span></button>
      </div>` : ""}

    ${state.error ? `<div class="card card-pad" style="color:var(--pink)">${l("Error", "出错了")}：${esc(state.error)}</div>` : ""}

    ${aiJobsHtml()}

    ${state.loading
      ? `<div class="card card-pad muted row gap-8"><span class="spin"></span>${l("Loading…", "加载中…")}</div>`
      : state.courses.length === 0
        ? emptyNoCourse()
        : `<div class="card card-pad" style="padding:10px">
            <div class="mat-row" style="border:0;color:var(--ink-faint);font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">
              <span style="width:40px">${l("Type", "类型")}</span><span>${l("Name", "名称")}</span><span class="nowrap">${l("Course", "科目")}</span><span>${l("Actions", "操作")}</span>
            </div>
            ${list.length === 0
              ? `<div class="muted" style="padding:18px 14px">${l("No materials in this course. Choose Upload material to add one.", "该科目暂无资料，请点击“上传资料”添加。")}</div>`
              : list.map(rowHtml).join("")}
          </div>
          <div class="card card-pad hoverable mt-16" id="mat-drop" data-mat="upload" style="cursor:pointer;border-style:dashed;text-align:center;color:var(--ink-faint)">
            <div class="stat-ic" style="margin:0 auto 8px">${ICON("upload")}</div>
            <div style="font-weight:600;color:var(--ink-soft)">${l("Drop files here or click to upload", "拖拽文件到此或点击上传")}</div>
            <div style="font-size:12px">PDF · PPT · Word · Markdown · HTML · TXT${cur === "all" ? l(" (choose a course first)", "（请先选择科目）") : ""}</div>
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
    <h3 class="serif" style="font-size:18px;margin-bottom:6px">${l("No courses yet", "还没有科目")}</h3>
    <p class="muted" style="margin-bottom:16px">${l("Create a Materials course before uploading files.", "请先创建一个 Materials 科目，再上传资料。")}</p>
    <button class="btn btn-primary" data-mat="newCourse" style="margin:0 auto">${ICON("plus")}<span>${l("New course", "新建科目")}</span></button>
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
      <button class="btn btn-sm" data-mat="useAi" data-id="${m.id}" ${AI_EXT.has(extOf(m.name)) ? "" : "disabled"} title="${AI_EXT.has(extOf(m.name)) ? l("Use AI", "使用 AI") : l("This format is not supported by AI", "AI 不支持此格式")}">${ICON("sparkles")}<span>${l("Use AI", "使用 AI")}</span></button>
      <button class="icon-btn" data-mat="preview" data-id="${m.id}" title="${l("Preview", "预览")}" style="width:32px;height:32px">${ICON("eye")}</button>
      <button class="icon-btn" data-mat="download" data-id="${m.id}" title="${l("Download", "下载")}" style="width:32px;height:32px">${ICON("download")}</button>
      <button class="icon-btn" data-mat="delete" data-id="${m.id}" title="${l("Delete", "删除")}" style="width:32px;height:32px">${ICON("close")}</button>
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
  else if (action === "useAi") aiMenu(el.dataset.id);
  else if (action === "cancelAiJob") cancelAiJob(el.dataset.id);
  else if (action === "deleteAiJob") deleteAiJob(el.dataset.id);
  else if (action === "clearAiHistory") clearAiHistory();
  else if (action === "retryAiJob") retryAiJob(el.dataset.id);
  else if (action === "openAiNote") openNoteFn(el.dataset.noteId);
}

async function aiMenu(materialId) {
  const material = state.materials.find((item) => item.id === materialId);
  if (!material) return;
  let capabilities;
  try {
    capabilities = await materialsAiApi.capabilities(material.id);
  } catch (failure) {
    toastFn(materialAiErrorText(failure, "AI capabilities could not be loaded.", l));
    return;
  }
  const scrim = document.createElement("div"); scrim.className = "scrim";
  const choices = [
    ["exam", l("Generate test paper", "生成试卷"), l("Create a cited, answerable paper and take it online.", "生成带来源引用的试卷，并可在线考试。"), true],
    ["knowledge_graph", l("Organize knowledge points", "知识点梳理"), l("Create a detailed, source-ordered interactive knowledge map.", "创建详细且遵循源文件顺序的交互知识图。"), true],
    ["knowledge", l("Knowledge list", "知识清单"), l("Coming soon", "即将推出"), false],
    ["quiz", l("Quiz", "测验"), l("Coming soon", "即将推出"), false],
  ];
  scrim.innerHTML = `<div class="modal"><div class="modal-pad">
    <div class="eyebrow">${l("Use AI", "使用 AI")}</div><h2 class="serif" style="font-size:20px;margin-bottom:4px">${esc(material.name)}</h2>
    <p class="muted" style="font-size:12.5px;margin-bottom:16px">${l("Choose an AI action. Your source stays private and results are saved to My Notes.", "选择 AI 操作；源文件保持私有，结果会保存到 My Notes。")}</p>
    <div class="grid g-2">${choices.map(([id, title, description, available]) => `<button class="gen-card ${available ? "" : "locked"}" data-ai-choice="${id}" ${available ? "" : "disabled"} style="text-align:left">
      <div class="gen-ic">${ICON(id === "exam" ? "exam" : id === "knowledge" ? "list" : id === "knowledge_graph" ? "graph" : id)}</div><div class="fill"><div style="font-weight:650">${title}</div><div class="muted" style="font-size:12px">${description}</div></div>
    </button>`).join("")}</div>
    <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-ai-close>${l("Cancel", "取消")}</button></div>
  </div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener("click", (event) => { if (event.target === scrim) close(); });
  scrim.querySelector("[data-ai-close]").onclick = close;
  scrim.querySelector('[data-ai-choice="exam"]').onclick = () => { close(); examSettingsModal(material, null, capabilities); };
  scrim.querySelector('[data-ai-choice="knowledge_graph"]').onclick = () => { close(); knowledgeSettingsModal(material, capabilities); };
}

function consentBlock(alreadyConsented) {
  return alreadyConsented
    ? `<div class="card card-pad row gap-10" style="margin-top:14px;align-items:flex-start"><span aria-hidden>✓</span><span class="muted" style="font-size:12.5px;line-height:1.55">AI processing consent v1 is recorded for this account. Third-party processing uses Zero Data Retention routing; the private parse cache remains until the material is deleted, and temporary files are removed after every terminal job. Retry checkpoints expire automatically.</span></div>`
    : `<label class="card card-pad row gap-10" style="margin-top:14px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="ai-consent" style="margin-top:3px"><span class="muted" style="font-size:12.5px;line-height:1.55">I agree that this file is processed by third-party AI providers using Zero Data Retention routing. Nalanda keeps a private structured parse cache until the material is deleted. Temporary files are deleted after each terminal job; private retry checkpoints expire automatically.</span></label>`;
}

function pipelineSelector(capabilityResponse) {
  const capabilities = capabilityResponse?.capabilities || [];
  const selected = capabilities.find((item) => item.default && item.available)?.pipeline
    || capabilities.find((item) => item.available)?.pipeline
    || "document_ir_v1";
  const labels = {
    luna_native_file_v1: [l("Luna native file", "Luna 原生文件"), l("Sends the original file directly to GPT-6 Luna through the Azure Zero Data Retention provider.", "通过 Azure 零数据保留供应商把原始文件直接发送给 GPT-6 Luna。")],
    document_ir_v1: ["Document IR", l("Uses deterministic extraction, targeted visual recovery, and DeepSeek generation.", "使用确定性解析、定向视觉补全和 DeepSeek 生成。")],
  };
  return `<fieldset style="border:0;margin:0 0 16px;padding:0"><legend class="eyebrow" style="margin-bottom:7px">${l("Processing pipeline", "处理流水线")}</legend>
    <div class="grid g-2">${capabilities.map((item) => {
      const copy = labels[item.pipeline] || [item.pipeline, item.model];
      const reason = item.reasonCode === "AI_LUNA_DISABLED" ? l("Luna is not enabled yet.", "Luna 尚未开放。")
        : item.reasonCode === "OPENROUTER_ZDR_UNAVAILABLE"
          ? l("No compliant Zero Data Retention endpoint is currently available. Document IR remains available.", "当前没有符合零数据保留要求的端点，Document IR 仍可使用。")
          : item.reasonCode === "AI_LUNA_FORMAT_NOT_VERIFIED"
            ? l("This file format has not passed the native-input gate.", "该文件格式尚未通过原生输入验证。")
            : "";
      return `<label class="card card-pad row gap-10" style="padding:12px;align-items:flex-start;${item.available ? "cursor:pointer" : "opacity:.55"}">
        <input type="radio" name="ai-pipeline" value="${esc(item.pipeline)}" ${item.pipeline === selected ? "checked" : ""} ${item.available ? "" : "disabled"} style="margin-top:3px">
        <span><b style="font-size:13px">${esc(copy[0])}</b><span class="muted" style="display:block;font-size:11.5px;line-height:1.45;margin-top:3px">${esc(copy[1])}${reason ? ` ${esc(reason)}` : ""}</span></span>
      </label>`;
    }).join("")}</div>
  </fieldset>`;
}

function knowledgeSettingsModal(material, capabilities) {
  const consentKey = `nalanda-material-ai-consent-v1:${USER?.id || "anonymous"}`;
  const alreadyConsented = localStorage.getItem(consentKey) === "1";
  const scrim = document.createElement("div"); scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal" style="width:min(620px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto"><div class="modal-pad">
    <div class="eyebrow">${l("Organize knowledge points", "知识点梳理")}</div><h2 class="serif" style="font-size:21px;margin-bottom:4px">${esc(material.name)}</h2>
    <p class="muted" style="font-size:12.5px;line-height:1.55;margin-bottom:18px">${l("Build a comprehensive knowledge map in source order. Every point includes a detailed explanation, citations, relationships, examples, misconceptions, and review questions.", "按源文件顺序构建完整的知识图。每个知识点都包含详细解释、来源引用、关联关系、示例、常见误区和复习题。")}</p>
    ${pipelineSelector(capabilities)}
    <label><span class="eyebrow">${l("Output language", "输出语言")}</span><select class="search" id="ai-language" style="width:100%;background:var(--card-2);margin-top:6px"><option value="auto">${l("Match material", "跟随资料")}</option><option value="en">English</option><option value="zh">${l("Chinese", "中文")}</option></select></label>
    <label style="display:block;margin-top:16px"><span class="eyebrow">${l("Topic focus (optional, 200 characters)", "重点主题（可选，200 字以内）")}</span><textarea class="search" id="ai-focus" maxlength="200" style="width:100%;min-height:76px;background:var(--card-2);margin-top:6px"></textarea></label>
    ${consentBlock(alreadyConsented)}
    <div class="course-feedback wrong" data-ai-error style="display:none;margin-top:12px"></div>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-ai-cancel>${l("Cancel", "取消")}</button><button class="btn btn-primary" data-ai-submit>${ICON("sparkles")}<span>${l("Generate", "开始生成")}</span></button></div>
  </div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener("click", (event) => { if (event.target === scrim) close(); });
  scrim.querySelector("[data-ai-cancel]").onclick = close;
  const submit = scrim.querySelector("[data-ai-submit]");
  submit.onclick = async () => {
    const error = scrim.querySelector("[data-ai-error]");
    if (!alreadyConsented && !scrim.querySelector("#ai-consent")?.checked) {
      error.textContent = l("Confirm AI processing consent to continue.", "请确认 AI 处理同意后继续。"); error.style.display = "block"; return;
    }
    submit.disabled = true; submit.querySelector("span").textContent = l("Queuing…", "正在入队…"); error.style.display = "none";
    try {
      await materialsAiApi.createJob(material.id, {
        idempotencyKey: crypto.randomUUID(), kind: "knowledge_graph", pipeline: scrim.querySelector('[name="ai-pipeline"]:checked').value, consentVersion: 1,
        settings: {
          language: scrim.querySelector("#ai-language").value,
          detail: "comprehensive",
          focus: scrim.querySelector("#ai-focus").value.trim(),
        },
      });
      localStorage.setItem(consentKey, "1"); close();
      toastFn(l("Knowledge point organization queued", "知识点梳理任务已入队"), "check"); await loadAiJobs();
    } catch (failure) {
      error.textContent = materialAiErrorText(failure, l("The AI job could not be created.", "无法创建 AI 任务。"), l);
      error.style.display = "block"; submit.disabled = false; submit.querySelector("span").textContent = l("Generate", "开始生成");
    }
  };
}

function examSettingsModal(material, preset = null, capabilities = null) {
  const consentKey = `nalanda-material-ai-consent-v1:${USER?.id || "anonymous"}`;
  const alreadyConsented = localStorage.getItem(consentKey) === "1";
  const settings = preset || {
    language: "auto", difficulty: "mixed", durationMinutes: 60, totalMarks: 100, answerDetail: "detailed", focus: "",
    questionCounts: { singleChoice: 8, multipleChoice: 3, trueFalse: 4, fillBlank: 3, shortAnswer: 1, essay: 1 },
  };
  const scrim = document.createElement("div"); scrim.className = "scrim";
  const number = (key, label) => `<label><span class="eyebrow">${label}</span><input class="search" type="number" min="0" max="100" data-ai-count="${key}" value="${Number(settings.questionCounts[key] || 0)}" style="width:100%;background:var(--card-2);margin-top:6px"></label>`;
  scrim.innerHTML = `<div class="modal" style="width:min(720px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto"><div class="modal-pad">
    <div class="eyebrow">${l("Generate test paper", "生成试卷")}</div><h2 class="serif" style="font-size:21px;margin-bottom:4px">${esc(material.name)}</h2>
    <p class="muted" style="font-size:12.5px;margin-bottom:18px">${l("Configure a 5–100 question paper. Marks must be at least the number of questions.", "配置 5–100 道题；总分不得小于题目数量。")}</p>
    ${pipelineSelector(capabilities)}
    <div class="grid g-3">
      <label><span class="eyebrow">${l("Language", "语言")}</span><select class="search" id="ai-language" style="width:100%;background:var(--card-2);margin-top:6px"><option value="auto">${l("Match material", "跟随资料")}</option><option value="en">English</option><option value="zh">Chinese</option></select></label>
      <label><span class="eyebrow">${l("Difficulty", "难度")}</span><select class="search" id="ai-difficulty" style="width:100%;background:var(--card-2);margin-top:6px"><option value="introductory">${l("Introductory", "入门")}</option><option value="intermediate">${l("Intermediate", "中等")}</option><option value="advanced">${l("Advanced", "进阶")}</option><option value="mixed">${l("Mixed", "混合")}</option></select></label>
      <label><span class="eyebrow">${l("Answer detail", "答案详略")}</span><select class="search" id="ai-answer-detail" style="width:100%;background:var(--card-2);margin-top:6px"><option value="concise">${l("Concise", "简洁")}</option><option value="detailed">${l("Detailed", "详细")}</option></select></label>
      <label><span class="eyebrow">${l("Duration (minutes)", "时长（分钟）")}</span><input class="search" id="ai-duration" type="number" min="15" max="240" value="${settings.durationMinutes}" style="width:100%;background:var(--card-2);margin-top:6px"></label>
      <label><span class="eyebrow">${l("Total marks", "总分")}</span><input class="search" id="ai-marks" type="number" min="20" max="200" value="${settings.totalMarks}" style="width:100%;background:var(--card-2);margin-top:6px"></label>
    </div>
    <div class="divider"></div><div class="grid g-3">
      ${number("singleChoice", l("Single choice", "单选题"))}${number("multipleChoice", l("Multiple choice", "多选题"))}${number("trueFalse", l("True / false", "判断题"))}
      ${number("fillBlank", l("Fill in the blank", "填空题"))}${number("shortAnswer", l("Short answer", "简答题"))}${number("essay", l("Essay", "论述题"))}
    </div>
    <label style="display:block;margin-top:16px"><span class="eyebrow">${l("Topic focus (optional, 200 characters)", "主题聚焦（可选，最多 200 字）")}</span><textarea class="search" id="ai-focus" maxlength="200" style="width:100%;min-height:76px;background:var(--card-2);margin-top:6px">${esc(settings.focus || "")}</textarea></label>
    ${consentBlock(alreadyConsented)}
    <div class="course-feedback wrong" data-ai-error style="display:none;margin-top:12px"></div>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-ai-cancel>${l("Cancel", "取消")}</button><button class="btn btn-primary" data-ai-submit>${ICON("sparkles")}<span>${l("Generate", "开始生成")}</span></button></div>
  </div></div>`;
  document.body.appendChild(scrim);
  scrim.querySelector("#ai-language").value = settings.language;
  scrim.querySelector("#ai-difficulty").value = settings.difficulty;
  scrim.querySelector("#ai-answer-detail").value = settings.answerDetail;
  const close = () => scrim.remove();
  scrim.addEventListener("click", (event) => { if (event.target === scrim) close(); });
  scrim.querySelector("[data-ai-cancel]").onclick = close;
  const submit = scrim.querySelector("[data-ai-submit]");
  submit.onclick = async () => {
    const counts = Object.fromEntries([...scrim.querySelectorAll("[data-ai-count]")].map((input) => [input.dataset.aiCount, Number(input.value)]));
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const durationMinutes = Number(scrim.querySelector("#ai-duration").value);
    const totalMarks = Number(scrim.querySelector("#ai-marks").value);
    const error = scrim.querySelector("[data-ai-error]");
    if (!alreadyConsented && !scrim.querySelector("#ai-consent")?.checked) { error.textContent = l("Confirm AI processing consent to continue.", "请确认 AI 处理同意后继续。"); error.style.display = "block"; return; }
    if (!Number.isInteger(total) || total < 5 || total > 100 || !Number.isInteger(totalMarks) || totalMarks < Math.max(20, total) || totalMarks > 200 || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
      error.textContent = l("Use 5–100 questions, 15–240 minutes, and 20–200 marks (at least one mark per question).", "请设置 5–100 道题、15–240 分钟、20–200 总分（每题至少 1 分）。"); error.style.display = "block"; return;
    }
    const request = { idempotencyKey: crypto.randomUUID(), kind: "exam", pipeline: scrim.querySelector('[name="ai-pipeline"]:checked').value, consentVersion: 1, settings: {
      language: scrim.querySelector("#ai-language").value, difficulty: scrim.querySelector("#ai-difficulty").value,
      durationMinutes, totalMarks, questionCounts: counts, answerDetail: scrim.querySelector("#ai-answer-detail").value,
      focus: scrim.querySelector("#ai-focus").value.trim(),
    } };
    submit.disabled = true; submit.querySelector("span").textContent = l("Queuing…", "正在入队…"); error.style.display = "none";
    try {
      await materialsAiApi.createJob(material.id, request);
      localStorage.setItem(consentKey, "1"); close();
      toastFn(l("Test paper generation queued", "试卷生成任务已入队"), "check"); await loadAiJobs();
    } catch (failure) {
      error.textContent = materialAiErrorText(failure, l("The AI job could not be created.", "无法创建 AI 任务。"), l); error.style.display = "block";
      submit.disabled = false; submit.querySelector("span").textContent = l("Generate", "开始生成");
    }
  };
}

async function cancelAiJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  const accepted = await confirmDialog({
    title: l("Cancel AI task", "取消 AI 任务"),
    message: job.status === "processing"
      ? l(`Cancel “${job.materialName}”? The worker will stop and clean temporary files. Because processing already started, this uses one free generation.`, `取消“${job.materialName}”？工作进程会停止并清理临时文件。由于处理已经开始，会消耗一次免费生成额度。`)
      : l(`Cancel “${job.materialName}”? The queued reservation will be released after cleanup.`, `取消“${job.materialName}”？清理完成后会释放排队预留的额度。`),
    confirmText: l("Cancel task", "取消任务"),
  });
  if (!accepted) return;
  try { await materialsAiApi.cancel(id); toastFn(l("AI job cancelled", "AI 任务已取消"), "check"); await loadAiJobs(); }
  catch (error) { toastFn(materialAiErrorText(error, l("Could not cancel the AI job", "无法取消 AI 任务"), l)); }
}

async function deleteAiJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  const active = job.status === "queued" || job.status === "processing";
  const message = job.status === "queued"
    ? l(`Delete “${job.materialName}”? The queued job will stop, temporary state will be purged, and its reserved generation will be released.`, `删除“${job.materialName}”？排队任务会停止，临时状态会被清除，并释放预留的生成额度。`)
    : job.status === "processing"
      ? l(`Delete “${job.materialName}”? Processing will be interrupted and temporary files will be purged. One free generation is consumed because the worker already accepted it.`, `删除“${job.materialName}”？处理会被中断并清除临时文件。由于工作进程已接收任务，会消耗一次免费生成额度。`)
      : l(`Delete this ${job.status} task record for “${job.materialName}”? Existing My Notes content and provider cost records are kept, and past quota usage is not reversed.`, `删除“${job.materialName}”的这条任务记录（${job.status}）？已有的 My Notes 内容和供应商成本记录会保留，过去的额度使用不会撤销。`);
  const accepted = await confirmDialog({ title: active ? l("Stop and delete AI task", "停止并删除 AI 任务") : l("Delete AI task record", "删除 AI 任务记录"), message });
  if (!accepted) return;
  try {
    const result = await materialsAiApi.deleteJob(id);
    toastFn(result.status === "cleaning" ? l("Cleaning temporary AI files…", "正在清理 AI 临时文件…") : l("AI task deleted", "AI 任务已删除"), "check");
    await loadAiJobs();
  } catch (error) {
    toastFn(materialAiErrorText(error, l("The AI task could not be deleted.", "无法删除 AI 任务。"), l));
  }
}

async function clearAiHistory() {
  const count = state.jobs.filter((job) => ["succeeded", "failed", "cancelled"].includes(job.status)).length;
  if (!count) return;
  const accepted = await confirmDialog({
    title: l("Clear AI task history", "清除 AI 任务历史"),
    message: l(`Delete ${count} completed, failed, or cancelled task record${count === 1 ? "" : "s"}? Active tasks are not affected. Existing My Notes results, provider cost records, and past quota usage are kept.`, `删除 ${count} 条已完成、失败或已取消的任务记录？进行中的任务不受影响，已有的 My Notes 结果、供应商成本记录和过去的额度使用都会保留。`),
    confirmText: l("Clear history", "清除历史"),
  });
  if (!accepted) return;
  try {
    const result = await materialsAiApi.clearHistory();
    toastFn(result.cleaning ? l(`Cleaning ${result.cleaning} task record${result.cleaning === 1 ? "" : "s"}…`, `正在清理 ${result.cleaning} 条任务记录…`) : l("AI history cleared", "AI 历史已清除"), "check");
    await loadAiJobs();
  } catch (error) {
    toastFn(materialAiErrorText(error, l("AI task history could not be cleared.", "无法清除 AI 任务历史。"), l));
  }
}

async function retryAiJob(id) {
  try {
    await materialsAiApi.retry(id);
    toastFn(l("AI job resumed from its latest saved checkpoint", "AI 任务已从最近保存的检查点继续"), "check");
    await loadAiJobs();
  } catch (error) {
    toastFn(materialAiErrorText(error, l("The AI job could not be resumed.", "无法继续 AI 任务。"), l));
    await loadAiJobs();
  }
}

/* ---------- Courses: create / rename (with loading state + duplicate-submit guard) ---------- */
function courseModal(existing) {
  const isEdit = !!existing;
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal"><div class="modal-pad">
    <h2 class="serif" style="font-size:20px;margin-bottom:14px">${isEdit ? l("Rename course", "重命名科目") : l("New course", "新建科目")}</h2>
    <div class="eyebrow">${l("Course code (optional)", "科目代码（可选）")}</div>
    <input id="nc-code" class="search" style="width:100%;background:var(--card-2);margin:6px 0 12px" placeholder="${l("e.g. COGS 210", "例如 COGS 210")}" value="${esc(existing && existing.code || "")}"/>
    <div class="eyebrow">${l("Course name", "科目名称")}</div>
    <input id="nc-name" class="search" style="width:100%;background:var(--card-2);margin:6px 0 4px" placeholder="${l("e.g. Foundations of Cognition", "例如 Foundations of Cognition")}" value="${esc(existing && existing.name || "")}"/>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn" data-nc="cancel">${l("Cancel", "取消")}</button>
      <button class="btn btn-primary" data-nc="save">${isEdit ? l("Save", "保存") : l("Create", "创建")}</button>
    </div>
  </div></div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  const saveBtn = scrim.querySelector('[data-nc="save"]');
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector('[data-nc="cancel"]').onclick = close;

  let saving = false;
  saveBtn.onclick = async () => {
    if (saving) return; // Guard against double clicks so two courses with the same name are not created
    const currentVersion = sessionVersion, client = sb;
    const code = scrim.querySelector("#nc-code").value.trim();
    const name = scrim.querySelector("#nc-name").value.trim() || code;
    if (!name) { toastFn(l("Enter a course name", "请填写科目名称")); return; }
    saving = true;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spin"></span><span>${isEdit ? l("Saving…", "保存中…") : l("Creating…", "创建中…")}</span>`;
    try {
      if (isEdit) {
        const { error } = await client.from("courses").update({ code, name }).eq("id", existing.id);
        if (error) throw error;
        if (currentVersion !== sessionVersion) return;
        close(); toastFn(l("Saved", "已保存"), "check"); await load();
      } else {
        const { data, error } = await client.from("courses").insert({ code, name }).select().single();
        if (error) throw error;
        if (currentVersion !== sessionVersion) return;
        close(); toastFn(l("Course created", "科目已创建"), "check");
        await load();
        if (data) { state.course = data.id; render(); }
      }
    } catch (e) {
      if (currentVersion !== sessionVersion) return;
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? l("Save", "保存") : l("Create", "创建");
      toastFn((isEdit ? l("Save failed: ", "保存失败：") : l("Create failed: ", "创建失败：")) + (e.message || ""));
    }
  };
}

async function deleteCourse(id) {
  const currentVersion = sessionVersion;
  const c = courseById(id); if (!c) return;
  const mats = state.materials.filter((m) => m.course_id === id);
  const choice = await aiResultDeleteDialog({
    title: l("Delete course", "删除科目"),
    message: l(`Delete “${c.code || c.name}” and its ${mats.length} materials? Unfinished AI jobs will be cancelled.`, `删除“${c.code || c.name}”及其 ${mats.length} 份资料？未完成的 AI 任务会被取消。`),
  });
  if (currentVersion !== sessionVersion) return;
  if (!choice) return;
  toastFn(l("Deleting…", "删除中…"));
  try {
    await materialsAiApi.deleteMaterialCourse(id, choice);
    if (currentVersion !== sessionVersion) return;
    if (state.course === id) state.course = "all";
    toastFn(l("Course deleted", "科目已删除"), "check");
  } catch (e) {
    if (currentVersion !== sessionVersion) return;
    toastFn(materialAiErrorText(e, l("The course could not be deleted.", "无法删除科目。"), l));
  }
  await Promise.all([load(), loadAiJobs()]);
}

/* ---------- Upload ---------- */
function pickFiles() {
  if (state.courses.length === 0) { toastFn(l("Create a course first", "请先新建科目"), "folder"); courseModal(null); return; }
  if (state.course === "all") { toastFn(l("Choose a course before uploading", "请先选择科目再上传")); return; }
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
  if (course === "all") { toastFn(l("Choose a course first", "请先选择科目")); return; }
  if (uploading) return;
  uploading = true;
  toastFn(`${l("Uploading", "上传中")}… (0/${files.length})`, "upload");
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
      toastFn(`${l("Uploading", "上传中")}… (${ok}/${files.length})`, "upload");
    } catch (e) {
      if (currentVersion !== sessionVersion) return;
      toastFn(l("Upload failed: ", "上传失败：") + (e.message || f.name));
    }
  }
  uploading = false;
  if (ok) toastFn(l(`${ok} files uploaded`, `已上传 ${ok} 个文件`), "check");
  await load();
}

async function delMaterial(id) {
  const currentVersion = sessionVersion;
  const m = state.materials.find((x) => x.id === id); if (!m) return;
  const choice = await aiResultDeleteDialog({
    title: l("Delete material", "删除资料"),
    message: l(`Delete “${m.name}”? Any unfinished AI jobs will be cancelled and their reserved allowance released.`, `删除“${m.name}”？未完成的 AI 任务会被取消，并释放已预留额度。`),
  });
  if (currentVersion !== sessionVersion) return;
  if (!choice) return;
  try {
    await materialsAiApi.deleteMaterial(id, choice);
    if (currentVersion !== sessionVersion) return;
    toastFn(l("Material deleted", "资料已删除"), "check");
  } catch (e) {
    if (currentVersion !== sessionVersion) return;
    toastFn(materialAiErrorText(e, l("The material could not be deleted.", "无法删除资料。"), l));
  }
  await Promise.all([load(), loadAiJobs()]);
}

/* ---------- Download (triggers a browser download without opening a new page) ---------- */
async function downloadMaterial(id) {
  const currentVersion = sessionVersion, client = sb;
  const m = state.materials.find((x) => x.id === id); if (!m) return;
  const { data, error } = await client.storage.from("materials").createSignedUrl(m.storage_path, 120, { download: m.name });
  if (currentVersion !== sessionVersion) return;
  if (error || !data) { toastFn(l("Could not create a file link", "无法获取文件链接")); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl; a.download = m.name; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- In-app preview (multiple formats) ---------- */
async function previewMaterial(id) {
  const currentVersion = sessionVersion, client = sb;
  const m = state.materials.find((x) => x.id === id); if (!m) return;
  const ext = extOf(m.name);
  const kind = previewKind(ext);
  const { data, error } = await client.storage.from("materials").createSignedUrl(m.storage_path, 600); // 10 minutes
  if (currentVersion !== sessionVersion) return;
  if (error || !data) { toastFn(l("Could not create a file link", "无法获取文件链接")); return; }
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
        <button class="btn btn-sm" data-pv="download">${ICON("download")}<span>${l("Download", "下载")}</span></button>
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
    catch { body.innerHTML = `<div style="${center}">${l("Content could not be loaded. Download the file to view it.", "无法加载内容，请下载查看。")}</div>`; return; }
    let mode = "rendered";
    const mdCss = "body{font:15px/1.7 -apple-system,system-ui,sans-serif;color:#222;background:#fff;padding:28px;max-width:820px;margin:0 auto}pre{background:#f4f4f4;padding:12px;border-radius:8px;overflow:auto}code{background:#f0f0f0;padding:2px 5px;border-radius:4px;font-family:ui-monospace,monospace}pre code{background:none;padding:0}h1,h2,h3{line-height:1.3}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}blockquote{border-left:3px solid #ccc;margin:0 0 1em;padding-left:14px;color:#555}a{color:#9c6a39}";
    const draw = () => {
      if (mode === "rendered") {
        const doc = `<!doctype html><meta charset="utf-8"><style>${mdCss}</style>${marked.parse(txt)}`;
        body.innerHTML = `<iframe sandbox="" style="${fill};background:#fff" srcdoc="${esc(doc)}"></iframe>`;
      } else {
        body.innerHTML = `<pre style="${preStyle}">${esc(txt)}</pre>`;
      }
      tools.innerHTML = `<button class="btn btn-sm" data-md="t">${mode === "rendered" ? l("View source", "查看源码") : l("View rendered", "查看渲染")}</button>`;
      tools.querySelector('[data-md="t"]').onclick = () => { mode = mode === "rendered" ? "source" : "rendered"; draw(); };
    };
    draw();
  } else if (kind === "text") {
    body.innerHTML = `<div style="${center}"><span class="spin"></span></div>`;
    try {
      const txt = await (await fetch(url)).text();
      body.innerHTML = `<pre style="${preStyle}">${esc(txt.slice(0, 200000))}</pre>`;
    } catch {
      body.innerHTML = `<div style="${center}">${l("Text could not be loaded. Download the file to view it.", "无法加载文本内容，请下载查看。")}</div>`;
    }
  } else if (kind === "office") {
    body.innerHTML = `<div style="${center}">
      <div>
        <div style="font-weight:600;color:var(--ink);margin-bottom:6px">${esc(ext.toUpperCase())} ${l("file", "文件")}</div>
        <p style="margin-bottom:16px;max-width:360px">${l("The browser cannot preview this format directly. Microsoft Online Viewer sends a temporary copy to Microsoft, or you can download it instead.", "浏览器无法原生预览此格式。Microsoft 在线预览会把临时副本发送至微软；你也可以直接下载。")}</p>
        <div class="row gap-8" style="justify-content:center">
          <button class="btn btn-primary btn-sm" data-pv="office">${l("Use Microsoft Online Viewer", "使用 Microsoft 在线预览")}</button>
          <button class="btn btn-sm" data-pv="dl2">${l("Download", "下载查看")}</button>
        </div>
      </div></div>`;
    body.querySelector('[data-pv="dl2"]').onclick = () => downloadMaterial(id);
    body.querySelector('[data-pv="office"]').onclick = () => {
      const v = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
      body.innerHTML = `<iframe src="${v}" style="${fill}"></iframe>`;
    };
  } else {
    body.innerHTML = `<div style="${center}">${l("Inline preview is not available for this format. Download the file to view it.", "此格式暂不支持内嵌预览，请下载查看。")}</div>`;
  }
}
