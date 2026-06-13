/* ============================================================
   Nalanda — views: materials, market, community, profile,
   schedule, feedback  + buy modal
   ============================================================ */
window.VIEWS = window.VIEWS || {};

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
