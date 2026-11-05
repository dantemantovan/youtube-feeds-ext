import { FEED_IDS, FEED_META } from "./shared/defaults.js";

const tabsEl = document.getElementById("tabs");
const contentEl = document.getElementById("content");
const statusEl = document.getElementById("status");
const feedDescEl = document.getElementById("feedDesc");
const errorsEl = document.getElementById("errors");
const shortsToggle = document.getElementById("shortsToggle");
const refreshBtn = document.getElementById("refreshBtn");

const ALGORITHM_ID = "algorithm";
const PLAYLISTS_ID = "playlists";
const ALGORITHM_META = {
  name: "Algorithm",
  icon: "✨",
  description: "Your YouTube Home recommendations, scraped into the same cards as other feeds (no API key)",
};
const PLAYLISTS_META = {
  name: "Playlists",
  icon: "📂",
  description: "Your YouTube playlists — click one to browse its videos",
};

const state = {
  feedId: ((v) => (v === "lore" ? "longform" : v))(localStorage.getItem("yfn.activeFeed")) || "longform",
  loading: false,
  playlist: null, // open playlist {playlistId, name, url, ...} or null
};
const sortEl = document.getElementById("sortSelect");
const SORT_LABELS = {
  recommended: "Recommended (Home order)",
  newest: "Newest to oldest",
  oldest: "Oldest to newest",
  popular: "Most popular",
  unpopular: "Least popular",
};
let sortPrefs = {};
let currentVideos = []; // videos currently rendered (for re-sorting)

function sortKey() {
  if (state.feedId === PLAYLISTS_ID) return "playlist";
  return state.feedId;
}
function currentSort() {
  if (sortPrefs[sortKey()]) return sortPrefs[sortKey()];
  return state.feedId === ALGORITHM_ID ? "recommended" : "newest";
}
function sortVideos(list, mode) {
  if (mode === "recommended") return list.slice();
  const out = list.map((v, i) => ({ v, i }));
  const views = (x) => x.v.views;
  out.sort((a, b) => {
    if (mode === "popular" || mode === "unpopular") {
      const va = views(a), vb = views(b);
      if (va == null && vb == null) return a.i - b.i;
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
  // Recommended only makes sense for Algorithm (Home scrape order)
  for (const opt of sortEl.options) {
    if (opt.value === "recommended") {
      opt.hidden = state.feedId !== ALGORITHM_ID;
      opt.disabled = state.feedId !== ALGORITHM_ID;
    }
  }
  const hasViews = currentVideos.some((v) => v.views != null);
  for (const opt of sortEl.options) {
    if (opt.value === "popular" || opt.value === "unpopular") {
      opt.disabled = !hasViews;
      opt.textContent = SORT_LABELS[opt.value] + (hasViews ? "" : " (loading views…)");
    }
  }
  const mode = currentSort();
  if (mode === "recommended" && state.feedId !== ALGORITHM_ID) {
    sortEl.value = "newest";
  } else {
    sortEl.value = mode;
  }
}
function applySort() {
  const mode = currentSort();
  if ((mode === "popular" || mode === "unpopular") && !currentVideos.some((v) => v.views != null)) return;
  const byId = new Map([...contentEl.querySelectorAll("a.card[data-vid]")].map((el) => [el.dataset.vid, el]));
  for (const v of sortVideos(currentVideos, mode)) {
    const el = byId.get(v.id);
    if (el) contentEl.appendChild(el);
  }
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

function tabMeta(id) {
  if (id === ALGORITHM_ID) return ALGORITHM_META;
  if (id === PLAYLISTS_ID) return PLAYLISTS_META;
  return FEED_META[id];
}

function renderTabs() {
  tabsEl.innerHTML = "";
  const ids = [...FEED_IDS, ALGORITHM_ID, PLAYLISTS_ID];
  for (const id of ids) {
    const meta = tabMeta(id);
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
  const meta = tabMeta(state.feedId);
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
      <a class="btn btn-primary" href="options.html" target="_blank" rel="noopener">Add channels in Settings</a>
    </div>`;
}

function algorithmEmpty(res) {
  contentEl.className = "";
  const signedOut = res?.code === "SIGNED_OUT" || res?.signedIn === false;
  contentEl.innerHTML = `
    <div class="empty">
      <h2>${signedOut ? "Sign in to YouTube" : "No recommendations yet"}</h2>
      <p>${signedOut
        ? "Open youtube.com in this Chrome profile and sign in, then come back and Sync / Refresh. Algorithm scrapes your Home feed into cards here — it does not open YouTube Home."
        : escapeHtml(res?.error || "Couldn't load Home recommendations. Try Refresh.")}</p>
      <button type="button" class="btn btn-primary" id="algoRetry">↻ Sync / Refresh</button>
    </div>`;
  contentEl.querySelector("#algoRetry")?.addEventListener("click", () => loadAlgorithm(true));
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
  const ordered =
    (mode === "popular" || mode === "unpopular") && !videos.some((v) => v.views != null)
      ? videos
      : sortVideos(videos, mode);
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
          <span>${escapeHtml(v.published || relativeTime(v.publishedMs || v.published))}</span>
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
  const CHUNK = 8;
  for (let i = 0; i < ids.length; i += CHUNK) {
    if (token !== durationToken) return;
    const res = await send({ type: "GET_DURATIONS", ids: ids.slice(i, i + CHUNK), viewIds: ids.slice(i, i + CHUNK) });
    if (token !== durationToken) return;
    const durations = (res && res.ok && res.durations) || {};
    let gotViews = false;
    for (const [id, n] of Object.entries((res && res.views) || {})) {
      const v = currentVideos.find((x) => x.id === id);
      if (v && v.views == null) {
        v.views = n;
        gotViews = true;
      }
      contentEl.querySelectorAll(`.views[data-vid="${CSS.escape(id)}"]`).forEach((el) => (el.textContent = formatViews(n)));
    }
    if (gotViews) {
      updateSortControl();
      if (/popular/.test(currentSort())) applySort();
    }
    for (const [id, sec] of Object.entries(durations)) {
      contentEl.querySelectorAll(`.duration[data-vid="${CSS.escape(id)}"]`).forEach((el) => {
        if (sec) el.textContent = formatDuration(sec);
        else el.hidden = true; // live/unknown: hide, don't destroy
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

  if (res.allDisabled) {
    statusEl.textContent = "";
    contentEl.className = "";
    contentEl.innerHTML = `
      <div class="empty">
        <h2>All channels disabled</h2>
        <p>Enable at least one channel for this feed in Settings.</p>
        <a class="btn btn-primary" href="options.html" target="_blank" rel="noopener">Open Settings</a>
      </div>`;
    return;
  }

  if (res.empty || (!res.videos?.length && !res.errors?.length)) {
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

async function loadAlgorithm(force = false) {
  if (state.loading) return;
  state.loading = true;
  statusEl.textContent = force ? "Syncing Home…" : "Loading…";
  statusEl.classList.remove("error");
  errorsEl.hidden = true;
  skeleton();

  const res = await send({ type: "FETCH_ALGORITHM", force });
  state.loading = false;
  if (state.feedId !== ALGORITHM_ID) return;

  if (!res.ok) {
    statusEl.textContent = "";
    statusEl.classList.add("error");
    algorithmEmpty(res);
    return;
  }

  renderVideos(res.videos || []);
  const count = (res.videos || []).length;
  const age = res.scrapedAt ? relativeTime(res.scrapedAt).replace(/^in /, "") : "";
  const cacheNote = res.cached ? (res.stale ? " · stale cache" : " · cached") : " · just scraped";
  statusEl.textContent = count
    ? `${count} recommendation${count === 1 ? "" : "s"}${cacheNote}${age && res.cached ? ` · ${age}` : ""}`
    : "";
  if (res.warning) {
    errorsEl.hidden = false;
    errorsEl.className = "errors";
    errorsEl.innerHTML = `<details open><summary>Using cached results</summary><p>${escapeHtml(res.warning)}</p></details>`;
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
  if (state.feedId === ALGORITHM_ID) return loadAlgorithm(false);
  if (state.feedId !== PLAYLISTS_ID) return loadFeed();
  return state.playlist ? openPlaylist(state.playlist) : loadPlaylists();
}

function playlistEmpty() {
  contentEl.className = "";
  contentEl.innerHTML = `
    <div class="empty">
      <h2>Playlists load after sync</h2>
      <p>No playlists stored yet. In Settings you can sync from YouTube (uses your browser's YouTube login), paste a playlist URL, or import a JSON list.</p>
      <a class="btn btn-primary" href="options.html#playlists" target="_blank" rel="noopener">Manage playlists in Settings</a>
    </div>`;
}

function formatVideoCount(n) {
  if (n == null || Number.isNaN(n)) return "";
  return `${n} video${n === 1 ? "" : "s"}`;
}

async function loadPlaylists(force = false) {
  durationToken++;
  statusEl.textContent = "Loading playlists…";
  statusEl.classList.remove("error");
  errorsEl.hidden = true;
  const res = await send(force ? { type: "REFRESH_PLAYLISTS" } : { type: "GET_PLAYLISTS" });
  if (state.feedId !== PLAYLISTS_ID || state.playlist) return;
  const all = res.playlists || [];
  const list = all.filter((p) => p.enabled !== false);
  if (!res.ok) {
    statusEl.textContent = res.error || "Failed";
    statusEl.classList.add("error");
  } else {
    const disabled = all.length - list.length;
    statusEl.textContent =
      `${list.length} playlist${list.length === 1 ? "" : "s"}` +
      (disabled ? ` · ${disabled} disabled in Settings` : "");
  }
  currentVideos = [];
  updateSortControl();
  if (!list.length) {
    if (all.length) {
      contentEl.className = "";
      contentEl.innerHTML = `
        <div class="empty">
          <h2>All playlists disabled</h2>
          <p>Enable playlists in Settings to browse them here.</p>
          <a class="btn btn-primary" href="options.html#playlists" target="_blank" rel="noopener">Open Settings</a>
        </div>`;
      return;
    }
    return playlistEmpty();
  }
  contentEl.className = "grid playlist-grid";
  contentEl.innerHTML = "";
  for (const p of list) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card playlist-card";
    const thumbUrl = p.thumbnail || "";
    const countLabel = formatVideoCount(p.videoCount) || "Playlist";
    card.innerHTML = `
      <div class="card-thumb pl-thumb">
        <div class="pl-stack" aria-hidden="true">
          <span class="pl-stack-layer"></span>
          <span class="pl-stack-layer"></span>
        </div>
        ${
          thumbUrl
            ? `<img src="${escapeAttr(thumbUrl)}" alt="" loading="lazy" />`
            : `<div class="pl-placeholder">📂</div>`
        }
        <div class="pl-count-badge">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M22 7H2v1h20V7zm-9 5H2v1h11v-1zm0 5H2v1h11v-1zm7-5v7l5-3.5L20 12z"/></svg>
          <span>${escapeHtml(countLabel)}</span>
        </div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(p.name)}</h3>
        <div class="card-meta">
          <span>View full playlist</span>
          ${p.source && p.source !== "manual" ? `<span class="pl-privacy">${escapeHtml(p.source)}</span>` : ""}
        </div>
      </div>`;
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
  header.innerHTML = `
    <button type="button" class="btn" id="plBack">← All playlists</button>
    <strong>${escapeHtml(p.name || res.title || "Playlist")}</strong>
    <a class="btn" href="${escapeAttr(p.url || `https://www.youtube.com/playlist?list=${p.playlistId}`)}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>`;
  header.querySelector("#plBack").addEventListener("click", () => {
    state.playlist = null;
    loadPlaylists();
  });

  if (!res.ok) {
    contentEl.className = "";
    contentEl.innerHTML = `<div class="empty"><h2>Couldn't load this playlist</h2><p>${escapeHtml(res.error)}</p></div>`;
    contentEl.prepend(header);
    statusEl.textContent = "";
    return;
  }

  const videos = res.videos || [];
  if (!videos.length) {
    contentEl.className = "";
    contentEl.innerHTML = `<div class="empty"><h2>No public videos in RSS</h2><p>Private/auto playlists (Liked, Watch later) or empty playlists don't expose a feed. Open it on YouTube instead.</p></div>`;
    contentEl.prepend(header);
    statusEl.textContent = "";
    currentVideos = [];
    updateSortControl();
    return;
  }

  // Same video card component as channel feeds
  renderVideos(videos);
  contentEl.prepend(header);
  const n = videos.length;
  statusEl.textContent = `${n} video${n === 1 ? "" : "s"} · RSS shows up to 15`;
}

refreshBtn.addEventListener("click", () => {
  if (state.feedId === ALGORITHM_ID) return loadAlgorithm(true);
  if (state.feedId === PLAYLISTS_ID) {
    return state.playlist ? openPlaylist(state.playlist) : loadPlaylists(true);
  }
  return loadFeed();
});

renderTabs();
initShortsToggle();
chrome.storage.local.get("feedSort").then((r) => {
  sortPrefs = r.feedSort || {};
  loadCurrent();
});
