// @ts-nocheck
import { DB } from "./data";
import { ICON } from "./icons";
import { initMaterials, mountMaterials } from "./materials";
import { initNotifications, openNotifications, refreshNotifBadge } from "./notifications";
import { initFeedback, mountFeedback } from "./feedback";
import { initProfile, mountProfile, syncShellUser } from "./profile";

const VIEWS: any = {};
let _root: any = null;
let _opts: any = {};
let _onResize: any = null;

/* ============================================================
   Nalanda — app shell, routing, interactions
   ============================================================ */
const S = {
  route: "home",
  noteId: "n1",
  noteTab: "list",
  postId: "p1",
  course: "all",
  marketFilter: "All",
  quiz: {},        // qIndex -> chosen
  genSel: ["list","quiz"],
  rail: false,
};

const NAV = [
  { sect:"Workspace" },
  { id:"home", label:"Home", icon:"home" },
  { id:"notes", label:"My Notes", icon:"notes", badge:"5" },
  { id:"materials", label:"Materials", icon:"folder" },
  { id:"schedule", label:"Schedule", icon:"calendar" },
  { sect:"Discover" },
  { id:"market", label:"Note Market", icon:"market" },
  { id:"community", label:"Community", icon:"users" },
  { sect:"You" },
  { id:"profile", label:"Profile & Growth", icon:"chart" },
  { id:"feedback", label:"Feedback", icon:"feedback" },
];

const ROUTE_OF = { home:"home", notes:"notes", note:"notes", create:"notes",
  materials:"materials", schedule:"schedule", market:"market",
  community:"community", post:"community", profile:"profile", feedback:"feedback" };

/* ---------- theme ---------- */
function initTheme(){
  let t = localStorage.getItem("nalanda-theme");
  if(!t){ t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  setTheme(t);
}
function setTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("nalanda-theme", t);
  const tb = document.getElementById("themeBtn");
  if(tb) tb.innerHTML = ICON(t==="dark" ? "sun" : "moon");
}
function toggleTheme(){
  setTheme(document.documentElement.getAttribute("data-theme")==="dark" ? "light" : "dark");
}

/* ---------- shell ---------- */
function renderShell(){
  _root.innerHTML = `
    <aside class="side">
      <div class="side-top">
        <div class="brand">
          <div class="brand-mark">${ICON("notes")}</div>
          <div>
            <div class="brand-name">Nalanda</div>
            <div class="brand-sub">Learn · Create · Share</div>
          </div>
        </div>
      </div>
      <nav class="nav" id="nav"></nav>
      <div class="side-foot">
        <div class="uchip" data-go="profile">
          <div class="avatar" style="background:${DB.user.color}">${DB.user.initials}</div>
          <div class="uchip-meta fill">
            <div class="uchip-name">${DB.user.name}</div>
            <div class="uchip-sub">Lv ${DB.user.level} · ${DB.user.levelName} · ${fmt(DB.user.credits)} cr</div>
          </div>
        </div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn" id="railBtn" title="Toggle sidebar">${ICON("list")}</button>
        <label class="search">
          ${ICON("search")}
          <input placeholder="Search notes, materials, courses, people…" id="globalSearch"/>
        </label>
        <div class="topbar-spacer"></div>
        <button class="btn btn-primary btn-sm" data-go="create">${ICON("sparkles")}<span>Create</span></button>
        <button class="icon-btn" id="themeBtn">${ICON("moon")}</button>
        <button class="icon-btn" id="bellBtn" data-act="notifications" title="通知" style="position:relative">${ICON("bell")}<span id="notif-badge" style="display:none;position:absolute;top:2px;right:2px;min-width:15px;height:15px;padding:0 4px;border-radius:9px;background:var(--accent);color:var(--on-accent);font-size:10px;font-weight:700;line-height:15px;text-align:center">0</span></button>
        <button class="icon-btn" data-act="signOut" title="退出登录">${ICON("logout")}</button>
        <div class="avatar" style="background:${DB.user.color};width:34px;height:34px" data-go="profile">${DB.user.initials}</div>
      </header>
      <div class="content" id="content"></div>
    </div>`;

  renderNav();
  document.getElementById("themeBtn").addEventListener("click", toggleTheme);
  setTheme(document.documentElement.getAttribute("data-theme")||"light");
  document.getElementById("railBtn").addEventListener("click", ()=>{
    S.rail = !S.rail;
    document.documentElement.setAttribute("data-rail", S.rail ? "1":"0");
  });

  // event delegation
  _root.addEventListener("click", onClick);
}

function renderNav(){
  document.getElementById("nav").innerHTML = NAV.map(n=>{
    if(n.sect) return `<div class="nav-sect">${n.sect}</div>`;
    const active = ROUTE_OF[S.route]===n.id ? "active" : "";
    return `<a class="nav-item ${active}" data-go="${n.id}" title="${n.label}">
      ${ICON(n.icon)}<span class="nav-label">${n.label}</span>
      ${n.badge?`<span class="nav-badge">${n.badge}</span>`:""}</a>`;
  }).join("");
}

/* ---------- router ---------- */
function go(route, params){
  S.route = route;
  if(params) Object.assign(S, params);
  renderNav();
  const c = document.getElementById("content");
  c.scrollTop = 0;
  c.innerHTML = `<div class="view-enter">${VIEWS[route] ? VIEWS[route]() : VIEWS.home()}</div>`;
  if(route==="note" || route==="create"){ requestAnimationFrame(drawEdges); }
  if(route==="materials"){ requestAnimationFrame(()=>{ const el=document.getElementById("mat-root"); if(el) mountMaterials(el); }); }
  if(route==="feedback"){ requestAnimationFrame(()=>{ const el=document.getElementById("fb-root"); if(el) mountFeedback(el); }); }
  if(route==="profile"){ requestAnimationFrame(()=>{ const el=document.getElementById("profile-root"); if(el) mountProfile(el); }); }
}

/* ---------- click delegation ---------- */
function onClick(e){
  const t = e.target.closest("[data-go],[data-act]");
  if(!t) return;
  if(t.dataset.go){ go(t.dataset.go, dataParams(t)); return; }
  const act = t.dataset.act;
  ACTIONS[act] && ACTIONS[act](t, e);
}
function dataParams(t){
  const p = {};
  if(t.dataset.note) p.noteId = t.dataset.note;
  if(t.dataset.post) p.postId = t.dataset.post;
  if(t.dataset.tab) p.noteTab = t.dataset.tab;
  return p;
}

/* ---------- actions ---------- */
const ACTIONS = {
  noteTab(t){ S.noteTab = t.dataset.tab; go("note"); },
  answer(t){
    const qi = +t.dataset.q, oi = +t.dataset.o;
    if(S.quiz[qi]!=null) return;
    S.quiz[qi] = oi;
    go("note");
  },
  resetQuiz(){ S.quiz = {}; go("note"); },
  genToggle(t){
    const k = t.dataset.gen;
    const i = S.genSel.indexOf(k);
    if(i>=0) S.genSel.splice(i,1); else S.genSel.push(k);
    go("create");
  },
  runGen(){ toast("Generating from your material…"); setTimeout(()=>{ toast("Note created — added to My Notes", "check"); go("note",{noteId:"n1",noteTab:"list"}); }, 900); },
  marketFilter(t){ S.marketFilter = t.dataset.f; go("market"); },
  openBuy(t){ openModal(buyModal(t.dataset.k)); },
  confirmBuy(t){ closeModal(); toast("Added to your notes — "+fmt(+t.dataset.price)+" credits spent","check"); },
  closeModal(){ closeModal(); },
  like(t){ t.classList.toggle("liked"); const s=t.querySelector("span"); if(s){ let n=+s.dataset.n; n+=t.classList.contains("liked")?1:-1; s.dataset.n=n; s.textContent=fmt(n);} t.style.color = t.classList.contains("liked")?"var(--pink)":""; },
  save(t){ t.classList.toggle("liked"); t.style.color = t.classList.contains("liked")?"var(--accent)":""; toast(t.classList.contains("liked")?"Saved":"Removed"); },
  toast(t){ toast(t.dataset.msg || "Done","check"); },
  toggleTask(t){ t.classList.toggle("done"); },
  signOut(){ if(_opts && _opts.onSignOut) _opts.onSignOut(); },
  notifications(){ openNotifications(); },
};

/* ---------- modal + toast ---------- */
function openModal(html){
  const s = document.createElement("div"); s.className="scrim"; s.id="scrim";
  s.innerHTML = html;
  s.addEventListener("click", e=>{ if(e.target===s) closeModal(); });
  document.body.appendChild(s);
}
function closeModal(){ const s=document.getElementById("scrim"); if(s) s.remove(); }
let toastTimer;
function toast(msg, icon){
  document.getElementById("toast")?.remove();
  const d = document.createElement("div"); d.className="toast"; d.id="toast";
  d.innerHTML = (icon?ICON(icon):"") + `<span>${msg}</span>`;
  document.body.appendChild(d);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>d.remove(), 2400);
}

/* ---------- helpers ---------- */
function fmt(n){ return n.toLocaleString("en-US"); }
function courseById(id){ return DB.courses.find(c=>c.id===id); }
function av(initials, color, size){ return `<div class="av" style="background:${color};width:${size}px;height:${size}px;font-size:${Math.round(size*0.4)}px">${initials}</div>`; }

/* ---------- knowledge graph edges (SVG overlay) ---------- */
function drawEdges(){
  const wrap = document.getElementById("graphWrap");
  if(!wrap) return;
  const svg = wrap.querySelector("svg.edges");
  if(!svg) return;
  const r = wrap.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
  const pos = {};
  DB.graph.nodes.forEach(n=> pos[n.id] = { x: n.x/100*r.width, y: n.y/100*r.height });
  svg.innerHTML = DB.graph.edges.map(([a,b])=>{
    const p=pos[a], q=pos[b];
    return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" />`;
  }).join("");
}
_onResize = ()=>{ if(S.route==="note"||S.route==="create") drawEdges(); };
window.addEventListener("resize", _onResize);

/* ---------- boot is called from inline script after all view files load ---------- */
function boot(){
  initTheme();
  renderShell();
  go("home");
}
export function mountNalanda(container, opts){
  _root = container; _opts = opts || {};
  if (_opts.user && _opts.user.email) {
    const nm = String(_opts.user.email).split("@")[0];
    DB.user.email = _opts.user.email;
    DB.user.name = nm;
    DB.user.handle = "@" + nm;
    DB.user.initials = nm.slice(0, 2).toUpperCase();
  }
  initMaterials(_opts.supabase, _opts.user, toast);
  initNotifications(_opts.supabase, _opts.user, toast);
  initFeedback(_opts.supabase, _opts.user, toast);
  initProfile(_opts.supabase, _opts.user, toast);
  initTheme();
  renderShell();
  go("home");
  refreshNotifBadge();
  syncShellUser();
  return () => {
    try { if (_root) _root.innerHTML = ""; } catch (e) {}
    if (_onResize) window.removeEventListener("resize", _onResize);
  };
}
/* ============================================================
   Nalanda — core views: home, notes, note detail, create
   ============================================================ */


/* ---------------- HOME ---------------- */
VIEWS.home = function(){
  const u = DB.user;
  const stats = [
    { ic:"clock", n:u.stats.hours+"h", l:"Studied this term" },
    { ic:"notes", n:DB.notes.length, l:"Notes in library" },
    { ic:"coin", n:fmt(u.credits), l:"Credits balance" },
    { ic:"flame", n:"30", l:"Day streak" },
  ];
  return `<div class="wrap">
    <section class="hero">
      <div class="hero-glyph">${ICON("graph")}</div>
      <div class="eyebrow">Good morning, ${u.name.split(" ")[0]}</div>
      <h1 class="serif">Turn this week's chaos into one clean body of knowledge.</h1>
      <p class="page-sub" style="margin-top:12px">You have <b>3 tasks</b> due before Friday and <b>2 new materials</b> waiting to become notes.</p>
      <div class="row gap-12 mt-24 wrap-flex">
        <button class="btn btn-primary btn-lg" data-go="create">${ICON("sparkles")}<span>Create a note with AI</span></button>
        <button class="btn btn-lg" data-go="schedule">${ICON("calendar")}<span>View study plan</span></button>
      </div>
    </section>

    <div class="grid g-4" style="margin-top:22px">
      ${stats.map(s=>`<div class="stat"><div class="stat-ic">${ICON(s.ic)}</div>
        <div class="stat-n">${s.n}</div><div class="stat-l">${s.l}</div></div>`).join("")}
    </div>

    <div class="sec-h"><h2 class="serif">Continue learning</h2><a class="btn btn-ghost btn-sm" data-go="materials">All courses ${ICON("chevright")}</a></div>
    <div class="grid g-2">
      ${DB.courses.slice(0,4).map(c=>`
        <div class="card card-pad hoverable" data-go="materials" style="cursor:pointer">
          <div class="row between">
            <div class="row gap-12">
              <div class="av" style="background:${c.color};width:42px;height:42px;border-radius:12px;font-size:13px">${c.code.split(" ")[0]}</div>
              <div><div style="font-weight:700;font-size:14px">${c.name}</div>
                <div class="faint" style="font-size:12px">${c.code} · ${c.instr} · ${c.mats} materials</div></div>
            </div>
            <span class="chip chip-outline">${c.progress}%</span>
          </div>
          <div class="bar mt-16"><i style="width:${c.progress}%"></i></div>
        </div>`).join("")}
    </div>

    <div class="grid" style="grid-template-columns:1.4fr 1fr;margin-top:30px;align-items:start">
      <div>
        <div class="sec-h" style="margin-top:0"><h2 class="serif">Recent notes</h2><a class="btn btn-ghost btn-sm" data-go="notes">Open library ${ICON("chevright")}</a></div>
        <div class="card">
          ${DB.notes.slice(0,4).map(n=>`
            <div class="list-row" data-go="note" data-note="${n.id}" style="cursor:pointer;padding-left:16px;padding-right:16px">
              <div class="av" style="background:${n.grad};width:40px;height:40px;border-radius:11px">${ICON(n.kind.includes("Quiz")?"quiz":n.kind.includes("Graph")?"graph":n.kind.includes("Exam")?"exam":"list")}</div>
              <div class="fill"><div style="font-weight:650;font-size:13.5px">${n.title}</div>
                <div class="faint" style="font-size:12px">${n.courseName} · ${n.kind} · ${n.updated}</div></div>
              ${ICON("chevright","",)}
            </div>`).join("")}
        </div>
      </div>
      <div>
        <div class="sec-h" style="margin-top:0"><h2 class="serif">Activity</h2><span class="chip chip-accent">${ICON("coin")} +405 today</span></div>
        <div class="card card-pad">
          ${DB.activity.map(a=>`
            <div class="row gap-12" style="padding:11px 0;border-bottom:1px solid var(--border-soft)">
              <div class="stat-ic" style="margin:0;width:32px;height:32px">${ICON(a.ic)}</div>
              <div class="fill"><div style="font-size:13px">${a.t}</div><div class="faint" style="font-size:11.5px">${a.time}</div></div>
              <span class="chip chip-accent">${a.cr}</span>
            </div>`).join("")}
        </div>
      </div>
    </div>
  </div>`;
};

/* ---------------- NOTES LIBRARY ---------------- */
VIEWS.notes = function(){
  const filters = [["all","All"]].concat(DB.courses.map(c=>[c.id,c.code]));
  const list = S.course==="all" ? DB.notes : DB.notes.filter(n=>n.course===S.course);
  return `<div class="wrap">
    <div class="page-head">
      <div><div class="eyebrow">Personal library</div><h1 class="page-title">My Notes</h1>
        <p class="page-sub">${DB.notes.length} notes · generated, hand-written, and added from the market.</p></div>
      <button class="btn btn-primary" data-go="create">${ICON("sparkles")}<span>New AI note</span></button>
    </div>
    <div class="row gap-8 wrap-flex" style="margin-bottom:22px">
      ${filters.map(([id,l])=>`<button class="chip ${S.course===id?'chip-accent':'chip-outline'}" data-act="setCourse" data-c="${id}">${l}</button>`).join("")}
    </div>
    <div class="grid g-3">
      ${list.map(noteCard).join("")}
      <div class="card hoverable" data-go="create" style="cursor:pointer;border-style:dashed;display:grid;place-items:center;min-height:210px;color:var(--ink-faint)">
        <div class="center"><div class="stat-ic" style="margin:0 auto 10px">${ICON("plus")}</div>
          <div style="font-weight:600;color:var(--ink-soft)">Create a new note</div>
          <div style="font-size:12px">From materials, with AI</div></div>
      </div>
    </div>
  </div>`;
};
function noteCard(n){
  const c = courseById(n.course);
  const ic = n.kind.includes("Quiz")?"quiz":n.kind.includes("Graph")?"graph":n.kind.includes("Exam")?"exam":n.kind.includes("Manual")?"edit":"list";
  return `<div class="card ncard hoverable" data-go="note" data-note="${n.id}" style="cursor:pointer">
    <div class="ncard-top" style="background:${n.grad}">
      <div style="position:absolute;top:11px;right:11px;color:#fff;opacity:.9">${ICON(ic)}</div>
      <span class="chip" style="background:rgba(255,255,255,.22);color:#fff;backdrop-filter:blur(4px)">${n.courseName}</span>
    </div>
    <div class="ncard-body">
      <div class="chip chip-tag" style="align-self:flex-start">${n.kind}</div>
      <h3 class="serif">${n.title}</h3>
      <p class="muted" style="font-size:12.5px;line-height:1.5">${n.desc}</p>
      <div class="ncard-foot">
        <span class="meta">${ICON("clock")}<span style="font-size:11.5px">${n.updated}</span></span>
        <span class="chip chip-outline">Open ${ICON("chevright")}</span>
      </div>
    </div>
  </div>`;
}

/* ---------------- NOTE DETAIL (core feature) ---------------- */
VIEWS.note = function(){
  const n = DB.notes.find(x=>x.id===S.noteId) || DB.notes[0];
  const tabs = [["list","Knowledge List","list"],["quiz","Interactive Quiz","quiz"],["graph","Knowledge Graph","graph"],["exam","Mock Exam","exam"]];
  return `<div class="wrap">
    <a class="btn btn-ghost btn-sm" data-go="notes" style="margin-bottom:18px">${ICON("chevleft")}<span>My Notes</span></a>
    <div class="page-head" style="margin-bottom:18px">
      <div>
        <div class="row gap-8" style="margin-bottom:10px"><span class="chip chip-accent">${ICON("sparkles")} AI-generated</span><span class="chip chip-tag">${n.courseName}</span></div>
        <h1 class="page-title serif">${n.title}</h1>
        <p class="meta mt-8">${ICON("file")}<span>From <b style="color:var(--ink-soft)">${n.source}</b></span><span class="dot"></span><span>Updated ${n.updated}</span></p>
      </div>
      <div class="row gap-8">
        <button class="btn btn-sm" data-act="toast" data-msg="Note shared to market">${ICON("market")}<span>Sell</span></button>
        <button class="btn btn-sm" data-act="toast" data-msg="Editing enabled">${ICON("edit")}<span>Edit</span></button>
        <button class="btn btn-sm btn-primary" data-act="toast" data-msg="Exported as PDF">${ICON("download")}<span>Export</span></button>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(([id,l,ic])=>`<button class="tab ${S.noteTab===id?'active':''}" data-act="noteTab" data-tab="${id}">${l}</button>`).join("")}
    </div>
    ${ ({list:tabList, quiz:tabQuiz, graph:tabGraph, exam:tabExam})[S.noteTab]() }
  </div>`;
};

function tabList(){
  return `<div class="grid" style="grid-template-columns:1fr 280px;align-items:start">
    <div class="card card-pad">
      <div class="row between" style="margin-bottom:6px">
        <h3 class="serif" style="font-size:18px">Structured knowledge</h3>
        <span class="chip chip-outline">${DB.knowledge.length} concepts</span>
      </div>
      <p class="muted" style="font-size:13px;margin-bottom:6px">Auto-extracted and ordered by dependency. Click any concept to edit.</p>
      ${DB.knowledge.map((k,i)=>`
        <div class="kitem">
          <div class="knum">${String(i+1).padStart(2,"0")}</div>
          <div class="fill">
            <h4 class="serif">${k.t}</h4>
            <p class="kdef">${k.d}</p>
            <div class="ktags">${k.tags.map(t=>`<span class="chip chip-tag">${t}</span>`).join("")}</div>
          </div>
        </div>`).join("")}
    </div>
    <aside class="card card-pad" style="position:sticky;top:8px">
      <div class="eyebrow">From this note</div>
      <h4 class="serif" style="font-size:15px;margin-bottom:12px">Generate more</h4>
      ${[["quiz","quiz","Practice quiz"],["graph","graph","Knowledge graph"],["exam","exam","Mock exam"]].map(([t,ic,l])=>`
        <button class="btn btn-sm" style="width:100%;justify-content:flex-start;margin-bottom:8px" data-act="noteTab" data-tab="${t}">${ICON(ic)}<span>${l}</span></button>`).join("")}
      <div class="divider"></div>
      <div class="eyebrow">Mastery</div>
      <div class="row between" style="font-size:13px;margin:8px 0 6px"><span class="muted">Concepts reviewed</span><b>4 / 6</b></div>
      <div class="bar"><i style="width:66%"></i></div>
    </aside>
  </div>`;
}

function tabQuiz(){
  const total = DB.quiz.length;
  const answered = Object.keys(S.quiz).length;
  const correct = Object.entries(S.quiz).filter(([qi,oi])=>DB.quiz[qi].ans===oi).length;
  return `<div class="grid" style="grid-template-columns:1fr 280px;align-items:start">
    <div>
      ${DB.quiz.map((q,qi)=>{
        const chosen = S.quiz[qi];
        const done = chosen!=null;
        return `<div class="quiz-q">
          <div class="row gap-8" style="margin-bottom:4px"><span class="knum">${qi+1}</span><span class="chip chip-tag">Single choice</span></div>
          <h4 class="serif" style="font-size:16px;margin:6px 0 4px">${q.q}</h4>
          ${q.opts.map((o,oi)=>{
            let cls=""; let mk = String.fromCharCode(65+oi);
            if(done){ if(oi===q.ans){cls="correct"; mk="✓";} else if(oi===chosen){cls="wrong"; mk="✕";} }
            return `<div class="opt ${cls}" ${done?'':`data-act="answer" data-q="${qi}" data-o="${oi}" style="cursor:pointer"`}>
              <span class="mk">${mk}</span><span>${o}</span></div>`;
          }).join("")}
          ${done?`<div class="card-2" style="background:var(--accent-tint);border-radius:10px;padding:11px 13px;margin-top:12px;font-size:13px"><b style="color:var(--accent)">Why:</b> <span class="muted">${q.why}</span></div>`:""}
        </div>`;
      }).join("")}
    </div>
    <aside class="card card-pad" style="position:sticky;top:8px">
      <div class="eyebrow">Session</div>
      <div class="lvl-ring" style="--p:${total?Math.round(answered/total*100):0};width:96px;height:96px;margin:10px auto">
        <div style="width:74px;height:74px"><div style="font-family:var(--font-serif);font-size:22px;font-weight:600">${correct}/${total}</div></div>
      </div>
      <div class="center muted" style="font-size:12.5px;margin-bottom:14px">${answered===total?`Score ${Math.round(correct/total*100)}% — well done`:`${answered} of ${total} answered`}</div>
      <button class="btn btn-sm" style="width:100%" data-act="resetQuiz">${ICON("clock")}<span>Restart quiz</span></button>
      <div class="divider"></div>
      <p class="faint" style="font-size:12px">Quiz auto-generated from 18 source questions. ${total} shown in practice mode.</p>
    </aside>
  </div>`;
}

function tabGraph(){
  return `<div class="grid" style="grid-template-columns:1fr 280px;align-items:start">
    <div class="graph-wrap" id="graphWrap" style="height:440px">
      <svg class="edges" style="position:absolute;inset:0;width:100%;height:100%;stroke:var(--accent-line);stroke-width:1.5;pointer-events:none;opacity:.7"></svg>
      ${DB.graph.nodes.map(n=>`<div class="gnode ${n.cls}" style="left:${n.x}%;top:${n.y}%">${n.label}</div>`).join("")}
    </div>
    <aside class="card card-pad" style="position:sticky;top:8px">
      <div class="eyebrow">Knowledge graph</div>
      <h4 class="serif" style="font-size:15px;margin-bottom:8px">8 concepts · 7 links</h4>
      <p class="muted" style="font-size:13px">Nodes are concepts; edges are dependencies extracted from your material. Hover to highlight, drag to rearrange.</p>
      <div class="divider"></div>
      <div class="row gap-8" style="font-size:12.5px;margin-bottom:7px"><span class="av" style="background:var(--accent);width:14px;height:14px"></span><span class="muted">Root concept</span></div>
      <div class="row gap-8" style="font-size:12.5px"><span class="av" style="background:transparent;width:14px;height:14px;border:1.5px solid var(--accent-line)"></span><span class="muted">Sub-concept</span></div>
      <button class="btn btn-sm mt-16" style="width:100%" data-act="toast" data-msg="Graph exported as PNG">${ICON("download")}<span>Export graph</span></button>
    </aside>
  </div>`;
}

function tabExam(){
  const e = DB.exam;
  return `<div class="grid" style="grid-template-columns:1fr 280px;align-items:start">
    <div class="exam-paper">
      <div class="exam-head">
        <div class="eyebrow" style="margin-bottom:6px">Nalanda · Generated paper</div>
        <h2 class="serif" style="font-size:22px">${e.title}</h2>
        <p class="faint" style="font-size:12.5px;margin-top:6px">${e.meta}</p>
      </div>
      ${e.sections.map(sec=>`
        <div class="exam-sec">
          <div class="exam-sec-h">${sec.name}</div>
          ${sec.qs.map((q,i)=>`<div class="exam-q"><b>${i+1}.</b><span>${q}</span></div>`).join("")}
        </div>`).join("")}
    </div>
    <aside class="card card-pad" style="position:sticky;top:8px">
      <div class="eyebrow">Mock exam</div>
      <h4 class="serif" style="font-size:15px;margin-bottom:8px">Exam-ready paper</h4>
      <p class="muted" style="font-size:13px">Difficulty calibrated to your course's past papers and the concepts in this note.</p>
      <div class="divider"></div>
      <div class="row between" style="font-size:13px;margin-bottom:8px"><span class="muted">Difficulty</span><span class="chip chip-accent">Hard</span></div>
      <div class="row between" style="font-size:13px"><span class="muted">Est. time</span><b>120 min</b></div>
      <button class="btn btn-sm btn-primary mt-16" style="width:100%" data-act="toast" data-msg="Timed attempt started">${ICON("play")}<span>Start timed attempt</span></button>
      <button class="btn btn-sm mt-8" style="width:100%" data-act="toast" data-msg="Exported as PDF">${ICON("download")}<span>Export PDF</span></button>
    </aside>
  </div>`;
}

/* ---------------- CREATE FLOW ---------------- */
VIEWS.create = function(){
  const gens = [
    { k:"list", ic:"list", t:"Knowledge list", d:"Structured, dependency-ordered concept breakdown" },
    { k:"quiz", ic:"quiz", t:"Interactive quiz", d:"Auto-graded practice questions with explanations" },
    { k:"graph", ic:"graph", t:"Knowledge graph", d:"Visual concept map of how ideas connect" },
    { k:"exam", ic:"exam", t:"Mock exam", d:"Full-length practice paper in your course's style" },
  ];
  return `<div class="wrap">
    <a class="btn btn-ghost btn-sm" data-go="notes" style="margin-bottom:18px">${ICON("chevleft")}<span>My Notes</span></a>
    <div class="eyebrow">AI creation</div>
    <h1 class="page-title serif">Create a note</h1>
    <p class="page-sub">Pick your source material, choose what to generate, and Nalanda builds it.</p>

    <div class="create-step mt-24">
      <div class="step-dot">1</div>
      <div class="fill">
        <h3 class="serif" style="font-size:17px;margin-bottom:3px">Choose source material</h3>
        <p class="muted" style="font-size:13px;margin-bottom:14px">From <b>COGS 210 · Foundations of Cognition</b></p>
        <div class="grid g-2">
          ${DB.materials.filter(m=>m.course==="c1").map((m,i)=>`
            <label class="gen-card ${i===0?'sel':''}" style="cursor:pointer">
              <span class="mat-ic">${ICON("file")}<span class="ftype ft-${m.type}" style="position:absolute;bottom:-6px">${m.type.toUpperCase()}</span></span>
              <div class="fill"><div style="font-weight:650;font-size:13.5px">${m.name}</div>
                <div class="faint" style="font-size:12px">${m.size} · ${m.pages} pages</div></div>
              <span class="mk" style="width:22px;height:22px;border-radius:6px;border:1.5px solid var(--border-strong);display:grid;place-items:center;color:var(--accent)">${i===0?ICON("check"):""}</span>
            </label>`).join("")}
        </div>
        <button class="btn btn-sm mt-12">${ICON("upload")}<span>Upload new material</span></button>
      </div>
    </div>

    <div class="create-step mt-24">
      <div class="step-dot">2</div>
      <div class="fill">
        <h3 class="serif" style="font-size:17px;margin-bottom:3px">What should Nalanda generate?</h3>
        <p class="muted" style="font-size:13px;margin-bottom:14px">Select one or more — they'll all live inside one note.</p>
        <div class="grid g-2">
          ${gens.map(g=>`
            <div class="gen-card ${S.genSel.includes(g.k)?'sel':''}" data-act="genToggle" data-gen="${g.k}" style="cursor:pointer">
              <div class="gen-ic">${ICON(g.ic)}</div>
              <div class="fill"><div style="font-weight:650;font-size:14px">${g.t}</div>
                <div class="muted" style="font-size:12.5px">${g.d}</div></div>
              <span class="mk" style="width:22px;height:22px;border-radius:6px;border:1.5px solid ${S.genSel.includes(g.k)?'var(--accent)':'var(--border-strong)'};display:grid;place-items:center;color:var(--accent);background:${S.genSel.includes(g.k)?'var(--accent-tint)':'transparent'}">${S.genSel.includes(g.k)?ICON("check"):""}</span>
            </div>`).join("")}
        </div>
      </div>
    </div>

    <div class="create-step mt-24">
      <div class="step-dot">3</div>
      <div class="fill">
        <h3 class="serif" style="font-size:17px;margin-bottom:3px">Tune & generate</h3>
        <p class="muted" style="font-size:13px;margin-bottom:14px">${S.genSel.length} output${S.genSel.length===1?'':'s'} selected.</p>
        <div class="card card-pad">
          <div class="row between wrap-flex gap-16">
            <div><div style="font-size:12px;font-weight:600;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Depth</div>
              <div class="row gap-6">${["Concise","Balanced","Exhaustive"].map((d,i)=>`<span class="chip ${i===1?'chip-accent':'chip-outline'}">${d}</span>`).join("")}</div></div>
            <div><div style="font-size:12px;font-weight:600;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Language</div>
              <div class="row gap-6"><span class="chip chip-accent">English</span><span class="chip chip-outline">中文</span></div></div>
            <div><div style="font-size:12px;font-weight:600;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Cost</div>
              <span class="chip chip-accent">${ICON("coin")} 25 credits</span></div>
          </div>
          <div class="divider"></div>
          <button class="btn btn-primary btn-lg" data-act="runGen" style="width:100%;justify-content:center">${ICON("sparkles")}<span>Generate note</span></button>
        </div>
      </div>
    </div>
  </div>`;
};

ACTIONS.setCourse = function(t){ S.course = t.dataset.c; go("notes"); };
/* ============================================================
   Nalanda — views: materials, market, community, profile,
   schedule, feedback  + buy modal
   ============================================================ */


/* ---------------- MATERIALS ---------------- */
VIEWS.materials = function(){
  const filters = [["all","All courses"]].concat(DB.courses.map(c=>[c.id, c.code]));
  const list = S.course==="all" ? DB.materials : DB.materials.filter(m=>m.course===S.course);
  return `<div class="wrap">
    <div class="page-head">
      <div><div class="eyebrow">Course library</div><h1 class="page-title">Materials</h1>
        <p class="page-sub">Upload, organise and preview learning materials. Each lives under its course and feeds your AI notes.</p></div>
      <button class="btn btn-primary" data-act="upload">${ICON("upload")}<span>Upload material</span></button>
    </div>
    <div class="row gap-8 wrap-flex" style="margin-bottom:18px">
      ${filters.map(([id,l])=>`<button class="chip ${S.course===id?'chip-accent':'chip-outline'}" data-act="setCourseM" data-c="${id}">${l}</button>`).join("")}
    </div>
    <div class="card card-pad" style="padding:10px">
      <div class="mat-row" style="border:0;color:var(--ink-faint);font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">
        <span style="width:40px">Type</span><span>Name</span><span class="nowrap">Course</span><span>Actions</span>
      </div>
      ${list.map(m=>{
        const c = courseById(m.course);
        return `<div class="mat-row">
          <div class="mat-ic">${ICON("file")}<span class="ftype ft-${m.type}" style="position:absolute;bottom:-7px">${m.type.toUpperCase()}</span></div>
          <div class="fill"><div style="font-weight:650;font-size:13.5px">${m.name}</div>
            <div class="faint" style="font-size:12px">${m.size} · ${m.pages} pages · ${m.date} · ${m.downloads} downloads</div></div>
          <span class="chip chip-outline nowrap" style="border-color:${c.color}55;color:${c.color}">${c.code}</span>
          <div class="row gap-6">
            <button class="icon-btn" data-act="toast" data-msg="Preview opened" title="Preview" style="width:32px;height:32px">${ICON("eye")}</button>
            <button class="icon-btn" data-act="toast" data-msg="Downloading…" title="Download" style="width:32px;height:32px">${ICON("download")}</button>
            <button class="btn btn-sm btn-primary" data-go="create">${ICON("sparkles")}<span>To note</span></button>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div class="card card-pad hoverable mt-16" data-act="upload" style="cursor:pointer;border-style:dashed;text-align:center;color:var(--ink-faint)">
      <div class="stat-ic" style="margin:0 auto 8px">${ICON("upload")}</div>
      <div style="font-weight:600;color:var(--ink-soft)">Drag files here or click to upload</div>
      <div style="font-size:12px">PDF · PPT · Word · Markdown · HTML · TXT</div>
    </div>
  </div>`;
};
ACTIONS.setCourseM = function(t){ S.course = t.dataset.c; go("materials"); };
ACTIONS.upload = function(){ toast("Upload — choose a course to file it under","upload"); };

/* ---------------- NOTE MARKET ---------------- */
VIEWS.market = function(){
  const cats = ["All","Free","Top rated","Sciences","CS & Math","Premium"];
  let list = DB.market.slice();
  if(S.marketFilter==="Free") list = list.filter(m=>m.free);
  if(S.marketFilter==="Top rated") list = list.slice().sort((a,b)=>b.rating-a.rating);
  if(S.marketFilter==="Premium") list = list.filter(m=>m.price>=110);
  return `<div class="wrap wrap-wide">
    <div class="page-head">
      <div><div class="eyebrow">Marketplace</div><h1 class="page-title">Note Market</h1>
        <p class="page-sub">Buy and sell exam-ready notes. Purchases drop straight into your library; creators earn credits.</p></div>
      <button class="btn btn-primary" data-act="toast" data-msg="Listing flow opened">${ICON("plus")}<span>Sell a note</span></button>
    </div>

    <div class="card card-pad" style="background:linear-gradient(120deg,var(--accent-tint),var(--card));border-color:var(--accent-line);margin-bottom:22px">
      <div class="row between wrap-flex gap-16">
        <div class="row gap-16">
          <div class="badge-medal" style="width:48px;height:48px;font-size:20px">${ICON("crown")}</div>
          <div><div class="eyebrow" style="margin-bottom:2px">Editor's pick · this week</div>
            <h3 class="serif" style="font-size:18px">Neuroanatomy Visual Notes — by Kenji T.</h3>
            <p class="muted" style="font-size:13px">5.0 ★ · 640 sold · hand-illustrated, clinically annotated.</p></div>
        </div>
        <button class="btn btn-primary" data-act="openBuy" data-k="k4">View note</button>
      </div>
    </div>

    <div class="row between wrap-flex" style="margin-bottom:16px">
      <div class="row gap-8 wrap-flex">
        ${cats.map(c=>`<button class="chip ${S.marketFilter===c?'chip-accent':'chip-outline'}" data-act="marketFilter" data-f="${c}">${c}</button>`).join("")}
      </div>
      <span class="chip chip-tag">${ICON("filter")} ${list.length} notes</span>
    </div>

    <div class="grid g-3">
      ${list.map(marketCard).join("")}
    </div>
  </div>`;
};
function marketCard(m){
  return `<div class="card ncard hoverable" style="cursor:pointer" data-act="openBuy" data-k="${m.id}">
    <div class="ncard-top" style="height:108px;background:${m.grad}">
      <div style="position:absolute;top:11px;right:11px">${m.free?`<span class="chip" style="background:rgba(255,255,255,.25);color:#fff">Free</span>`:`<span class="chip" style="background:rgba(255,255,255,.25);color:#fff">${ICON("coin")} ${m.price}</span>`}</div>
      <span class="chip" style="background:rgba(255,255,255,.2);color:#fff;backdrop-filter:blur(4px)">${m.course}</span>
    </div>
    <div class="ncard-body">
      <h3 class="serif">${m.title}</h3>
      <p class="muted" style="font-size:12.5px;line-height:1.5">${m.desc}</p>
      <div class="ktags">${m.tags.map(t=>`<span class="chip chip-tag">${t}</span>`).join("")}</div>
      <div class="ncard-foot" style="margin-top:12px">
        <div class="row gap-8">${av(m.ai,m.color,26)}<span class="faint" style="font-size:12px">${m.author}</span></div>
        <div class="row gap-12">
          <span class="rating">${ICON("star")}${m.rating}</span>
          <span class="price">${m.free?'<span class="cr">Free</span>':`<span class="cr">${m.price}</span> cr`}</span>
        </div>
      </div>
    </div>
  </div>`;
}
function buyModal(id){
  const m = DB.market.find(x=>x.id===id);
  return `<div class="modal">
    <div class="ncard-top" style="height:130px;border-radius:18px 18px 0 0;background:${m.grad};padding:18px">
      <button class="icon-btn" data-act="closeModal" style="position:absolute;top:12px;right:12px;color:#fff;background:rgba(255,255,255,.15)">${ICON("close")}</button>
      <span class="chip" style="background:rgba(255,255,255,.25);color:#fff">${m.course}</span>
    </div>
    <div class="modal-pad">
      <h2 class="serif" style="font-size:23px;margin-bottom:6px">${m.title}</h2>
      <div class="row gap-12 wrap-flex" style="margin-bottom:14px">
        <div class="row gap-8">${av(m.ai,m.color,28)}<span class="muted" style="font-size:13px">by <b style="color:var(--ink)">${m.author}</b></span></div>
        <span class="rating">${ICON("star")}${m.rating}</span>
        <span class="meta">${ICON("download")} ${fmt(m.sales)} sold</span>
      </div>
      <p class="muted" style="font-size:14px;line-height:1.6;margin-bottom:14px">${m.desc} Includes lifetime updates and is added directly to your personal note library on purchase.</p>
      <div class="row gap-8 wrap-flex" style="margin-bottom:18px">${m.tags.map(t=>`<span class="chip chip-tag">${t}</span>`).join("")}</div>
      <div class="card-2" style="background:var(--accent-tint);border-radius:12px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between">
        <div><div class="faint" style="font-size:12px">Price</div>
          <div class="price" style="font-size:24px">${m.free?'<span class="cr">Free</span>':`<span class="cr">${m.price}</span> credits`}</div></div>
        <button class="btn btn-primary btn-lg" data-act="confirmBuy" data-price="${m.price}">${ICON(m.free?"download":"coin")}<span>${m.free?'Add to library':'Buy & add to library'}</span></button>
      </div>
      <p class="faint center" style="font-size:11.5px;margin-top:12px">Your balance: ${fmt(DB.user.credits)} credits · Creator earns ${Math.round(m.price*0.7)} cr</p>
    </div>
  </div>`;
}

/* ---------------- COMMUNITY ---------------- */
VIEWS.community = function(){
  const cats = ["For you","Questions","Study methods","Note shares","Tips"];
  return `<div class="wrap wrap-wide">
    <div class="page-head">
      <div><div class="eyebrow">Community</div><h1 class="page-title">Learning feed</h1>
        <p class="page-sub">Share experiences, ask questions, and discover notes — filtered by your courses and university.</p></div>
      <button class="btn btn-primary" data-act="toast" data-msg="Composer opened">${ICON("plus")}<span>New post</span></button>
    </div>
    <div class="grid" style="grid-template-columns:1fr 300px;align-items:start">
      <div>
        <div class="row gap-8 wrap-flex" style="margin-bottom:16px">
          ${cats.map((c,i)=>`<button class="chip ${i===0?'chip-accent':'chip-outline'}">${c}</button>`).join("")}
        </div>
        <div class="card">
          ${DB.community.map(p=>postRow(p)).join("")}
        </div>
      </div>
      <aside class="col gap-16" style="position:sticky;top:8px">
        <div class="card card-pad">
          <div class="eyebrow">Trending in COGS 210</div>
          ${["Working memory vs short-term","Dual-task evidence thread","Best Baddeley diagram?"].map((t,i)=>`
            <div class="list-row" style="cursor:pointer;padding:9px 0"><span class="knum">${i+1}</span>
              <div class="fill" style="font-size:13px;font-weight:600">${t}</div></div>`).join("")}
        </div>
        <div class="card card-pad">
          <div class="eyebrow">Top creators</div>
          ${DB.market.slice(0,3).map(m=>`
            <div class="row gap-10" style="padding:8px 0">${av(m.ai,m.color,32)}
              <div class="fill"><div style="font-size:13px;font-weight:650">${m.author}</div>
                <div class="faint" style="font-size:11.5px">${fmt(m.sales)} sold</div></div>
              <button class="btn btn-sm">Follow</button></div>`).join("")}
        </div>
      </aside>
    </div>
  </div>`;
};
function postRow(p){
  return `<div class="post" data-go="post" data-post="${p.id}" style="cursor:pointer">
    ${av(p.ai,p.color,42)}
    <div class="fill">
      <div class="row gap-8 wrap-flex" style="margin-bottom:5px">
        <b style="font-size:13.5px">${p.author}</b>
        ${p.flair?`<span class="chip chip-accent" style="padding:2px 8px">${p.flair}</span>`:""}
        <span class="meta"><span>${p.university}</span><span class="dot"></span><span>${p.time}</span></span>
        <span class="chip chip-tag" style="margin-left:auto">${p.kind}</span>
      </div>
      <h3 class="serif" style="font-size:17px;margin-bottom:5px">${p.title}</h3>
      <p class="muted" style="font-size:13.5px;line-height:1.55">${p.body}</p>
      <div class="row gap-6 wrap-flex mt-8">${p.tags.map(t=>`<span class="chip chip-tag">#${t}</span>`).join("")}</div>
      <div class="post-actions">
        <span class="pa" data-act="like" onclick="event.stopPropagation()">${ICON("heart")}<span data-n="${p.likes}">${fmt(p.likes)}</span></span>
        <span class="pa">${ICON("comment")}<span>${p.comments}</span></span>
        <span class="pa" data-act="save" onclick="event.stopPropagation()">${ICON("bookmark")}<span>${p.saves}</span></span>
      </div>
    </div>
  </div>`;
}

VIEWS.post = function(){
  const p = DB.community.find(x=>x.id===S.postId) || DB.community[0];
  return `<div class="wrap">
    <a class="btn btn-ghost btn-sm" data-go="community" style="margin-bottom:18px">${ICON("chevleft")}<span>Feed</span></a>
    <div class="card card-pad">
      <div class="row gap-12" style="margin-bottom:14px">${av(p.ai,p.color,46)}
        <div><div class="row gap-8"><b style="font-size:15px">${p.author}</b>${p.flair?`<span class="chip chip-accent">${p.flair}</span>`:""}</div>
          <div class="meta">${p.university}<span class="dot"></span>${p.time} ago<span class="dot"></span>${p.kind}</div></div>
      </div>
      <h1 class="serif" style="font-size:26px;margin-bottom:12px">${p.title}</h1>
      <p style="font-size:15px;line-height:1.7;color:var(--ink-soft)">${p.body} The trick is consistency — I review the graph for ten minutes every morning before lectures, and let the AI quiz fill the gaps it flags. Three weeks in, recall is night and day.</p>
      <div class="row gap-6 wrap-flex mt-16">${p.tags.map(t=>`<span class="chip chip-tag">#${t}</span>`).join("")}</div>
      <div class="divider"></div>
      <div class="post-actions" style="font-size:13.5px">
        <span class="pa" data-act="like">${ICON("heart")}<span data-n="${p.likes}">${fmt(p.likes)}</span> likes</span>
        <span class="pa">${ICON("comment")}${p.comments} comments</span>
        <span class="pa" data-act="save">${ICON("bookmark")}Save</span>
      </div>
    </div>
    <h3 class="serif mt-24" style="font-size:18px;margin-bottom:12px">${p.comments} comments</h3>
    <div class="card">
      <div class="card-pad" style="padding-bottom:0">
        <div class="row gap-10">${av(DB.user.initials,DB.user.color,34)}
          <input class="search" style="flex:1;background:var(--card-2)" placeholder="Add a comment…"/>
          <button class="btn btn-sm btn-primary" data-act="toast" data-msg="Comment posted">Post</button></div>
        <div class="divider"></div>
      </div>
      ${DB.comments.map(c=>`
        <div class="post" style="padding-top:14px;padding-bottom:14px">${av(c.ai,c.color,36)}
          <div class="fill"><div class="row gap-8"><b style="font-size:13px">${c.author}</b><span class="faint" style="font-size:11.5px">${c.time} ago</span></div>
            <p class="muted" style="font-size:13.5px;margin-top:3px">${c.body}</p>
            <div class="post-actions" style="margin-top:8px"><span class="pa" data-act="like">${ICON("heart")}<span data-n="${c.likes}">${c.likes}</span></span><span class="pa">Reply</span></div>
          </div></div>`).join("")}
    </div>
  </div>`;
};

/* ---------------- PROFILE & GROWTH ---------------- */
VIEWS.profile = function(){
  const u = DB.user;
  const stats = [
    ["hours","Hours studied",u.stats.hours],["notes","Notes created",DB.notes.length],
    ["folder","Materials uploaded",u.stats.uploads],["download","Downloads",u.stats.downloads],
    ["market","Notes sold",u.stats.sold],["users","Friends invited",u.stats.invites],
  ];
  return `<div class="wrap wrap-wide">
    <div class="card card-pad" style="background:linear-gradient(120deg,var(--accent-tint),var(--card));border-color:var(--accent-line);margin-bottom:24px">
      <div class="row between wrap-flex gap-20">
        <div class="row gap-16">
          <div class="avatar" style="background:${u.color};width:72px;height:72px;font-size:28px">${u.initials}</div>
          <div>
            <div class="row gap-8"><h1 class="serif" style="font-size:26px">${u.name}</h1>${u.vip?`<span class="chip chip-accent">${ICON("crown")} VIP</span>`:""}</div>
            <p class="muted" style="font-size:13.5px">${u.handle} · ${u.major} · ${u.year}</p>
            <p class="faint" style="font-size:12.5px">${u.university}</p>
          </div>
        </div>
        <div class="row gap-24">
          <div class="center"><div class="lvl-ring" style="--p:${u.levelProgress}">
            <div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Level</div>
              <div style="font-family:var(--font-serif);font-size:30px;font-weight:600">${u.level}</div>
              <div style="font-size:11px;color:var(--accent);font-weight:600">${u.levelName}</div></div></div>
            <div class="faint center" style="font-size:11.5px;margin-top:8px">${u.levelProgress}% to ${u.nextLevel}</div>
          </div>
          <div class="center" style="align-self:center">
            <div class="stat-ic" style="margin:0 auto 8px;width:38px;height:38px">${ICON("coin")}</div>
            <div class="stat-n" style="font-size:30px">${fmt(u.credits)}</div>
            <div class="stat-l">Credits</div>
            <button class="btn btn-sm btn-primary mt-8" data-act="toast" data-msg="Top-up opened">Top up</button>
          </div>
        </div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start;gap:24px">
      <div>
        <div class="sec-h" style="margin-top:0"><h2 class="serif" style="font-size:18px">Your stats</h2></div>
        <div class="grid g-3">
          ${stats.map(([ic,l,n])=>`<div class="stat"><div class="stat-ic">${ICON(ic)}</div><div class="stat-n" style="font-size:22px">${fmt(n)}</div><div class="stat-l">${l}</div></div>`).join("")}
        </div>
        <div class="card card-pad mt-16">
          <div class="row between" style="margin-bottom:10px"><h3 class="serif" style="font-size:16px">Creator earnings</h3><span class="chip chip-accent">${ICON("coin")} +${fmt(u.stats.earned)} all-time</span></div>
          ${[["Working Memory — Full Breakdown",360,18],["Attention & Filtering Theories",210,12],["STAT 230 quiz pack",140,7]].map(([t,cr,s])=>`
            <div class="list-row" style="padding:10px 0"><div class="fill"><div style="font-size:13.5px;font-weight:600">${t}</div><div class="faint" style="font-size:12px">${s} sales</div></div><span class="price"><span class="cr">${cr}</span> cr</span></div>`).join("")}
        </div>
      </div>
      <div>
        <div class="sec-h" style="margin-top:0"><h2 class="serif" style="font-size:18px">Badges</h2><span class="faint" style="font-size:12.5px">${DB.badges.filter(b=>b.got).length}/${DB.badges.length} earned</span></div>
        <div class="grid g-3">
          ${DB.badges.map(b=>`<div class="badge-tile ${b.got?'':'locked'}">
            <div class="badge-medal">${b.got?b.icon:ICON("lock")}</div>
            <div style="font-weight:650;font-size:13px">${b.name}</div>
            <div class="faint" style="font-size:11px;margin-top:2px">${b.desc}</div></div>`).join("")}
        </div>
        <div class="card card-pad mt-16" style="background:var(--accent-tint);border-color:var(--accent-line)">
          <div class="row gap-12"><div class="stat-ic" style="margin:0">${ICON("gift")}</div>
            <div class="fill"><div style="font-weight:700;font-size:14px">Redeem credits</div><div class="muted" style="font-size:12.5px">Trade credits for VIP, official courses or badges.</div></div>
            <button class="btn btn-sm btn-primary" data-act="toast" data-msg="Rewards store opened">Open</button></div>
        </div>
      </div>
    </div>
  </div>`;
};

/* ---------------- SCHEDULE ---------------- */
VIEWS.schedule = function(){
  const sc = DB.schedule;
  const total = Object.values(sc.tasks).flat().length;
  const done = Object.values(sc.tasks).flat().filter(t=>t.done).length;
  return `<div class="wrap wrap-wide">
    <div class="page-head">
      <div><div class="eyebrow">Study plan</div><h1 class="page-title">This week</h1>
        <p class="page-sub">Tasks auto-assigned from your courses, materials and progress — adjusting as you complete them.</p></div>
      <button class="btn btn-primary" data-act="toast" data-msg="Plan regenerated from your progress">${ICON("sparkles")}<span>Re-plan with AI</span></button>
    </div>
    <div class="card card-pad" style="margin-bottom:20px">
      <div class="row between" style="margin-bottom:10px"><b style="font-size:14px">Weekly progress</b><span class="muted" style="font-size:13px">${done} of ${total} tasks done</span></div>
      <div class="bar"><i style="width:${Math.round(done/total*100)}%"></i></div>
    </div>
    <div class="grid g-5" style="grid-template-columns:repeat(5,1fr)">
      ${sc.days.map((d,i)=>`
        <div class="day-col">
          <div class="row between" style="margin-bottom:4px"><b style="font-size:13px">${d}</b><span class="faint" style="font-size:11px">${10+i}</span></div>
          ${(sc.tasks[d]||[]).map(t=>`<div class="task ${t.done?'done':''}" data-act="toggleTask" style="cursor:pointer">${t.t}</div>`).join("") || `<div class="faint" style="font-size:11.5px;padding-top:6px">No tasks</div>`}
        </div>`).join("")}
    </div>
    <div class="grid g-2 mt-24">
      <div class="card card-pad"><div class="row gap-12"><div class="stat-ic" style="margin:0">${ICON("exam")}</div>
        <div class="fill"><div style="font-weight:700;font-size:14px">Exam countdown · COGS 210 Final</div><div class="muted" style="font-size:12.5px">In 12 days · revision plan 38% complete</div></div></div>
        <div class="bar mt-12"><i style="width:38%"></i></div></div>
      <div class="card card-pad"><div class="row gap-12"><div class="stat-ic" style="margin:0">${ICON("flame")}</div>
        <div class="fill"><div style="font-weight:700;font-size:14px">30-day streak</div><div class="muted" style="font-size:12.5px">Keep it up — study today to reach 31.</div></div>
        <span class="chip chip-accent">${ICON("coin")} +5/day</span></div></div>
    </div>
  </div>`;
};

/* ---------------- FEEDBACK ---------------- */
VIEWS.feedback = function(){
  const cats = ["Bug","Feature request","Content issue","Payment","Creator support"];
  const tickets = [
    ["#1042","Quiz generation timed out on large PDF","In progress","warn"],
    ["#1031","Add LaTeX support in knowledge lists","Planned","info"],
    ["#0998","Refund for duplicate note purchase","Resolved","good"],
  ];
  return `<div class="wrap">
    <div class="eyebrow">Support</div><h1 class="page-title">Feedback</h1>
    <p class="page-sub">Tell us what's broken or what you'd love to see. Reports can link a note, order, course or material.</p>
    <div class="grid" style="grid-template-columns:1fr 320px;align-items:start;margin-top:22px">
      <div class="card card-pad">
        <h3 class="serif" style="font-size:17px;margin-bottom:14px">Submit feedback</h3>
        <div style="font-size:12px;font-weight:600;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Category</div>
        <div class="row gap-6 wrap-flex" style="margin-bottom:16px">${cats.map((c,i)=>`<span class="chip ${i===0?'chip-accent':'chip-outline'}">${c}</span>`).join("")}</div>
        <input class="search" style="background:var(--card-2);margin-bottom:12px;width:100%" placeholder="Short summary"/>
        <textarea class="search" style="background:var(--card-2);width:100%;min-height:120px;align-items:flex-start" placeholder="Describe what happened, and link a note or order if relevant…"></textarea>
        <div class="row between mt-16"><span class="chip chip-tag">${ICON("file")} Attach material</span>
          <button class="btn btn-primary" data-act="toast" data-msg="Feedback submitted — ticket #1043 created">Submit</button></div>
      </div>
      <div class="card card-pad">
        <h3 class="serif" style="font-size:16px;margin-bottom:12px">Your tickets</h3>
        ${tickets.map(([id,t,st,col])=>`<div style="padding:11px 0;border-bottom:1px solid var(--border-soft)">
          <div class="row between"><span class="mono faint" style="font-size:12px">${id}</span>
            <span class="chip" style="background:color-mix(in srgb,var(--${col}) 16%,var(--card));color:var(--${col})">${st}</span></div>
          <div style="font-size:13px;font-weight:600;margin-top:4px">${t}</div></div>`).join("")}
      </div>
    </div>
  </div>`;
};

VIEWS.materials = () => '<div id="mat-root"></div>';
VIEWS.feedback = () => '<div id="fb-root"></div>';
VIEWS.profile = () => '<div id="profile-root"></div>';
