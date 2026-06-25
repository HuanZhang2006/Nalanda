// @ts-nocheck
// 社区：帖子流 + 帖子详情。发帖/编辑/删除、点赞、评论、收藏、转发、关注；
// 按 关注 / 类型 / 学科(我的课程) / 我的大学 / 我的专业 分类。Supabase 直连 + RLS。
import { ICON } from "./icons";

let sb = null, USER = null, toastFn = () => {};
const me = { id: null, name: "", university: "", major: "" };
let myCourses = [];
const followingIds = new Set();
let meLoaded = false;

const state = { loading: true, error: "", filter: "all", posts: [], liked: new Set(), faved: new Set(), originals: {} };
let feedEl = null;

const KIND = { experience: "经验", question: "提问", tip: "技巧", note_share: "笔记分享" };
const PAL = ["#9c6a39", "#4a6c8f", "#4f7d52", "#a85c6b", "#5a6b78", "#b07a2b"];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const colorOf = (s) => PAL[[...String(s || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % PAL.length];
const initialsOf = (s) => String(s || "?").trim().slice(0, 2).toUpperCase();
const av = (name, size) => `<div class="av" style="background:${colorOf(name)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${esc(initialsOf(name))}</div>`;
const fmt = (n) => Number(n || 0).toLocaleString();
function timeAgo(s) {
  const d = new Date(s), m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "刚刚"; if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60); if (h < 24) return h + " 小时前";
  const days = Math.floor(h / 24); if (days < 7) return days + " 天前";
  return d.toLocaleDateString();
}

export function initCommunity(supabase, user, toast) { sb = supabase; USER = user; if (toast) toastFn = toast; }

async function ensureMe() {
  if (meLoaded) return;
  try {
    const [p, c, f] = await Promise.all([
      sb.from("profiles").select("id,username,university,major").eq("id", USER.id).single(),
      sb.from("courses").select("code,name").order("created_at", { ascending: true }),
      sb.from("follows").select("following_id").eq("follower_id", USER.id),
    ]);
    if (p.data) { me.id = p.data.id; me.name = p.data.username || (USER.email || "").split("@")[0]; me.university = p.data.university || ""; me.major = p.data.major || ""; }
    myCourses = [...new Set((c.data || []).map((x) => x.code || x.name).filter(Boolean))];
    (f.data || []).forEach((x) => followingIds.add(x.following_id));
  } catch {}
  meLoaded = true;
}

/* ============ FEED ============ */
export async function mountCommunity(el) {
  feedEl = el; if (!feedEl) return;
  renderFeed();
  await ensureMe();
  loadFeed();
}

async function loadFeed() {
  state.loading = true; renderFeed();
  try {
    let q = sb.from("posts").select("*").order("created_at", { ascending: false }).limit(60);
    const f = state.filter;
    if (f === "question" || f === "tip" || f === "note_share") q = q.eq("kind", f);
    else if (f === "uni") { if (!me.university) return done([]); q = q.eq("author_university", me.university); }
    else if (f === "major") { if (!me.major) return done([]); q = q.eq("author_major", me.major); }
    else if (f.indexOf("subject:") === 0) q = q.eq("subject", f.slice(8));
    else if (f === "following") { const ids = [...followingIds]; if (!ids.length) return done([]); q = q.in("user_id", ids); }
    const { data, error } = await q;
    if (error) throw error;
    state.posts = data || [];
    await hydrate(state.posts);
    state.error = "";
  } catch (e) { state.error = e.message || "加载失败"; }
  state.loading = false; renderFeed();
  function done(arr) { state.posts = arr; state.loading = false; state.error = ""; renderFeed(); }
}

async function hydrate(posts) {
  state.liked.clear(); state.faved.clear(); state.originals = {};
  const ids = posts.map((p) => p.id);
  if (ids.length) {
    const [lk, fv] = await Promise.all([
      sb.from("post_likes").select("post_id").in("post_id", ids),
      sb.from("post_favorites").select("post_id").in("post_id", ids),
    ]);
    (lk.data || []).forEach((x) => state.liked.add(x.post_id));
    (fv.data || []).forEach((x) => state.faved.add(x.post_id));
  }
  const repIds = [...new Set(posts.map((p) => p.repost_of).filter(Boolean))];
  if (repIds.length) {
    const { data } = await sb.from("posts").select("*").in("id", repIds);
    (data || []).forEach((o) => (state.originals[o.id] = o));
  }
}

function filterChips() {
  const chips = [["all", "推荐"], ["following", "关注"], ["question", "提问"], ["tip", "技巧"], ["note_share", "笔记分享"]];
  if (me.university) chips.push(["uni", "🏫 " + me.university]);
  if (me.major) chips.push(["major", "🎓 " + me.major]);
  myCourses.forEach((c) => chips.push(["subject:" + c, c]));
  return chips.map(([id, l]) => `<button class="chip ${state.filter === id ? "chip-accent" : "chip-outline"}" data-cm="filter" data-f="${esc(id)}">${esc(l)}</button>`).join("");
}

function suggestions() {
  const seen = new Set([me.id]);
  const out = [];
  for (const p of state.posts) {
    if (!p.user_id || seen.has(p.user_id) || followingIds.has(p.user_id)) continue;
    seen.add(p.user_id);
    out.push({ id: p.user_id, name: p.author_name, uni: p.author_university });
    if (out.length >= 5) break;
  }
  if (!out.length) return `<div class="muted" style="font-size:12.5px">暂无推荐</div>`;
  return out.map((u) => `<div class="row gap-10" style="padding:8px 0">${av(u.name, 32)}
    <div class="fill"><div style="font-size:13px;font-weight:650">${esc(u.name || "用户")}</div>
      <div class="faint" style="font-size:11.5px">${esc(u.uni || "")}</div></div>
    <button class="btn btn-sm" data-cm="follow" data-id="${u.id}">关注</button></div>`).join("");
}

function renderFeed() {
  if (!feedEl) return;
  feedEl.innerHTML = `<div class="wrap wrap-wide">
    <div class="page-head">
      <div><div class="eyebrow">Community</div><h1 class="page-title">学习社区</h1>
        <p class="page-sub">分享经验、提问、晒笔记 —— 按你的课程、大学、专业筛选。</p></div>
      <button class="btn btn-primary" data-cm="compose">${ICON("plus")}<span>发帖</span></button>
    </div>
    <div class="grid" style="grid-template-columns:1fr 300px;align-items:start">
      <div>
        <div class="row gap-8 wrap-flex" style="margin-bottom:16px">${filterChips()}</div>
        ${state.error ? `<div class="card card-pad" style="color:var(--pink)">出错了：${esc(state.error)}</div>`
          : state.loading ? `<div class="card card-pad muted">加载中…</div>`
          : state.posts.length === 0 ? `<div class="card card-pad muted" style="text-align:center;padding:36px">这里还没有帖子，点右上「发帖」成为第一个。</div>`
          : `<div class="card">${state.posts.map((p) => postCard(p)).join("")}</div>`}
      </div>
      <aside class="col gap-16" style="position:sticky;top:8px">
        <div class="card card-pad"><div class="eyebrow">推荐关注</div>${suggestions()}</div>
        <div class="card card-pad"><div class="eyebrow">关于分区</div>
          <p class="muted" style="font-size:12.5px">「关注」看你关注的人；🏫/🎓 看同校/同专业；课程代码看该学科的帖子。</p></div>
      </aside>
    </div>
  </div>`;
  wire(feedEl);
}

function actionBar(p) {
  const liked = state.liked.has(p.id), faved = state.faved.has(p.id);
  return `<div class="post-actions">
    <span class="pa" data-cm="like" data-id="${p.id}" style="${liked ? "color:var(--pink)" : ""}">${ICON("heart")}<span>${fmt(p.like_count)}</span></span>
    <span class="pa" data-go="post" data-post="${p.id}">${ICON("comment")}<span>${fmt(p.comment_count)}</span></span>
    <span class="pa" data-cm="repost" data-id="${p.id}">${ICON("arrow")}<span>${fmt(p.repost_count)}</span></span>
    <span class="pa" data-cm="fav" data-id="${p.id}" style="${faved ? "color:var(--accent)" : ""}">${ICON("bookmark")}<span>${fmt(p.favorite_count)}</span></span>
  </div>`;
}

function embedOriginal(o) {
  if (!o) return `<div class="card-2" style="background:var(--card-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin:8px 0;color:var(--ink-faint);font-size:12.5px">原帖已删除</div>`;
  return `<div class="card-2" data-go="post" data-post="${o.id}" style="background:var(--card-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin:8px 0;cursor:pointer">
    <div class="row gap-8" style="margin-bottom:4px">${av(o.author_name, 22)}<b style="font-size:12.5px">${esc(o.author_name || "用户")}</b><span class="faint" style="font-size:11.5px">${timeAgo(o.created_at)}</span></div>
    ${o.title ? `<div style="font-weight:650;font-size:13.5px">${esc(o.title)}</div>` : ""}
    <div class="muted" style="font-size:12.5px">${esc((o.body || "").slice(0, 140))}</div>
  </div>`;
}

function authorRow(p, big) {
  const isMe = p.user_id === me.id;
  const following = followingIds.has(p.user_id);
  const followBtn = isMe ? "" : `<button class="btn btn-sm ${following ? "" : "btn-primary"}" data-cm="follow" data-id="${p.user_id}" onclick="event.stopPropagation()">${following ? "已关注" : "关注"}</button>`;
  const ownBtns = isMe ? `<button class="btn btn-sm" data-cm="edit" data-id="${p.id}">${ICON("edit")}</button><button class="btn btn-sm" data-cm="del" data-id="${p.id}">${ICON("close")}</button>` : "";
  return `<div class="row gap-8 wrap-flex" style="margin-bottom:6px">
    ${av(p.author_name, big ? 44 : 40)}
    <div class="fill" style="min-width:0">
      <div class="row gap-8 wrap-flex"><b style="font-size:13.5px">${esc(p.author_name || "用户")}</b>
        <span class="meta"><span>${esc(p.author_university || "")}</span>${p.author_university ? '<span class="dot"></span>' : ""}<span>${timeAgo(p.created_at)}</span></span>
        <span class="chip chip-tag">${KIND[p.kind] || "经验"}</span></div>
    </div>
    <div class="row gap-6">${ownBtns}${followBtn}</div>
  </div>`;
}

function postCard(p, big) {
  return `<div class="post" ${big ? "" : `data-go="post" data-post="${p.id}" style="cursor:pointer"`}>
    <div class="fill" style="min-width:0">
      ${authorRow(p, big)}
      ${p.repost_of ? `<div class="faint" style="font-size:12px;margin:2px 0">${ICON("arrow")} 转发</div>${embedOriginal(state.originals[p.repost_of])}` : ""}
      ${p.title ? `<h3 class="serif" style="font-size:${big ? 22 : 17}px;margin-bottom:5px">${esc(p.title)}</h3>` : ""}
      ${p.body ? `<p class="muted" style="font-size:${big ? 15 : 13.5}px;line-height:1.6;white-space:pre-wrap">${esc(p.body)}</p>` : ""}
      <div class="row gap-6 wrap-flex mt-8">
        ${p.subject ? `<span class="chip chip-tag">#${esc(p.subject)}</span>` : ""}
        ${(p.tags || []).map((t) => `<span class="chip chip-tag">#${esc(t)}</span>`).join("")}
      </div>
      ${actionBar(p)}
    </div>
  </div>`;
}

/* ============ DETAIL ============ */
export async function mountPost(el, postId) {
  if (!el) return;
  await ensureMe();
  el.innerHTML = `<div class="wrap"><div class="card card-pad muted">加载中…</div></div>`;
  let post, comments = [];
  try {
    const pr = await sb.from("posts").select("*").eq("id", postId).single();
    if (pr.error) throw pr.error;
    post = pr.data;
    await hydrate([post]);
    const cr = await sb.from("comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
    comments = cr.data || [];
  } catch (e) {
    el.innerHTML = `<div class="wrap"><a class="btn btn-ghost btn-sm" data-go="community" style="margin-bottom:14px">${ICON("chevleft")}<span>社区</span></a><div class="card card-pad" style="color:var(--pink)">出错了：${esc(e.message || "帖子不存在")}</div></div>`;
    return;
  }
  el.innerHTML = `<div class="wrap">
    <a class="btn btn-ghost btn-sm" data-go="community" style="margin-bottom:16px">${ICON("chevleft")}<span>社区</span></a>
    <div class="card card-pad" style="margin-bottom:18px">${postCard(post, true)}</div>
    <div class="card card-pad">
      <div class="row gap-10" style="margin-bottom:12px">${av(me.name, 34)}
        <input id="cm-input" class="search" style="flex:1;background:var(--card-2)" placeholder="写下你的评论…"/>
        <button class="btn btn-sm btn-primary" data-cm="addcomment" data-id="${post.id}">评论</button></div>
      <div class="divider"></div>
      <h3 class="serif" style="font-size:16px;margin-bottom:6px">${fmt(post.comment_count)} 条评论</h3>
      <div id="cm-list">${comments.length ? comments.map(commentRow).join("") : `<div class="muted" style="font-size:13px;padding:8px 0">还没有评论，来抢沙发。</div>`}</div>
    </div>
  </div>`;
  wire(el);
}

function commentRow(c) {
  const isMe = c.user_id === me.id;
  return `<div class="row gap-10" style="padding:11px 0;border-bottom:1px solid var(--border-soft);align-items:flex-start">
    ${av(c.author_name, 34)}
    <div class="fill"><div class="row gap-8"><b style="font-size:13px">${esc(c.author_name || "用户")}</b><span class="faint" style="font-size:11.5px">${timeAgo(c.created_at)}</span></div>
      <p class="muted" style="font-size:13.5px;margin-top:2px;white-space:pre-wrap">${esc(c.body)}</p></div>
    ${isMe ? `<button class="icon-btn" data-cm="delcomment" data-id="${c.id}" data-post="${c.post_id}" title="删除" style="width:28px;height:28px">${ICON("close")}</button>` : ""}
  </div>`;
}

/* ============ wiring & actions ============ */
function wire(scope) {
  scope.querySelectorAll("[data-cm]").forEach((el) => {
    el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handle(el.dataset.cm, el); };
  });
}

function handle(action, el) {
  const id = el.dataset.id;
  if (action === "filter") { state.filter = el.dataset.f; loadFeed(); }
  else if (action === "compose") composer(null);
  else if (action === "edit") composer(state.posts.find((p) => p.id === id));
  else if (action === "del") delPost(id);
  else if (action === "like") toggleLike(id);
  else if (action === "fav") toggleFav(id);
  else if (action === "repost") repostModal(id);
  else if (action === "follow") toggleFollow(id);
  else if (action === "addcomment") addComment(id);
  else if (action === "delcomment") delComment(id, el.dataset.post);
}

const patch = (id, fn) => { const p = state.posts.find((x) => x.id === id); if (p) fn(p); };

async function toggleLike(id) {
  const liked = state.liked.has(id);
  try {
    if (liked) { state.liked.delete(id); patch(id, (p) => p.like_count = Math.max(0, (p.like_count || 0) - 1)); await sb.from("post_likes").delete().eq("post_id", id).eq("user_id", USER.id); }
    else { state.liked.add(id); patch(id, (p) => p.like_count = (p.like_count || 0) + 1); await sb.from("post_likes").insert({ post_id: id }); }
  } catch { toastFn("操作失败"); }
  renderFeed();
}
async function toggleFav(id) {
  const f = state.faved.has(id);
  try {
    if (f) { state.faved.delete(id); patch(id, (p) => p.favorite_count = Math.max(0, (p.favorite_count || 0) - 1)); await sb.from("post_favorites").delete().eq("post_id", id).eq("user_id", USER.id); toastFn("已取消收藏"); }
    else { state.faved.add(id); patch(id, (p) => p.favorite_count = (p.favorite_count || 0) + 1); await sb.from("post_favorites").insert({ post_id: id }); toastFn("已收藏", "check"); }
  } catch { toastFn("操作失败"); }
  renderFeed();
}
async function toggleFollow(uid) {
  const f = followingIds.has(uid);
  try {
    if (f) { followingIds.delete(uid); await sb.from("follows").delete().eq("follower_id", USER.id).eq("following_id", uid); toastFn("已取消关注"); }
    else { followingIds.add(uid); await sb.from("follows").insert({ following_id: uid }); toastFn("已关注", "check"); }
  } catch { toastFn("操作失败"); }
  renderFeed();
}

async function addComment(postId) {
  const input = document.getElementById("cm-input");
  const body = (input && input.value || "").trim();
  if (!body) { toastFn("评论不能为空"); return; }
  try {
    const { error } = await sb.from("comments").insert({ post_id: postId, body });
    if (error) throw error;
    const el = document.getElementById("post-root");
    if (el) mountPost(el, postId);
  } catch (e) { toastFn("评论失败：" + (e.message || "")); }
}
async function delComment(id, postId) {
  if (!(await confirmDialog({ title: "删除评论", message: "确定删除这条评论？" }))) return;
  try { await sb.from("comments").delete().eq("id", id); const el = document.getElementById("post-root"); if (el) mountPost(el, postId); }
  catch (e) { toastFn("删除失败：" + (e.message || "")); }
}

async function delPost(id) {
  if (!(await confirmDialog({ title: "删除帖子", message: "确定删除这篇帖子？评论与互动会一并删除，不可撤销。" }))) return;
  try { await sb.from("posts").delete().eq("id", id); toastFn("已删除", "check"); loadFeed(); }
  catch (e) { toastFn("删除失败：" + (e.message || "")); }
}

function repostModal(id) {
  const orig = state.posts.find((p) => p.id === id);
  const scrim = modalShell(`<h2 class="serif" style="font-size:20px;margin-bottom:12px">转发</h2>
    <textarea id="rp-body" class="search" style="width:100%;background:var(--card-2);min-height:80px;align-items:flex-start" placeholder="说点什么（可选）…"></textarea>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x="cancel">取消</button><button class="btn btn-primary" data-x="save">转发</button></div>`);
  const close = () => scrim.remove();
  scrim.querySelector('[data-x="cancel"]').onclick = close;
  const btn = scrim.querySelector('[data-x="save"]');
  let saving = false;
  btn.onclick = async () => {
    if (saving) return; saving = true; btn.disabled = true; btn.textContent = "转发中…";
    try {
      const body = scrim.querySelector("#rp-body").value.trim();
      const { error } = await sb.from("posts").insert({ repost_of: id, body: body || null, kind: "experience", subject: orig ? orig.subject : null });
      if (error) throw error;
      close(); toastFn("已转发", "check"); state.filter = "all"; loadFeed();
    } catch (e) { saving = false; btn.disabled = false; btn.textContent = "转发"; toastFn("转发失败：" + (e.message || "")); }
  };
}

function composer(existing) {
  const isEdit = !!existing;
  const subjOpts = ["<option value=''>无学科</option>"].concat(myCourses.map((c) => `<option value="${esc(c)}" ${existing && existing.subject === c ? "selected" : ""}>${esc(c)}</option>`)).join("");
  const kindOpts = Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${existing && existing.kind === k ? "selected" : ""}>${l}</option>`).join("");
  const scrim = modalShell(`<h2 class="serif" style="font-size:20px;margin-bottom:12px">${isEdit ? "编辑帖子" : "发帖"}</h2>
    <div class="row gap-8" style="margin-bottom:10px">
      <select id="ps-kind" class="search" style="flex:1;background:var(--card-2)">${kindOpts}</select>
      <select id="ps-subject" class="search" style="flex:1;background:var(--card-2)">${subjOpts}</select>
    </div>
    <input id="ps-title" class="search" style="width:100%;background:var(--card-2);margin-bottom:10px" placeholder="标题（可选）" value="${esc(existing && existing.title || "")}"/>
    <textarea id="ps-body" class="search" style="width:100%;background:var(--card-2);min-height:120px;align-items:flex-start;margin-bottom:10px" placeholder="分享你的想法、问题或经验…">${esc(existing && existing.body || "")}</textarea>
    <input id="ps-tags" class="search" style="width:100%;background:var(--card-2)" placeholder="标签，用逗号分隔（可选）" value="${esc(existing && (existing.tags || []).join(", ") || "")}"/>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-x="cancel">取消</button><button class="btn btn-primary" data-x="save">${isEdit ? "保存" : "发布"}</button></div>`);
  const close = () => scrim.remove();
  scrim.querySelector('[data-x="cancel"]').onclick = close;
  const btn = scrim.querySelector('[data-x="save"]');
  let saving = false;
  btn.onclick = async () => {
    if (saving) return;
    const title = scrim.querySelector("#ps-title").value.trim();
    const body = scrim.querySelector("#ps-body").value.trim();
    if (!title && !body) { toastFn("写点内容再发布"); return; }
    const row = {
      kind: scrim.querySelector("#ps-kind").value,
      subject: scrim.querySelector("#ps-subject").value || null,
      title: title || null, body: body || null,
      tags: scrim.querySelector("#ps-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
    };
    saving = true; btn.disabled = true; btn.textContent = isEdit ? "保存中…" : "发布中…";
    try {
      if (isEdit) { const { error } = await sb.from("posts").update({ ...row, updated_at: new Date().toISOString() }).eq("id", existing.id); if (error) throw error; toastFn("已保存", "check"); }
      else { const { error } = await sb.from("posts").insert(row); if (error) throw error; toastFn("已发布", "check"); state.filter = "all"; }
      close(); loadFeed();
    } catch (e) { saving = false; btn.disabled = false; btn.textContent = isEdit ? "保存" : "发布"; toastFn("失败：" + (e.message || "")); }
  };
}

function modalShell(inner) {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="modal"><div class="modal-pad">${inner}</div></div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) scrim.remove(); });
  return scrim;
}

function confirmDialog({ title, message, confirmText = "删除" }) {
  return new Promise((resolve) => {
    const scrim = modalShell(`<h2 class="serif" style="font-size:19px;margin-bottom:10px">${esc(title)}</h2>
      <p class="muted" style="font-size:13.5px;margin-bottom:20px">${esc(message)}</p>
      <div class="row gap-8" style="justify-content:flex-end"><button class="btn" data-x="no">取消</button>
        <button class="btn" data-x="yes" style="background:var(--pink);color:#fff;border-color:transparent">${esc(confirmText)}</button></div>`);
    const done = (v) => { scrim.remove(); resolve(v); };
    scrim.addEventListener("click", (e) => { if (e.target === scrim) done(false); });
    scrim.querySelector('[data-x="no"]').onclick = () => done(false);
    scrim.querySelector('[data-x="yes"]').onclick = () => done(true);
  });
}
