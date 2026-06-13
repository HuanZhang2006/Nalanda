/* ============================================================
   Nalanda — app shell, routing, interactions
   ============================================================ */
const S = window.S = {
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
  document.getElementById("app").innerHTML = `
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
        <button class="icon-btn">${ICON("bell")}</button>
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
  document.getElementById("app").addEventListener("click", onClick);
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
window.addEventListener("resize", ()=>{ if(S.route==="note"||S.route==="create") drawEdges(); });

/* ---------- boot is called from inline script after all view files load ---------- */
function boot(){
  initTheme();
  renderShell();
  go("home");
}
window.boot = boot;
