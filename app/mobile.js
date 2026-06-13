/* ============================================================
   Nalanda mobile — screens & interactions (reuses DB, ICON, fmt)
   ============================================================ */
const M = { screen:"home", noteId:"n1", noteTab:"list", postId:"p1", quiz:{}, genSel:["list","quiz"] };
function fmt(n){ return n.toLocaleString("en-US"); }

const TABS = [["home","Home","home"],["notes","Notes","notes"],["__fab","",""],["market","Market","market"],["community","Feed","users"]];
const TABROOT = { home:"home", notes:"notes", note:"notes", create:"notes", market:"market", community:"community", post:"community", profile:"home" };

function mInitTheme(){
  let t = localStorage.getItem("nalanda-theme");
  if(!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
}
function mTheme(){
  const t = document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("nalanda-theme", t);
  mRender();
}

function mGo(s, p){ M.screen=s; if(p) Object.assign(M,p); mRender(); }

function mTopbar(){
  const back = `<button class="m-back" data-mact="back">${ICON("chevleft")}</button>`;
  const themeBtn = `<button class="m-back" data-mact="theme" style="margin-left:auto">${ICON(document.documentElement.getAttribute("data-theme")==="dark"?"sun":"moon")}</button>`;
  const avatar = `<div class="av" style="background:${DB.user.color};width:34px;height:34px" data-mgo="profile">${DB.user.initials}</div>`;
  switch(M.screen){
    case "home": return `<div class="m-top"><div class="brand-mark">${ICON("notes")}</div>
       <div class="fill"><h1 class="serif">Nalanda</h1></div>${themeBtn}${avatar}</div>`;
    case "notes": return `<div class="m-top bordered"><div class="fill"><h1 class="serif">My Notes</h1><div class="sub">${DB.notes.length} notes</div></div>${themeBtn}${avatar}</div>`;
    case "market": return `<div class="m-top bordered"><div class="fill"><h1 class="serif">Note Market</h1></div>${themeBtn}${avatar}</div>`;
    case "community": return `<div class="m-top bordered"><div class="fill"><h1 class="serif">Feed</h1></div>${themeBtn}${avatar}</div>`;
    case "profile": return `<div class="m-top bordered">${back}<div class="fill"><h1 class="serif">Profile</h1></div>${themeBtn}</div>`;
    case "note": return `<div class="m-top bordered">${back}<div class="fill"><div class="sub">${(DB.notes.find(n=>n.id===M.noteId)||{}).courseName||""}</div></div>${themeBtn}</div>`;
    case "create": return `<div class="m-top bordered">${back}<div class="fill"><h1 class="serif">Create</h1></div></div>`;
    case "post": return `<div class="m-top bordered">${back}<div class="fill"><h1 class="serif" style="font-size:17px">Post</h1></div>${themeBtn}</div>`;
    default: return `<div class="m-top"><h1 class="serif">Nalanda</h1></div>`;
  }
}

function mTabbar(){
  const root = TABROOT[M.screen];
  return `<nav class="m-tabs">${TABS.map(([id,l,ic])=>{
    if(id==="__fab") return `<div class="m-fab"><button data-mgo="create">${ICON("sparkles")}</button></div>`;
    return `<button class="m-tab ${root===id?'active':''}" data-mgo="${id}">${ICON(ic)}<span>${l}</span></button>`;
  }).join("")}</nav>`;
}

const MSCREENS = {
  home(){
    const u=DB.user;
    return `<div class="m-fade">
      <div class="m-hero">
        <div class="eyebrow">Good morning, ${u.name.split(" ")[0]}</div>
        <h2 class="serif">Make this week's notes.</h2>
        <p class="muted" style="font-size:13px;margin-top:8px">3 tasks due · 2 new materials</p>
        <button class="btn btn-primary mt-16" style="width:100%;justify-content:center" data-mgo="create">${ICON("sparkles")}<span>Create a note with AI</span></button>
      </div>
      <div class="row gap-8 mt-16">
        <div class="m-stat"><div class="n">${u.stats.hours}h</div><div class="l">Studied</div></div>
        <div class="m-stat"><div class="n">${fmt(u.credits)}</div><div class="l">Credits</div></div>
        <div class="m-stat"><div class="n">30</div><div class="l">Streak</div></div>
      </div>
      <div class="row between mt-24" style="margin-bottom:10px"><h3 class="serif" style="font-size:16px">Continue</h3><span class="chip chip-accent" data-mgo="notes">All</span></div>
      <div class="m-card">
        ${DB.notes.slice(0,4).map(n=>`<div class="m-row" data-mgo="note" data-note="${n.id}">
          <div class="av" style="background:${n.grad};width:40px;height:40px;border-radius:11px">${ICON(n.kind.includes("Quiz")?"quiz":n.kind.includes("Graph")?"graph":n.kind.includes("Exam")?"exam":"list")}</div>
          <div class="fill"><div style="font-weight:650;font-size:13.5px">${n.title}</div><div class="faint" style="font-size:11.5px">${n.courseName} · ${n.updated}</div></div>
          ${ICON("chevright")}</div>`).join("")}
      </div>
      <div class="row between mt-24" style="margin-bottom:10px"><h3 class="serif" style="font-size:16px">Your courses</h3></div>
      <div class="col gap-12">
        ${DB.courses.slice(0,3).map(c=>`<div class="m-card" style="padding:14px">
          <div class="row gap-12"><div class="av" style="background:${c.color};width:36px;height:36px;border-radius:10px;font-size:11px">${c.code.split(" ")[0]}</div>
            <div class="fill"><div style="font-weight:650;font-size:13px">${c.name}</div><div class="faint" style="font-size:11.5px">${c.code} · ${c.progress}%</div></div></div>
          <div class="bar mt-12"><i style="width:${c.progress}%"></i></div></div>`).join("")}
      </div>
    </div>`;
  },

  notes(){
    return `<div class="m-fade"><div class="row gap-8 wrap-flex" style="margin:6px 0 14px">
      ${[["all","All"]].concat(DB.courses.map(c=>[c.id,c.code])).map(([id,l])=>`<span class="chip ${id==='all'?'chip-accent':'chip-outline'}">${l}</span>`).join("")}</div>
      <div class="col gap-14">
      ${DB.notes.map(n=>`<div class="m-card" data-mgo="note" data-note="${n.id}">
        <div class="m-ncard-top" style="background:${n.grad}">
          <div style="position:absolute;top:10px;right:10px;color:#fff;opacity:.9">${ICON(n.kind.includes("Quiz")?"quiz":n.kind.includes("Graph")?"graph":n.kind.includes("Exam")?"exam":"list")}</div>
          <span class="chip" style="background:rgba(255,255,255,.22);color:#fff">${n.courseName}</span></div>
        <div style="padding:14px"><span class="chip chip-tag" style="margin-bottom:8px">${n.kind}</span>
          <h3 class="serif" style="font-size:16px;margin:6px 0 5px">${n.title}</h3>
          <p class="muted" style="font-size:12.5px">${n.desc}</p></div></div>`).join("")}
      </div></div>`;
  },

  note(){
    const n = DB.notes.find(x=>x.id===M.noteId)||DB.notes[0];
    const tabs=[["list","List"],["quiz","Quiz"],["graph","Graph"],["exam","Exam"]];
    return `<div class="m-fade">
      <div class="row gap-8" style="margin:4px 0 10px"><span class="chip chip-accent">${ICON("sparkles")} AI</span><span class="chip chip-tag">${n.courseName}</span></div>
      <h1 class="serif" style="font-size:24px;line-height:1.15">${n.title}</h1>
      <p class="meta mt-8" style="white-space:normal">${ICON("file")}&nbsp;From ${n.source}</p>
      <div class="m-seg">${tabs.map(([id,l])=>`<button class="${M.noteTab===id?'active':''}" data-mact="ntab" data-tab="${id}">${l}</button>`).join("")}</div>
      ${ ({list:mTabList,quiz:mTabQuiz,graph:mTabGraph,exam:mTabExam})[M.noteTab]() }
    </div>`;
  },

  create(){
    const gens=[["list","list","Knowledge list"],["quiz","quiz","Interactive quiz"],["graph","graph","Knowledge graph"],["exam","exam","Mock exam"]];
    return `<div class="m-fade">
      <p class="muted" style="font-size:13px;margin:4px 0 16px">Pick material, choose outputs, generate.</p>
      <div class="eyebrow">1 · Source material</div>
      <div class="m-gen sel" style="margin-top:10px"><span class="mat-ic">${ICON("file")}<span class="ftype ft-pdf" style="position:absolute;bottom:-6px">PDF</span></span>
        <div class="fill"><div style="font-weight:650;font-size:13.5px">Lecture 7 — Working Memory.pdf</div><div class="faint" style="font-size:11.5px">3.2 MB · 38 pages</div></div>
        <span class="mk" style="color:var(--accent)">${ICON("check")}</span></div>
      <div class="eyebrow mt-24">2 · Generate</div>
      <div style="margin-top:10px">${gens.map(([k,ic,l])=>`<div class="m-gen ${M.genSel.includes(k)?'sel':''}" data-mact="gen" data-gen="${k}">
        <div class="ic">${ICON(ic)}</div><div class="fill" style="font-weight:650;font-size:13.5px">${l}</div>
        <span class="mk" style="width:22px;height:22px;border-radius:6px;border:1.5px solid ${M.genSel.includes(k)?'var(--accent)':'var(--border-strong)'};display:grid;place-items:center;color:var(--accent)">${M.genSel.includes(k)?ICON("check"):""}</span></div>`).join("")}</div>
      <div class="m-card mt-16" style="padding:16px">
        <div class="row between" style="font-size:13px;margin-bottom:12px"><span class="muted">Cost</span><span class="chip chip-accent">${ICON("coin")} 25 credits</span></div>
        <button class="btn btn-primary btn-lg" style="width:100%;justify-content:center" data-mact="rungen">${ICON("sparkles")}<span>Generate note</span></button></div>
    </div>`;
  },

  market(){
    return `<div class="m-fade"><div class="row gap-8 wrap-flex" style="margin:6px 0 14px">
      ${["All","Free","Top rated","Premium"].map((c,i)=>`<span class="chip ${i===0?'chip-accent':'chip-outline'}">${c}</span>`).join("")}</div>
      <div class="col gap-14">
      ${DB.market.map(m=>`<div class="m-card" data-mact="buy" data-k="${m.id}">
        <div class="m-ncard-top" style="height:96px;background:${m.grad}">
          <div style="position:absolute;top:10px;right:10px"><span class="chip" style="background:rgba(255,255,255,.25);color:#fff">${m.free?'Free':ICON("coin")+' '+m.price}</span></div>
          <span class="chip" style="background:rgba(255,255,255,.2);color:#fff">${m.course}</span></div>
        <div style="padding:14px"><h3 class="serif" style="font-size:16px;margin-bottom:5px">${m.title}</h3>
          <p class="muted" style="font-size:12.5px">${m.desc}</p>
          <div class="row between mt-12"><div class="row gap-8">${mav(m.ai,m.color,24)}<span class="faint" style="font-size:12px;white-space:nowrap">${m.author}</span></div>
            <span class="rating">${ICON("star")}${m.rating}</span></div></div></div>`).join("")}
      </div></div>`;
  },

  community(){
    return `<div class="m-fade"><div class="row gap-8 wrap-flex" style="margin:6px 0 14px">
      ${["For you","Questions","Tips","Note shares"].map((c,i)=>`<span class="chip ${i===0?'chip-accent':'chip-outline'}">${c}</span>`).join("")}</div>
      <div class="col gap-14">
      ${DB.community.map(p=>`<div class="m-card" style="padding:15px" data-mgo="post" data-post="${p.id}">
        <div class="row gap-10" style="margin-bottom:9px">${mav(p.ai,p.color,36)}
          <div class="fill"><div class="row gap-6"><b style="font-size:13px">${p.author}</b>${p.flair?`<span class="chip chip-accent" style="padding:1px 7px">${p.flair}</span>`:""}</div>
            <div class="faint" style="font-size:11px">${p.university} · ${p.time}</div></div>
          <span class="chip chip-tag">${p.kind}</span></div>
        <h3 class="serif" style="font-size:16px;margin-bottom:5px">${p.title}</h3>
        <p class="muted" style="font-size:13px">${p.body}</p>
        <div class="post-actions" style="margin-top:11px"><span class="pa" data-mact="like">${ICON("heart")}<span>${fmt(p.likes)}</span></span>
          <span class="pa">${ICON("comment")}<span>${p.comments}</span></span><span class="pa">${ICON("bookmark")}<span>${p.saves}</span></span></div></div>`).join("")}
      </div></div>`;
  },

  post(){
    const p=DB.community.find(x=>x.id===M.postId)||DB.community[0];
    return `<div class="m-fade">
      <div class="row gap-10" style="margin:4px 0 12px">${mav(p.ai,p.color,40)}
        <div><div class="row gap-6"><b style="font-size:14px">${p.author}</b>${p.flair?`<span class="chip chip-accent" style="padding:1px 7px">${p.flair}</span>`:""}</div>
          <div class="faint" style="font-size:11.5px">${p.university} · ${p.time} ago</div></div></div>
      <h1 class="serif" style="font-size:22px;line-height:1.2;margin-bottom:10px">${p.title}</h1>
      <p style="font-size:14.5px;line-height:1.65;color:var(--ink-soft)">${p.body} The trick is consistency — I review the graph ten minutes every morning and let the AI quiz fill the gaps it flags.</p>
      <div class="row gap-6 wrap-flex mt-16">${p.tags.map(t=>`<span class="chip chip-tag">#${t}</span>`).join("")}</div>
      <div class="divider"></div>
      <h3 class="serif" style="font-size:15px;margin-bottom:10px">${p.comments} comments</h3>
      ${DB.comments.map(c=>`<div class="row gap-10" style="padding:11px 0;border-bottom:1px solid var(--border-soft);align-items:flex-start">${mav(c.ai,c.color,32)}
        <div class="fill"><div class="row gap-6"><b style="font-size:12.5px">${c.author}</b><span class="faint" style="font-size:11px">${c.time}</span></div>
          <p class="muted" style="font-size:13px;margin-top:2px">${c.body}</p></div></div>`).join("")}
    </div>`;
  },

  profile(){
    const u=DB.user;
    return `<div class="m-fade">
      <div class="m-card" style="padding:18px;background:linear-gradient(120deg,var(--accent-tint),var(--card));border-color:var(--accent-line)">
        <div class="row gap-14"><div class="avatar" style="background:${u.color};width:58px;height:58px;font-size:22px">${u.initials}</div>
          <div class="fill"><div class="row gap-8"><h2 class="serif" style="font-size:20px">${u.name}</h2>${u.vip?`<span class="chip chip-accent" style="padding:2px 8px">VIP</span>`:""}</div>
            <div class="muted" style="font-size:12.5px">${u.major} · ${u.year}</div></div></div>
        <div class="row gap-12 mt-16">
          <div class="m-stat" style="background:var(--card)"><div class="n">Lv ${u.level}</div><div class="l">${u.levelName}</div></div>
          <div class="m-stat" style="background:var(--card)"><div class="n">${fmt(u.credits)}</div><div class="l">Credits</div></div>
        </div>
        <div class="row between" style="font-size:12px;margin:14px 0 6px"><span class="muted">${u.levelProgress}% to ${u.nextLevel}</span></div>
        <div class="bar"><i style="width:${u.levelProgress}%"></i></div>
      </div>
      <div class="row between mt-24" style="margin-bottom:10px"><h3 class="serif" style="font-size:16px">Stats</h3></div>
      <div class="row gap-10 wrap-flex">
        ${[["Notes",DB.notes.length],["Uploads",u.stats.uploads],["Sold",u.stats.sold],["Earned",fmt(u.stats.earned)]].map(([l,n])=>`
          <div class="m-stat" style="flex:1 1 40%"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("")}
      </div>
      <div class="row between mt-24" style="margin-bottom:10px"><h3 class="serif" style="font-size:16px">Badges</h3><span class="faint" style="font-size:12px">${DB.badges.filter(b=>b.got).length}/${DB.badges.length}</span></div>
      <div class="row gap-10 wrap-flex">
        ${DB.badges.map(b=>`<div class="badge-tile ${b.got?'':'locked'}" style="flex:1 1 28%;padding:14px 8px"><div class="badge-medal" style="width:42px;height:42px;font-size:18px">${b.got?b.icon:ICON("lock")}</div><div style="font-weight:650;font-size:11.5px">${b.name}</div></div>`).join("")}
      </div>
    </div>`;
  },
};

/* note tab bodies (mobile) */
function mTabList(){
  return `<div class="col gap-2">${DB.knowledge.map((k,i)=>`
    <div style="display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--border-soft)">
      <div class="knum">${String(i+1).padStart(2,"0")}</div>
      <div class="fill"><h4 class="serif" style="font-size:14.5px;margin-bottom:3px">${k.t}</h4>
        <p class="kdef" style="font-size:13px">${k.d}</p>
        <div class="ktags">${k.tags.map(t=>`<span class="chip chip-tag">${t}</span>`).join("")}</div></div></div>`).join("")}</div>`;
}
function mTabQuiz(){
  const total=DB.quiz.length, answered=Object.keys(M.quiz).length, correct=Object.entries(M.quiz).filter(([qi,oi])=>DB.quiz[qi].ans===oi).length;
  return `<div class="m-card" style="padding:13px 15px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">
      <span class="muted" style="font-size:13px">${answered}/${total} answered</span><b class="serif" style="font-size:16px;white-space:nowrap">${correct}/${total} correct</b></div>
    ${DB.quiz.map((q,qi)=>{const chosen=M.quiz[qi],done=chosen!=null;
      return `<div style="margin-bottom:18px"><div class="row gap-8" style="margin-bottom:7px"><span class="knum">${qi+1}</span></div>
        <h4 class="serif" style="font-size:15px;margin-bottom:6px">${q.q}</h4>
        ${q.opts.map((o,oi)=>{let cls="",mk=String.fromCharCode(65+oi);if(done){if(oi===q.ans){cls="correct";mk="✓";}else if(oi===chosen){cls="wrong";mk="✕";}}
          return `<div class="m-opt ${cls}" ${done?'':`data-mact="answer" data-q="${qi}" data-o="${oi}"`}><span class="mk">${mk}</span><span>${o}</span></div>`;}).join("")}
        ${done?`<div style="background:var(--accent-tint);border-radius:10px;padding:11px;margin-top:10px;font-size:12.5px"><b style="color:var(--accent)">Why:</b> <span class="muted">${q.why}</span></div>`:""}</div>`;}).join("")}
    <button class="btn" style="width:100%;justify-content:center" data-mact="resetquiz">${ICON("clock")}<span>Restart quiz</span></button>`;
}
function mTabGraph(){
  return `<div class="m-graph">${DB.graph.nodes.map(n=>`<div class="m-gnode ${n.cls}" style="left:${n.x}%;top:${n.y}%">${n.label}</div>`).join("")}</div>
    <p class="muted" style="font-size:12.5px;margin-top:12px">8 concepts · 7 links. Auto-mapped from your material.</p>`;
}
function mTabExam(){
  const e=DB.exam;
  return `<div class="exam-paper" style="padding:18px">
    <div class="exam-head" style="padding-bottom:14px;margin-bottom:16px"><h2 class="serif" style="font-size:17px">${e.title}</h2><p class="faint" style="font-size:11.5px;margin-top:5px">${e.meta}</p></div>
    ${e.sections.map(sec=>`<div class="exam-sec"><div class="exam-sec-h">${sec.name}</div>
      ${sec.qs.map((q,i)=>`<div class="exam-q"><b>${i+1}.</b><span>${q}</span></div>`).join("")}</div>`).join("")}</div>
    <button class="btn btn-primary mt-16" style="width:100%;justify-content:center" data-mact="toast">${ICON("play")}<span>Start timed attempt</span></button>`;
}

function mav(initials,color,size){ return `<div class="av" style="background:${color};width:${size}px;height:${size}px;font-size:${Math.round(size*0.4)}px">${initials}</div>`; }

/* render */
function mRender(){
  document.getElementById("m-app").innerHTML =
    mTopbar() +
    `<div class="m-scroll" id="m-scroll">${(MSCREENS[M.screen]||MSCREENS.home)()}</div>` +
    mTabbar();
}

/* interactions */
const MACT = {
  back(){ mGo(TABROOT[M.screen]==="home"&&M.screen!=="home"?"home":({note:"notes",create:"notes",post:"community",profile:"home"}[M.screen]||"home")); },
  theme(){ mTheme(); },
  ntab(t){ M.noteTab=t.dataset.tab; mRender(); },
  answer(t){ const qi=+t.dataset.q; if(M.quiz[qi]!=null) return; M.quiz[qi]=+t.dataset.o; mRender(); },
  resetquiz(){ M.quiz={}; mRender(); },
  gen(t){ const k=t.dataset.gen,i=M.genSel.indexOf(k); if(i>=0)M.genSel.splice(i,1); else M.genSel.push(k); mRender(); },
  rungen(){ mToast("Generating…"); setTimeout(()=>{ mToast("Note created",1); mGo("note",{noteId:"n1",noteTab:"list"}); },800); },
  buy(t){ const m=DB.market.find(x=>x.id===t.dataset.k); mToast((m.free?"Added — ":"Bought — ")+m.title,1); },
  like(t){ t.classList.toggle("liked"); t.style.color=t.classList.contains("liked")?"var(--pink)":""; },
  toast(){ mToast("Done",1); },
};
function mToast(msg,ok){ document.getElementById("m-toast")?.remove();
  const d=document.createElement("div"); d.className="toast"; d.id="m-toast"; d.innerHTML=(ok?ICON("check"):"")+`<span>${msg}</span>`;
  document.body.appendChild(d); setTimeout(()=>d.remove(),2000); }

document.getElementById("m-app").addEventListener("click", e=>{
  const g=e.target.closest("[data-mgo]"); if(g){ mGo(g.dataset.mgo, g.dataset.note?{noteId:g.dataset.note}:g.dataset.post?{postId:g.dataset.post}:null); return; }
  const a=e.target.closest("[data-mact]"); if(a){ MACT[a.dataset.mact] && MACT[a.dataset.mact](a); }
});

mInitTheme();
mRender();
