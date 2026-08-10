// @ts-nocheck
// 社区：帖子流 + 详情 + 「我的」。发帖(图片/音频/标签)/编辑/删除、点赞、评论、收藏、转发、关注。
// 标签来自全局(所有用户的大学/专业/学科)，发帖时多选；按标签/关注/类型/我的 筛选。Supabase 直连 + RLS。
import { ICON } from "./icons";
import { showPointRewardReceipt } from "./point-receipt";

let sb = null, USER = null, toastFn = () => {};
const me = { id: null, name: "", university: "", major: "" };
const followingIds = new Set();
const globalTags = { university: [], major: [], subject: [], tag: [] };
let meLoaded = false;
let sessionVersion = 0;

const state = { loading: true, error: "", filter: "all", mineTab: "posts", counts: { posts: 0, following: 0, followers: 0 }, posts: [], liked: new Set(), faved: new Set(), originals: {} };
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

export function initCommunity(supabase, user, toast) {
  sessionVersion++;
  sb = supabase; USER = user; toastFn = toast || (() => {});
  Object.assign(me, { id: null, name: "", university: "", major: "" });
  followingIds.clear();
  Object.keys(globalTags).forEach((key) => { globalTags[key] = []; });
  meLoaded = false;
  feedEl = null;
  Object.assign(state, {
    loading: true, error: "", filter: "all", mineTab: "posts",
    counts: { posts: 0, following: 0, followers: 0 }, posts: [],
    liked: new Set(), faved: new Set(), originals: {},
  });
}

async function ensureMe() {
  if (meLoaded) return;
  const currentVersion = sessionVersion;
  try {
    const [p, f, t] = await Promise.all([
      sb.from("profiles").select("id,username,university,major").eq("id", USER.id).single(),
      sb.from("follows").select("following_id").eq("follower_id", USER.id),
      sb.from("tags").select("kind,value").order("value", { ascending: true }),
    ]);
    if (currentVersion !== sessionVersion) return;
    const failed = [p, f, t].find((result) => result.error);
    if (failed) throw failed.error;
    if (p.data) { me.id = p.data.id; me.name = p.data.username || (USER.email || "").split("@")[0]; me.university = p.data.university || ""; me.major = p.data.major || ""; }
    (f.data || []).forEach((x) => followingIds.add(x.following_id));
    globalTags.university = []; globalTags.major = []; globalTags.subject = []; globalTags.tag = [];
    (t.data || []).forEach((x) => { (globalTags[x.kind] || globalTags.tag).push(x.value); });
  } catch (e) { if (currentVersion !== sessionVersion) return; toastFn("社区资料加载失败：" + (e.message || "")); }
  if (currentVersion !== sessionVersion) return;
  meLoaded = true;
}

export async function mountCommunity(el) { feedEl = el; if (!feedEl) return; renderFeed(); await ensureMe(); load(); }

async function load() {
  const currentVersion = sessionVersion;
  if (state.filter === "mine") return loadMine();
  state.loading = true; renderFeed();
  try {
    let q = sb.from("posts").select("*").order("created_at", { ascending: false }).limit(60);
    const f = state.filter;
    if (f === "question" || f === "tip" || f === "note_share") q = q.eq("kind", f);
    else if (f.indexOf("t:") === 0) q = q.contains("tags", [f.slice(2)]);
    else if (f === "following") { const ids = [...followingIds]; if (!ids.length) { state.posts = []; state.loading = false; state.error = ""; return renderFeed(); } q = q.in("user_id", ids); }
    const { data, error } = await q;
    if (currentVersion !== sessionVersion) return;
    if (error) throw error;
    state.posts = data || [];
    await hydrate(state.posts, currentVersion);
    if (currentVersion !== sessionVersion) return;
    state.error = "";
  } catch (e) { if (currentVersion !== sessionVersion) return; state.error = e.message || "加载失败"; }
  if (currentVersion !== sessionVersion) return;
  state.loading = false; renderFeed();
}

async function loadMine() {
  const currentVersion = sessionVersion;
  state.loading = true; renderFeed();
  try {
    const [pc, fwing, fwers] = await Promise.all([
      sb.from("posts").select("id", { count: "exact", head: true }).eq("user_id", USER.id).is("repost_of", null),
      sb.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", USER.id),
      sb.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", USER.id),
    ]);
    if (currentVersion !== sessionVersion) return;
    const countFailure = [pc, fwing, fwers].find((result) => result.error);
    if (countFailure) throw countFailure.error;
    state.counts = { posts: pc.count || 0, following: fwing.count || 0, followers: fwers.count || 0 };
    const tab = state.mineTab; let posts = [];
    if (tab === "posts") { const { data, error } = await sb.from("posts").select("*").eq("user_id", USER.id).is("repost_of", null).order("created_at", { ascending: false }); if (error) throw error; posts = data || []; }
    else if (tab === "reposts") { const { data, error } = await sb.from("posts").select("*").eq("user_id", USER.id).not("repost_of", "is", null).order("created_at", { ascending: false }); if (error) throw error; posts = data || []; }
    else {
      let ids = [];
      if (tab === "replies") { const { data, error } = await sb.from("comments").select("post_id").eq("user_id", USER.id); if (error) throw error; ids = [...new Set((data || []).map((x) => x.post_id))]; }
      else if (tab === "liked") { const { data, error } = await sb.from("post_likes").select("post_id"); if (error) throw error; ids = (data || []).map((x) => x.post_id); }
      else if (tab === "faved") { const { data, error } = await sb.from("post_favorites").select("post_id"); if (error) throw error; ids = (data || []).map((x) => x.post_id); }
      if (ids.length) { const { data, error } = await sb.from("posts").select("*").in("id", ids).order("created_at", { ascending: false }); if (error) throw error; posts = data || []; }
    }
    if (currentVersion !== sessionVersion) return;
    state.posts = posts;
    await hydrate(posts, currentVersion);
    if (currentVersion !== sessionVersion) return;
    state.error = "";
  } catch (e) { if (currentVersion !== sessionVersion) return; state.error = e.message || "加载失败"; }
  if (currentVersion !== sessionVersion) return;
  state.loading = false; renderFeed();
}

async function hydrate(posts, currentVersion = sessionVersion) {
  const client = sb;
  const liked = new Set(), faved = new Set(), originals = {};
  const ids = posts.map((p) => p.id);
  if (ids.length) {
    const [lk, fv] = await Promise.all([
      client.from("post_likes").select("post_id").in("post_id", ids),
      client.from("post_favorites").select("post_id").in("post_id", ids),
    ]);
    const interactionFailure = [lk, fv].find((result) => result.error);
    if (interactionFailure) throw interactionFailure.error;
    (lk.data || []).forEach((x) => liked.add(x.post_id));
    (fv.data || []).forEach((x) => faved.add(x.post_id));
  }
  const repIds = [...new Set(posts.map((p) => p.repost_of).filter(Boolean))];
  if (repIds.length) { const { data, error } = await client.from("posts").select("*").in("id", repIds); if (error) throw error; (data || []).forEach((o) => (originals[o.id] = o)); }
  if (currentVersion !== sessionVersion) return;
  state.liked = liked; state.faved = faved; state.originals = originals;
}

function tagChips() {
  const groups = [["university", "🏫"], ["major", "🎓"], ["subject", "📚"], ["tag", "#"]];
  let out = "";
  for (const [k, pre] of groups) for (const v of globalTags[k]) {
    const id = "t:" + v;
    out += `<button class="chip ${state.filter === id ? "chip-accent" : "chip-outline"}" data-cm="filter" data-f="${esc(id)}">${pre} ${esc(v)}</button>`;
  }
  return out;
}

function feedChips() {
  const base = [["all", "推荐"], ["following", "关注"], ["mine", "我的"], ["question", "提问"], ["tip", "技巧"], ["note_share", "笔记分享"]];
  return base.map(([id, l]) => `<button class="chip ${state.filter === id ? "chip-accent" : "chip-outline"}" data-cm="filter" data-f="${esc(id)}">${l}</button>`).join("") + tagChips();
}

function suggestions() {
  const seen = new Set([me.id]); const out = [];
  for (const p of state.posts) {
    if (!p.user_id || seen.has(p.user_id) || followingIds.has(p.user_id)) continue;
    seen.add(p.user_id); out.push({ id: p.user_id, name: p.author_name, uni: p.author_university });
    if (out.length >= 5) break;
  }
  if (!out.length) return `<div class="muted" style="font-size:12.5px">暂无推荐</div>`;
  return out.map((u) => `<div class="row gap-10" style="padding:8px 0">${av(u.name, 32)}
    <div class="fill"><div style="font-size:13px;font-weight:650">${esc(u.name || "用户")}</div><div class="faint" style="font-size:11.5px">${esc(u.uni || "")}</div></div>
    <button class="btn btn-sm" data-cm="follow" data-id="${u.id}">关注</button></div>`).join("");
}

function cardsBlock() {
  if (state.error) return `<div class="card card-pad" style="color:var(--pink)">出错了：${esc(state.error)}</div>`;
  if (state.loading) return `<div class="card card-pad muted">加载中…</div>`;
  if (!state.posts.length) return `<div class="card card-pad muted" style="text-align:center;padding:36px">这里还没有帖子。</div>`;
  return `<div class="card">${state.posts.map((p) => postCard(p)).join("")}</div>`;
}

function renderFeed() {
  if (!feedEl) return;
  if (state.filter === "mine") {
    const tabs = [["posts", "发帖"], ["reposts", "转发"], ["replies", "回复"], ["liked", "赞过"], ["faved", "收藏"]];
    feedEl.innerHTML = `<div class="wrap wrap-wide">
      <div class="page-head">
        <div><a class="btn btn-ghost btn-sm" data-cm="filter" data-f="all" style="margin-bottom:8px">${ICON("chevleft")}<span>社区</span></a>
          <h1 class="page-title">我的社区</h1></div>
        <button class="btn btn-primary" data-cm="compose">${ICON("plus")}<span>发帖</span></button>
      </div>
      <div class="row gap-24" style="margin-bottom:18px">
        ${[["posts", "发帖"], ["following", "关注"], ["followers", "粉丝"]].map(([k, l]) => `<div class="center"><div class="stat-n" style="font-size:24px">${state.counts[k]}</div><div class="stat-l">${l}</div></div>`).join("")}
      </div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${state.mineTab === k ? "active" : ""}" data-cm="mtab" data-t="${k}">${l}</button>`).join("")}</div>
      ${cardsBlock()}
    </div>`;
    return wire(feedEl);
  }
  feedEl.innerHTML = `<div class="wrap wrap-wide">
    <div class="page-head">
      <div><div class="eyebrow">Community</div><h1 class="page-title">学习社区</h1>
        <p class="page-sub">分享经验、提问、晒笔记 —— 按大学 / 专业 / 学科 / 关注筛选。</p></div>
      <button class="btn btn-primary" data-cm="compose">${ICON("plus")}<span>发帖</span></button>
    </div>
    <div class="grid" style="grid-template-columns:1fr 300px;align-items:start">
      <div>
        <div class="row gap-8 wrap-flex" style="margin-bottom:16px">${feedChips()}</div>
        ${cardsBlock()}
      </div>
      <aside class="col gap-16" style="position:sticky;top:8px">
        <div class="card card-pad"><div class="eyebrow">推荐关注</div>${suggestions()}</div>
        <div class="card card-pad"><div class="eyebrow">提示</div><p class="muted" style="font-size:12.5px">发帖可多选标签(大学/专业/学科)，帖子只出现在你选的分区。点头像「关注」追更。</p></div>
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

function mediaBlock(p) {
  let h = "";
  if (p.image_url) h += `<img src="${esc(p.image_url)}" style="max-width:100%;max-height:420px;border-radius:12px;margin-top:8px;border:1px solid var(--border)"/>`;
  if (p.audio_url) h += `<audio src="${esc(p.audio_url)}" controls style="width:100%;margin-top:8px"></audio>`;
  return h;
}

function embedOriginal(o) {
  if (!o) return `<div style="background:var(--card-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin:8px 0;color:var(--ink-faint);font-size:12.5px">原帖已删除</div>`;
  return `<div data-go="post" data-post="${o.id}" style="background:var(--card-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin:8px 0;cursor:pointer">
    <div class="row gap-8" style="margin-bottom:4px">${av(o.author_name, 22)}<b style="font-size:12.5px">${esc(o.author_name || "用户")}</b><span class="faint" style="font-size:11.5px">${timeAgo(o.created_at)}</span></div>
    ${o.title ? `<div style="font-weight:650;font-size:13.5px">${esc(o.title)}</div>` : ""}
    <div class="muted" style="font-size:12.5px">${esc((o.body || "").slice(0, 140))}</div></div>`;
}

function authorRow(p, big) {
  const isMe = p.user_id === me.id;
  const following = followingIds.has(p.user_id);
  const followBtn = isMe ? "" : `<button class="btn btn-sm ${following ? "" : "btn-primary"}" data-cm="follow" data-id="${p.user_id}">${following ? "已关注" : "关注"}</button>`;
  const ownBtns = isMe ? `<button class="btn btn-sm" data-cm="edit" data-id="${p.id}">${ICON("edit")}</button><button class="btn btn-sm" data-cm="del" data-id="${p.id}">${ICON("close")}</button>` : "";
  return `<div class="row gap-8 wrap-flex" style="margin-bottom:6px">${av(p.author_name, big ? 44 : 40)}
    <div class="fill" style="min-width:0"><div class="row gap-8 wrap-flex"><b style="font-size:13.5px">${esc(p.author_name || "用户")}</b>
      <span class="meta"><span>${esc(p.author_university || "")}</span>${p.author_university ? '<span class="dot"></span>' : ""}<span>${timeAgo(p.created_at)}</span></span>
      <span class="chip chip-tag">${KIND[p.kind] || "经验"}</span></div></div>
    <div class="row gap-6">${ownBtns}${followBtn}</div></div>`;
}

function postCard(p, big) {
  return `<div class="post" ${big ? "" : `data-go="post" data-post="${p.id}" style="cursor:pointer"`}>
    <div class="fill" style="min-width:0">
      ${authorRow(p, big)}
      ${p.repost_of ? `<div class="faint" style="font-size:12px;margin:2px 0">${ICON("arrow")} 转发</div>${embedOriginal(state.originals[p.repost_of])}` : ""}
      ${p.title ? `<h3 class="serif" style="font-size:${big ? 22 : 17}px;margin-bottom:5px">${esc(p.title)}</h3>` : ""}
      ${p.body ? `<p class="muted" style="font-size:${big ? 15 : 13.5}px;line-height:1.6;white-space:pre-wrap">${esc(p.body)}</p>` : ""}
      ${mediaBlock(p)}
      <div class="row gap-6 wrap-flex mt-8">${(p.tags || []).map((t) => `<span class="chip chip-tag" data-cm="filter" data-f="t:${esc(t)}" style="cursor:pointer">#${esc(t)}</span>`).join("")}</div>
      ${actionBar(p)}
    </div></div>`;
}

/* ============ DETAIL ============ */
export async function mountPost(el, postId) {
  if (!el) return;
  const currentVersion = sessionVersion, client = sb;
  await ensureMe();
  if (currentVersion !== sessionVersion) return;
  el.innerHTML = `<div class="wrap"><div class="card card-pad muted">加载中…</div></div>`;
  let post, comments = [];
  try {
    const pr = await client.from("posts").select("*").eq("id", postId).single();
    if (pr.error) throw pr.error; post = pr.data;
    await hydrate([post], currentVersion);
    if (currentVersion !== sessionVersion) return;
    const cr = await client.from("comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
    if (cr.error) throw cr.error;
    if (currentVersion !== sessionVersion) return;
    comments = cr.data || [];
  } catch (e) {
    if (currentVersion !== sessionVersion) return;
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
    </div></div>`;
  wire(el);
}

function commentRow(c) {
  const isMe = c.user_id === me.id;
  return `<div class="row gap-10" style="padding:11px 0;border-bottom:1px solid var(--border-soft);align-items:flex-start">${av(c.author_name, 34)}
    <div class="fill"><div class="row gap-8"><b style="font-size:13px">${esc(c.author_name || "用户")}</b><span class="faint" style="font-size:11.5px">${timeAgo(c.created_at)}</span></div>
      <p class="muted" style="font-size:13.5px;margin-top:2px;white-space:pre-wrap">${esc(c.body)}</p></div>
    ${isMe ? `<button class="icon-btn" data-cm="delcomment" data-id="${c.id}" data-post="${c.post_id}" title="删除" style="width:28px;height:28px">${ICON("close")}</button>` : ""}</div>`;
}

/* ============ wiring & actions ============ */
function wire(scope) {
  scope.querySelectorAll("[data-cm]").forEach((el) => { el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handle(el.dataset.cm, el); }; });
}
function handle(action, el) {
  const id = el.dataset.id;
  if (action === "filter") { state.filter = el.dataset.f; load(); }
  else if (action === "mtab") { state.mineTab = el.dataset.t; loadMine(); }
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
  const currentVersion = sessionVersion, client = sb;
  const liked = state.liked.has(id);
  try {
    if (liked) {
      const { error } = await client.from("post_likes").delete().eq("post_id", id).eq("user_id", USER.id);
      if (error) throw error;
      if (currentVersion !== sessionVersion) return;
      state.liked.delete(id); patch(id, (p) => p.like_count = Math.max(0, (p.like_count || 0) - 1));
    } else {
      const { error } = await client.from("post_likes").insert({ post_id: id });
      if (error) throw error;
      if (currentVersion !== sessionVersion) return;
      state.liked.add(id); patch(id, (p) => p.like_count = (p.like_count || 0) + 1);
      void showPointRewardReceipt(client, "like_created", id, toastFn,
        () => currentVersion === sessionVersion);
    }
  } catch (e) { if (currentVersion === sessionVersion) toastFn("操作失败：" + (e.message || "")); }
  if (currentVersion !== sessionVersion) return;
  renderFeed();
}
async function toggleFav(id) {
  const currentVersion = sessionVersion, client = sb;
  const f = state.faved.has(id);
  try {
    if (f) {
      const { error } = await client.from("post_favorites").delete().eq("post_id", id).eq("user_id", USER.id);
      if (error) throw error;
      if (currentVersion !== sessionVersion) return;
      state.faved.delete(id); patch(id, (p) => p.favorite_count = Math.max(0, (p.favorite_count || 0) - 1)); toastFn("已取消收藏");
    } else {
      const { error } = await client.from("post_favorites").insert({ post_id: id });
      if (error) throw error;
      if (currentVersion !== sessionVersion) return;
      state.faved.add(id); patch(id, (p) => p.favorite_count = (p.favorite_count || 0) + 1); toastFn("已收藏", "check");
    }
  } catch (e) { if (currentVersion === sessionVersion) toastFn("操作失败：" + (e.message || "")); }
  if (currentVersion !== sessionVersion) return;
  renderFeed();
}
async function toggleFollow(uid) {
  const currentVersion = sessionVersion, client = sb;
  const f = followingIds.has(uid);
  try {
    if (f) {
      const { error } = await client.from("follows").delete().eq("follower_id", USER.id).eq("following_id", uid);
      if (error) throw error;
      if (currentVersion !== sessionVersion) return;
      followingIds.delete(uid); toastFn("已取消关注");
    } else {
      const { error } = await client.from("follows").insert({ following_id: uid });
      if (error) throw error;
      if (currentVersion !== sessionVersion) return;
      followingIds.add(uid); toastFn("已关注", "check");
    }
  } catch (e) { if (currentVersion === sessionVersion) toastFn("操作失败：" + (e.message || "")); }
  if (currentVersion !== sessionVersion) return;
  renderFeed();
}
async function addComment(postId) {
  const currentVersion = sessionVersion, client = sb;
  const input = document.getElementById("cm-input");
  const body = (input && input.value || "").trim();
  if (!body) { toastFn("评论不能为空"); return; }
  try { const { data, error } = await client.from("comments").insert({ post_id: postId, body }).select("id").single(); if (error) throw error; if (currentVersion !== sessionVersion) return; void showPointRewardReceipt(client, "comment_created", data?.id, toastFn, () => currentVersion === sessionVersion); const el = document.getElementById("post-root"); if (el) mountPost(el, postId); }
  catch (e) { if (currentVersion === sessionVersion) toastFn("评论失败：" + (e.message || "")); }
}
async function delComment(id, postId) {
  const currentVersion = sessionVersion, client = sb;
  if (!(await confirmDialog({ title: "删除评论", message: "确定删除这条评论？" }))) return;
  if (currentVersion !== sessionVersion) return;
  try { const { error } = await client.from("comments").delete().eq("id", id); if (error) throw error; if (currentVersion !== sessionVersion) return; const el = document.getElementById("post-root"); if (el) mountPost(el, postId); }
  catch (e) { if (currentVersion === sessionVersion) toastFn("删除失败：" + (e.message || "")); }
}
async function delPost(id) {
  const currentVersion = sessionVersion, client = sb;
  if (!(await confirmDialog({ title: "删除帖子", message: "确定删除这篇帖子？评论与互动会一并删除。" }))) return;
  if (currentVersion !== sessionVersion) return;
  try { const { error } = await client.from("posts").delete().eq("id", id); if (error) throw error; if (currentVersion !== sessionVersion) return; toastFn("已删除", "check"); load(); }
  catch (e) { if (currentVersion === sessionVersion) toastFn("删除失败：" + (e.message || "")); }
}

async function uploadMedia(file, expectedVersion = sessionVersion, client = sb, userId = USER.id) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const up = await client.storage.from("community-media").upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw up.error;
  if (expectedVersion !== sessionVersion) throw new Error("会话已切换");
  return client.storage.from("community-media").getPublicUrl(path).data.publicUrl;
}

function repostModal(id) {
  const modalVersion = sessionVersion, client = sb;
  const orig = state.posts.find((p) => p.id === id);
  const scrim = modalShell(`<h2 class="serif" style="font-size:20px;margin-bottom:12px">转发</h2>
    <textarea id="rp-body" class="search" style="width:100%;background:var(--card-2);min-height:80px;align-items:flex-start" placeholder="说点什么（可选）…"></textarea>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x="cancel">取消</button><button class="btn btn-primary" data-x="save">转发</button></div>`);
  scrim.querySelector('[data-x="cancel"]').onclick = () => scrim.remove();
  const btn = scrim.querySelector('[data-x="save"]'); let saving = false;
  btn.onclick = async () => {
    if (saving) return; saving = true; btn.disabled = true; btn.textContent = "转发中…";
    try {
      const body = scrim.querySelector("#rp-body").value.trim();
      const { data, error } = await client.from("posts").insert({ repost_of: id, body: body || null, kind: "experience", tags: orig ? (orig.tags || []) : [] }).select("id").single();
      if (error) throw error; if (modalVersion !== sessionVersion) return; scrim.remove(); toastFn("已转发", "check"); void showPointRewardReceipt(client, "repost_created", data?.id, toastFn, () => modalVersion === sessionVersion); state.filter = "all"; load();
    } catch (e) { if (modalVersion !== sessionVersion) return; saving = false; btn.disabled = false; btn.textContent = "转发"; toastFn("转发失败：" + (e.message || "")); }
  };
}

function composer(existing) {
  const composerVersion = sessionVersion, client = sb;
  const isEdit = !!existing;
  const selected = new Set(existing && existing.tags || []);
  let imageUrl = existing && existing.image_url || null;
  let audioUrl = existing && existing.audio_url || null;
  const kindOpts = Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${existing && existing.kind === k ? "selected" : ""}>${l}</option>`).join("");
  const scrim = modalShell(`<h2 class="serif" style="font-size:20px;margin-bottom:12px">${isEdit ? "编辑帖子" : "发帖"}</h2>
    <select id="ps-kind" class="search" style="width:100%;background:var(--card-2);margin-bottom:10px">${kindOpts}</select>
    <input id="ps-title" class="search" style="width:100%;background:var(--card-2);margin-bottom:10px" placeholder="标题（可选）" value="${esc(existing && existing.title || "")}"/>
    <textarea id="ps-body" class="search" style="width:100%;background:var(--card-2);min-height:110px;align-items:flex-start;margin-bottom:10px" placeholder="分享你的想法、问题或经验…">${esc(existing && existing.body || "")}</textarea>
    <div class="eyebrow">标签（大学 / 专业 / 学科，可多选）</div>
    <div id="ps-tags" class="row gap-6 wrap-flex" style="margin:6px 0 8px;max-height:120px;overflow:auto"></div>
    <input id="ps-tagnew" class="search" style="width:100%;background:var(--card-2);margin-bottom:10px" placeholder="自定义标签，回车添加"/>
    <div class="eyebrow">附件</div>
    <div class="row gap-8" style="margin:6px 0"><button class="btn btn-sm" data-x="img">${ICON("upload")}<span>图片</span></button><button class="btn btn-sm" data-x="audio">${ICON("upload")}<span>音频</span></button></div>
    <div id="ps-media"></div>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x="cancel">取消</button><button class="btn btn-primary" data-x="save">${isEdit ? "保存" : "发布"}</button></div>`);

  const tagsEl = scrim.querySelector("#ps-tags");
  const drawTags = () => {
    const groups = [["university", "🏫"], ["major", "🎓"], ["subject", "📚"], ["tag", "#"]];
    let out = "";
    for (const [k, pre] of groups) for (const v of globalTags[k]) out += `<button class="chip ${selected.has(v) ? "chip-accent" : "chip-outline"}" data-tag="${esc(v)}">${pre} ${esc(v)}</button>`;
    tagsEl.innerHTML = out || `<span class="muted" style="font-size:12px">暂无标签，可在下方自定义</span>`;
    tagsEl.querySelectorAll("[data-tag]").forEach((b) => b.onclick = () => { const v = b.dataset.tag; selected.has(v) ? selected.delete(v) : selected.add(v); drawTags(); });
  };
  drawTags();
  const tagNew = scrim.querySelector("#ps-tagnew");
  tagNew.onkeydown = async (e) => {
    if (e.key !== "Enter") return; e.preventDefault();
    const v = tagNew.value.trim(); if (!v) return; tagNew.value = "";
    if (!globalTags.tag.includes(v)) globalTags.tag.push(v);
    selected.add(v); drawTags();
    try { const { error } = await client.from("tags").insert({ kind: "tag", value: v }); if (error) throw error; }
    catch (e) { if (composerVersion === sessionVersion) toastFn("标签保存失败：" + (e.message || "")); }
  };

  const mediaEl = scrim.querySelector("#ps-media");
  const drawMedia = () => {
    let h = "";
    if (imageUrl) h += `<div class="row between" style="margin-top:6px"><img src="${esc(imageUrl)}" style="height:48px;border-radius:6px"/><button class="btn btn-sm" data-rm="img">移除图片</button></div>`;
    if (audioUrl) h += `<div class="row between" style="margin-top:6px"><span class="muted" style="font-size:12.5px">已添加音频</span><button class="btn btn-sm" data-rm="audio">移除音频</button></div>`;
    mediaEl.innerHTML = h;
    const ri = mediaEl.querySelector('[data-rm="img"]'); if (ri) ri.onclick = () => { imageUrl = null; drawMedia(); };
    const ra = mediaEl.querySelector('[data-rm="audio"]'); if (ra) ra.onclick = () => { audioUrl = null; drawMedia(); };
  };
  const pick = (accept, set) => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = accept; inp.style.display = "none"; document.body.appendChild(inp);
    inp.onchange = async () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return; toastFn("上传中…", "upload"); try { const u = await uploadMedia(f, composerVersion, client); if (composerVersion !== sessionVersion) return; set(u); drawMedia(); toastFn("已添加", "check"); } catch (e) { if (composerVersion === sessionVersion) toastFn("上传失败：" + (e.message || "")); } };
    inp.click();
  };
  scrim.querySelector('[data-x="img"]').onclick = () => pick("image/*", (u) => imageUrl = u);
  scrim.querySelector('[data-x="audio"]').onclick = () => pick("audio/*", (u) => audioUrl = u);
  scrim.querySelector('[data-x="cancel"]').onclick = () => scrim.remove();

  const btn = scrim.querySelector('[data-x="save"]'); let saving = false;
  btn.onclick = async () => {
    if (saving) return;
    const title = scrim.querySelector("#ps-title").value.trim();
    const body = scrim.querySelector("#ps-body").value.trim();
    if (!title && !body && !imageUrl && !audioUrl) { toastFn("写点内容或加个附件再发布"); return; }
    const row = { kind: scrim.querySelector("#ps-kind").value, title: title || null, body: body || null, tags: [...selected], image_url: imageUrl, audio_url: audioUrl };
    saving = true; btn.disabled = true; btn.textContent = isEdit ? "保存中…" : "发布中…";
    try {
      let createdId = null;
      if (isEdit) { const { error } = await client.from("posts").update(row).eq("id", existing.id); if (error) throw error; }
      else { const { data, error } = await client.from("posts").insert(row).select("id").single(); if (error) throw error; createdId = data?.id; }
      if (composerVersion !== sessionVersion) return;
      if (isEdit) toastFn("已保存", "check");
      else { toastFn("已发布", "check"); void showPointRewardReceipt(client, "post_created", createdId, toastFn, () => composerVersion === sessionVersion); state.filter = "all"; }
      scrim.remove(); load();
    } catch (e) { if (composerVersion !== sessionVersion) return; saving = false; btn.disabled = false; btn.textContent = isEdit ? "保存" : "发布"; toastFn("失败：" + (e.message || "")); }
  };
}

function modalShell(inner) {
  const scrim = document.createElement("div"); scrim.className = "scrim";
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
