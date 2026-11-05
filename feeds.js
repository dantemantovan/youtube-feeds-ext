import { FEED_IDS, FEED_META } from "./shared/defaults.js";

const tabsEl = document.getElementById("tabs");
const contentEl = document.getElementById("content");
const statusEl = document.getElementById("status");
const feedDescEl = document.getElementById("feedDesc");
const errorsEl = document.getElementById("errors");
const shortsToggle = document.getElementById("shortsToggle");
const refreshBtn = document.getElementById("refreshBtn");

const state = {
  feedId: ((v) => (v === "lore" ? "longform" : v))(localStorage.getItem("yfn.activeFeed")) || "longform",
  loading: false,
  playlist: null, // open playlist {playlistId, name} or null
};
const PLAYLISTS_ID = "playlists";
const sortEl = document.getElementById("sortSelect");
const SORT_LABELS = { newest: "Newest to oldest", oldest: "Oldest to newest", popular: "Most popular", unpopular: "Least popular" };
let sortPrefs = {};
let currentVideos = []; // videos currently rendered (for re-sorting)
function sortKey() { return state.feedId === PLAYLISTS_ID ? "playlist" : state.feedId; }
function currentSort() { return sortPrefs[sortKey()] || "newest"; }
function sortVideos(list, mode) {
  const out = list.map((v, i) => ({ v, i }));
  const views = (x) => x.v.views;
  out.sort((a, b) => {
    if (mode === "popular" || mode === "unpopular") {
      const va = views(a), vb = views(b);
      if (va == null && vb == null) return a.i - b.i; // keep RSS order
      if (va == null) return 1;
      if (vb == null) return -1;
      return mode === "popular" ? vb - va : va - vb;
    }
    const pa = a.v.publishedMs || 0, pb = b.v.publishedMs || 0;
    if (!pa && !pb) return a.i - b.i;
    return mode === "oldest" ? pa - pb : pb - pa;
  });
  return out.map((x) => x.v);
}
function updateSortControl() {
  const listOpen = state.feedId !== PLAYLISTS_ID || state.playlist;
  sortEl.hidden = !listOpen;
  const hasViews = currentVideos.some((v) => v.views != null);
  for (const opt of sortEl.options) {
    if (opt.value === "popular" || opt.value === "unpopular") {
      opt.disabled = !hasViews;
      opt.textContent = SORT_LABELS[opt.value] + (hasViews ? "" : " (loading views…)");
    }
  }
  sortEl.value = currentSort();
}
function applySort() {
  const mode = currentSort();
  if ((mode === "popular" || mode === "unpopular") && !currentVideos.some((v) => v.views != null)) return; // wait for counts
  const byId = new Map([...contentEl.querySelectorAll("a.card[data-vid]")].map((el) => [el.dataset.vid, el]));
  for (const v of sortVideos(currentVideos, mode)) { const el = byId.get(v.id); if (el) contentEl.appendChild(el); }
}
sortEl.addEventListener("change", async () => {
  sortPrefs[sortKey()] = sortEl.value;
  await chrome.storage.local.set({ feedSort: sortPrefs });
  applySort();
});
function formatViews(n) {
  if (n == null) return "";
  return new Intl.NumberFormat("en", { notation: "compact" }).format(n) + " views";
}
const PLAYLISTS_META = { name: "Playlists", icon: "📂", description: "Your YouTube playlists — click one to browse its videos" };

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: "No response" });
    });
  });
}

function relativeTime(isoOrMs) {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs || "");
  if (!ms || Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  const week = Math.round(day / 7);
  const month = Math.round(day / 30);
  const year = Math.round(day / 365);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(sec) < 60) return rtf.format(-sec, "second");
  if (Math.abs(min) < 60) return rtf.format(-min, "minute");
  if (Math.abs(hr) < 24) return rtf.format(-hr, "hour");
  if (Math.abs(day) < 7) return rtf.format(-day, "day");
  if (Math.abs(week) < 5) return rtf.format(-week, "week");
  if (Math.abs(month) < 12) return rtf.format(-month, "month");
  return rtf.format(-year, "year");
}

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const id of [...FEED_IDS, PLAYLISTS_ID]) {
    const meta = id === PLAYLISTS_ID ? PLAYLISTS_META : FEED_META[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab" + (id === state.feedId ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", id === state.feedId ? "true" : "false");
    btn.dataset.feedId = id;
    btn.textContent = `${meta.icon} ${meta.name}`;
    btn.addEventListener("click", () => {
      state.feedId = id;
      localStorage.setItem("yfn.activeFeed", id);
      state.playlist = null;
      renderTabs();
      loadCurrent();
    });
    tabsEl.appendChild(btn);
  }
  const meta = state.feedId === PLAYLISTS_ID ? PLAYLISTS_META : FEED_META[state.feedId];
  feedDescEl.textContent = meta ? meta.description : "";
}

function skeleton(n = 8) {
  contentEl.className = "grid skeleton";
  contentEl.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="card-thumb"></div><div class="card-body"><div class="card-title">&nbsp;</div></div>`;
    contentEl.appendChild(card);
  }
}

function emptyState() {
  contentEl.className = "";
  contentEl.innerHTML = `
    <div class="empty">
      <h2>No videos yet</h2>
      <p>This feed has no channels yet. Add channel URLs or @handles in Settings — the extension ships only a couple of generic examples.</p>
      <a class="btn btn-primary" href="options.html">Add channels in Settings</a>
    </div>`;
}

function renderVideos(videos) {
  if (!videos.length) {
    emptyState();
    return;
  }
  contentEl.className = "grid";
  contentEl.innerHTML = "";
  currentVideos = videos;
  updateSortControl();
  const mode = currentSort();
  const ordered = (mode === "popular" || mode === "unpopular") && !videos.some((v) => v.views != null) ? videos : sortVideos(videos, mode);
  for (const v of ordered) {
    const a = document.createElement("a");
    a.className = "card";
    a.dataset.vid = v.id;
    a.href = v.link || `https://www.youtube.com/watch?v=${v.id}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `
      <div class="card-thumb">
        <img src="${escapeAttr(v.thumbnail)}" alt="" loading="lazy" />
        <span class="duration" data-vid="${escapeAttr(v.id)}">${v.duration ? formatDuration(v.duration) : "…"}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(v.title)}</h3>
        <div class="card-meta">
          <span>${escapeHtml(v.author || "")}</span>
          <span class="views" data-vid="${escapeAttr(v.id)}">${escapeHtml(formatViews(v.views))}</span>
          <span>${escapeHtml(relativeTime(v.publishedMs || v.published))}</span>
        </div>
      </div>`;
    contentEl.appendChild(a);
  }
  loadDurations(videos.filter((v) => !v.duration || v.views == null).map((v) => v.id));
}

function formatDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

let durationToken = 0;
async function loadDurations(ids) {
  const token = ++durationToken;
  const CHUNK = 8; // background limits concurrency to 4 per request
  for (let i = 0; i < ids.length; i += CHUNK) {
    if (token !== durationToken) return; // feed switched
    const res = await send({ type: "GET_DURATIONS", ids: ids.slice(i, i + CHUNK), viewIds: ids.slice(i, i + CHUNK) });
    if (token !== durationToken) return;
    const durations = (res && res.ok && res.durations) || {};
    let gotViews = false;
    for (const [id, n] of Object.entries((res && res.views) || {})) {
      const v = currentVideos.find((x) => x.id === id);
      if (v && v.views == null) { v.views = n; gotViews = true; }
      contentEl.querySelectorAll(`.views[data-vid="${CSS.escape(id)}"]`).forEach((el) => (el.textContent = formatViews(n)));
    }
    if (gotViews) { updateSortControl(); if (/popular/.test(currentSort())) applySort(); }
    for (const [id, sec] of Object.entries(durations)) {
      contentEl.querySelectorAll(`.duration[data-vid="${CSS.escape(id)}"]`).forEach((el) => {
        if (sec) el.textContent = formatDuration(sec);
        else el.remove();
      });
    }
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

async function loadFeed() {
  if (state.loading) return;
  state.loading = true;
  statusEl.textContent = "Loading…";
  statusEl.classList.remove("error");
  errorsEl.hidden = true;
  skeleton();

  const res = await send({ type: "FETCH_FEED", feedId: state.feedId });
  state.loading = false;

  if (!res.ok) {
    statusEl.textContent = res.error || "Failed to load feed";
    statusEl.classList.add("error");
    emptyState();
    return;
  }

  if (res.empty || (!res.videos?.length && !res.errors?.length)) {
    // Distinguish: no channels vs channels but no videos
    const ch = await send({ type: "GET_FEED_CHANNELS", feedId: state.feedId });
    if (!ch.channels?.length) {
      statusEl.textContent = "";
      emptyState();
      return;
    }
  }

  renderVideos(res.videos || []);
  const count = (res.videos || []).length;
  statusEl.textContent = count
    ? `${count} video${count === 1 ? "" : "s"} · RSS (~15 per channel)`
    : "No long-form videos found";

  if (res.errors?.length) {
    errorsEl.hidden = false;
    errorsEl.className = "errors";
    errorsEl.innerHTML = `<details open><summary>${res.errors.length} channel(s) failed</summary><ul>${res.errors
      .map((e) => `<li><strong>${escapeHtml(e.channel)}</strong>: ${escapeHtml(e.error)}</li>`)
      .join("")}</ul></details>`;
  }
}

async function initShortsToggle() {
  const res = await send({ type: "GET_SETTINGS" });
  const on = res.settings?.hideShorts !== false;
  shortsToggle.classList.toggle("on", on);
  shortsToggle.setAttribute("aria-pressed", on ? "true" : "false");

  shortsToggle.addEventListener("click", async () => {
    const next = !shortsToggle.classList.contains("on");
    shortsToggle.classList.toggle("on", next);
    shortsToggle.setAttribute("aria-pressed", next ? "true" : "false");
    await send({ type: "SAVE_SETTINGS", settings: { hideShorts: next } });
  });
}

function loadCurrent() {
  if (state.feedId !== PLAYLISTS_ID) return loadFeed();
  return state.playlist ? openPlaylist(state.playlist) : loadPlaylists();
}

function playlistEmpty() {
  contentEl.className = "";
  contentEl.innerHTML = `
    <div class="empty">
      <h2>Playlists load after sync</h2>
      <p>No playlists stored yet. In Settings you can sync from YouTube (uses your browser's YouTube login), paste a playlist URL, or import a JSON list.</p>
      <a class="btn btn-primary" href="options.html#playlists">Manage playlists in Settings</a>
    </div>`;
}

async function loadPlaylists(force = false) {
  durationToken++;
  statusEl.textContent = "Loading playlists…";
  statusEl.classList.remove("error");
  errorsEl.hidden = true;
  const res = await send(force ? { type: "REFRESH_PLAYLISTS" } : { type: "GET_PLAYLISTS" });
  if (state.feedId !== PLAYLISTS_ID || state.playlist) return;
  const list = res.playlists || [];
  if (!res.ok) { statusEl.textContent = res.error || "Failed"; statusEl.classList.add("error"); }
  else statusEl.textContent = `${list.length} playlist${list.length === 1 ? "" : "s"}`;
  currentVideos = []; updateSortControl();
  if (!list.length) return playlistEmpty();
  contentEl.className = "grid";
  contentEl.innerHTML = "";
  for (const p of list) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card playlist-card";
    const thumb = p.thumbnail
      ? `<img src="${escapeAttr(p.thumbnail)}" alt="" loading="lazy" />`
      : `<div class="pl-placeholder">📂</div>`;
    card.innerHTML = `
      <div class="card-thumb">${thumb}${p.videoCount ? `<span class="duration">${p.videoCount} videos</span>` : ""}</div>
      <div class="card-body"><h3 class="card-title">${escapeHtml(p.name)}</h3>
        <div class="card-meta"><span>Playlist</span></div></div>`;
    card.addEventListener("click", () => openPlaylist(p));
    contentEl.appendChild(card);
  }
}

async function openPlaylist(p) {
  state.playlist = p;
  durationToken++;
  statusEl.textContent = "Loading playlist…";
  statusEl.classList.remove("error");
  errorsEl.hidden = true;
  skeleton();
  const res = await send({ type: "FETCH_PLAYLIST", playlistId: p.playlistId });
  if (state.playlist !== p) return;
  const header = document.createElement("div");
  header.className = "playlist-header";
  header.innerHTML = `<button type="button" class="btn" id="plBack">← All playlists</button>
    <strong>${escapeHtml(p.name)}</strong>
    <a class="btn" href="${escapeAttr(p.url)}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>`;
  header.querySelector("#plBack").addEventListener("click", () => { state.playlist = null; loadPlaylists(); });
  if (!res.ok) {
    contentEl.className = "";
    contentEl.innerHTML = `<div class="empty"><h2>Couldn't load this playlist</h2><p>${escapeHtml(res.error)}</p></div>`;
    contentEl.prepend(header);
    statusEl.textContent = "";
    return;
  }
  renderVideos(res.videos || []);
  if (!(res.videos || []).length) {
    contentEl.innerHTML = `<div class="empty"><h2>No public videos in RSS</h2><p>Private/auto playlists (Liked, Watch later) or empty playlists don't expose a feed. Open it on YouTube instead.</p></div>`;
    contentEl.className = "";
  }
  contentEl.prepend(header);
  const n = (res.videos || []).length;
  statusEl.textContent = `${n} video${n === 1 ? "" : "s"} · RSS shows up to 15`;
}

refreshBtn.addEventListener("click", () =>
  state.feedId === PLAYLISTS_ID ? (state.playlist ? openPlaylist(state.playlist) : loadPlaylists(true)) : loadFeed());

renderTabs();
initShortsToggle();
chrome.storage.local.get("feedSort").then((r) => { sortPrefs = r.feedSort || {}; loadCurrent(); });
