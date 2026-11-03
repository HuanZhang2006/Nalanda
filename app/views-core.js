/* ============================================================
   Nalanda — core views: home, notes, note detail, create
   ============================================================ */
window.VIEWS = window.VIEWS || {};

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
              <div class="row gap-6"><span class="chip chip-accent">English</span><span class="chip chip-outline">Chinese</span></div></div>
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
