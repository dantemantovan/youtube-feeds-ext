import { h, setChildren, svgPath, safeUrl } from "./shared/dom.js";

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
  curated: [], // [{id, name, icon, description, builtin}]
};
const sortEl = document.getElementById("sortSelect");
const SORT_LABELS = {
  recommended: "Recommended (Home order)",
  newest: "Newest to oldest",
  oldest: "Oldest to newest",
  popular: "Most popular",
  unpopular: "Least popular",
  longest: "Longest to shortest",
  shortest: "Shortest to longest",
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
/** Normalize duration to seconds: number, numeric string, or HH:MM:SS / MM:SS. */
function durationSeconds(d) {
  if (d == null || d === "") return null;
  if (typeof d === "number") return Number.isFinite(d) && d > 0 ? d : null;
  const s = String(d).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : null;
  }
  if (/^\d+(:\d{2}){1,2}$/.test(s)) {
    const n = s.split(":").reduce((a, x) => a * 60 + Number(x), 0);
    return n > 0 ? n : null;
  }
  return null;
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
    if (mode === "longest" || mode === "shortest") {
      const da = durationSeconds(a.v.duration), db = durationSeconds(b.v.duration);
      // Missing duration always sorts last (even for shortest) so unknowns don't rank as short.
      if (da == null && db == null) return a.i - b.i;
      if (da == null) return 1;
      if (db == null) return -1;
      return mode === "longest" ? db - da : da - db;
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
  const hasDurations = currentVideos.some((v) => durationSeconds(v.duration) != null);
  for (const opt of sortEl.options) {
    if (opt.value === "popular" || opt.value === "unpopular") {
      opt.disabled = !hasViews;
      opt.textContent = SORT_LABELS[opt.value] + (hasViews ? "" : " (loading views…)");
    }
    if (opt.value === "longest" || opt.value === "shortest") {
      opt.disabled = !hasDurations;
      opt.textContent = SORT_LABELS[opt.value] + (hasDurations ? "" : " (loading durations…)");
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
  if ((mode === "longest" || mode === "shortest") && !currentVideos.some((v) => durationSeconds(v.duration) != null)) return;
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

/** Short local datetime for video cards: M/D/YY h:mm AM/PM (browser local TZ). */
function formatLocalDateTime(isoOrMs) {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs || "");
  if (!ms || Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${date} ${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Card published label: prefer absolute local datetime; never show raw ISO. */
function formatCardPublished(v) {
  const formatted = formatLocalDateTime(v.publishedMs || v.published);
  if (formatted) return formatted;
  const p = (v.published || "").trim();
  // Keep non-ISO relative labels (e.g. "2 hours ago") only when no parseable date.
  if (p && !/^\d{4}-\d{2}-\d{2}T/.test(p) && !/^\d{4}-\d{2}-\d{2}\b/.test(p)) return p;
  return "";
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
  const f = state.curated.find((x) => x.id === id);
  return f ? { ...f, icon: f.icon || "📁", description: f.description || `Curated feed: ${f.name}` } : null;
}

function renderTabs() {
  tabsEl.replaceChildren();
  const ids = [...state.curated.map((f) => f.id), ALGORITHM_ID, PLAYLISTS_ID];
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
  contentEl.replaceChildren();
  for (let i = 0; i < n; i++) {
    contentEl.appendChild(
      h("div", { class: "card" }, h("div", { class: "card-thumb" }), h("div", { class: "card-body" }, h("div", { class: "card-title" }, "\u00a0")))
    );
  }
}

function emptyState() {
  contentEl.className = "";
  setChildren(contentEl, h("div", { class: "empty" },
      h("h2", null, "No videos yet"),
      h("p", null, "This feed has no channels yet. Add channel URLs or @handles in Settings — the extension ships only a couple of generic examples."),
      h("a", { class: "btn btn-primary", href: "options.html", target: "_blank", rel: "noopener" }, "Add channels in Settings")));
}

function algorithmEmpty(res) {
  contentEl.className = "";
  const signedOut = res?.code === "SIGNED_OUT" || res?.signedIn === false;
  setChildren(
    contentEl,
    h("div", { class: "empty" },
      h("h2", null, signedOut ? "Sign in to YouTube" : "No recommendations yet"),
      h("p", null, signedOut
        ? "Open youtube.com in this browser profile and sign in, then come back and Sync / Refresh. Algorithm scrapes your Home feed into cards here — it does not open YouTube Home."
        : String(res?.error || "Couldn't load Home recommendations. Try Refresh.")),
      h("button", { type: "button", class: "btn btn-primary", id: "algoRetry" }, "↻ Sync / Refresh"))
  );
  contentEl.querySelector("#algoRetry")?.addEventListener("click", () => loadAlgorithm(true));
}

function renderVideos(videos) {
  if (!videos.length) {
    emptyState();
    return;
  }
  contentEl.className = "grid";
  contentEl.replaceChildren();
  currentVideos = videos;
  updateSortControl();
  const mode = currentSort();
  const ordered =
    ((mode === "popular" || mode === "unpopular") && !videos.some((v) => v.views != null)) ||
    ((mode === "longest" || mode === "shortest") && !videos.some((v) => durationSeconds(v.duration) != null))
      ? videos
      : sortVideos(videos, mode);
  for (const v of ordered) {
    const a = document.createElement("a");
    a.className = "card";
    a.dataset.vid = v.id;
    a.href = v.link || `https://www.youtube.com/watch?v=${v.id}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.append(
      h("div", { class: "card-thumb" },
        h("img", { src: v.thumbnail, alt: "", loading: "lazy" }),
        h("span", { class: "duration", dataset: { vid: String(v.id ?? "") } }, v.duration ? formatDuration(v.duration) : "…")),
      h("div", { class: "card-body" },
        h("h3", { class: "card-title" }, String(v.title ?? "")),
        h("div", { class: "card-meta" },
          h("span", null, String(v.author || "")),
          h("span", { class: "views", dataset: { vid: String(v.id ?? "") } }, String(formatViews(v.views) ?? "")),
          h("span", null, String(formatCardPublished(v) ?? ""))))
    );
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
    let gotDurations = false;
    for (const [id, sec] of Object.entries(durations)) {
      if (sec) {
        const v = currentVideos.find((x) => x.id === id);
        if (v && durationSeconds(v.duration) == null) {
          v.duration = sec;
          gotDurations = true;
        }
      }
      contentEl.querySelectorAll(`.duration[data-vid="${CSS.escape(id)}"]`).forEach((el) => {
        if (sec) el.textContent = formatDuration(sec);
        else el.hidden = true; // live/unknown: hide, don't destroy
      });
    }
    if (gotDurations) {
      updateSortControl();
      if (/longest|shortest/.test(currentSort())) applySort();
    }
  }
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
    setChildren(contentEl, h("div", { class: "empty" },
      h("h2", null, "All channels disabled"),
      h("p", null, "Enable at least one channel for this feed in Settings."),
      h("a", { class: "btn btn-primary", href: "options.html", target: "_blank", rel: "noopener" }, "Open Settings")));
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
    setChildren(
      errorsEl,
      h("details", { open: true },
        h("summary", null, `${res.errors.length} channel(s) failed`),
        h("ul", null, res.errors.map((e) => h("li", null, h("strong", null, String(e.channel ?? "")), ": ", String(e.error ?? "")))))
    );
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
    setChildren(errorsEl, h("details", { open: true }, h("summary", null, "Using cached results"), h("p", null, String(res.warning))));
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
  setChildren(contentEl, h("div", { class: "empty" },
      h("h2", null, "Playlists load after sync"),
      h("p", null, "No playlists stored yet. In Settings you can sync from YouTube (uses your browser's YouTube login), paste a playlist URL, or import a JSON list."),
      h("a", { class: "btn btn-primary", href: "options.html#playlists", target: "_blank", rel: "noopener" }, "Manage playlists in Settings")));
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
      setChildren(contentEl, h("div", { class: "empty" },
      h("h2", null, "All playlists disabled"),
      h("p", null, "Enable playlists in Settings to browse them here."),
      h("a", { class: "btn btn-primary", href: "options.html#playlists", target: "_blank", rel: "noopener" }, "Open Settings")));
      return;
    }
    return playlistEmpty();
  }
  contentEl.className = "grid playlist-grid";
  contentEl.replaceChildren();
  for (const p of list) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card playlist-card";
    const thumbUrl = p.thumbnail || "";
    const countLabel = formatVideoCount(p.videoCount) || "Playlist";
    card.append(
      h("div", { class: "card-thumb pl-thumb" },
        h("div", { class: "pl-stack", "aria-hidden": "true" }, h("span", { class: "pl-stack-layer" }), h("span", { class: "pl-stack-layer" })),
        thumbUrl ? h("img", { src: thumbUrl, alt: "", loading: "lazy" }) : h("div", { class: "pl-placeholder" }, "📂"),
        h("div", { class: "pl-count-badge" },
          svgPath("M22 7H2v1h20V7zm-9 5H2v1h11v-1zm0 5H2v1h11v-1zm7-5v7l5-3.5L20 12z"),
          h("span", null, String(countLabel)))),
      h("div", { class: "card-body" },
        h("h3", { class: "card-title" }, String(p.name ?? "")),
        h("div", { class: "card-meta" },
          h("span", null, "View full playlist"),
          p.source && p.source !== "manual" ? h("span", { class: "pl-privacy" }, String(p.source)) : null))
    );
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
  header.append(
    h("button", { type: "button", class: "btn", id: "plBack" }, "← All playlists"),
    h("strong", null, String(p.name || res.title || "Playlist")),
    h("a", { class: "btn", href: safeUrl(p.url) || `https://www.youtube.com/playlist?list=${encodeURIComponent(p.playlistId)}`, target: "_blank", rel: "noopener noreferrer" }, "Open on YouTube ↗")
  );
  header.querySelector("#plBack").addEventListener("click", () => {
    state.playlist = null;
    loadPlaylists();
  });

  if (!res.ok) {
    contentEl.className = "";
    setChildren(contentEl, h("div", { class: "empty" }, h("h2", null, "Couldn't load this playlist"), h("p", null, String(res.error ?? ""))));
    contentEl.prepend(header);
    statusEl.textContent = "";
    return;
  }

  const videos = res.videos || [];
  if (!videos.length) {
    contentEl.className = "";
    setChildren(contentEl, h("div", { class: "empty" }, h("h2", null, "No public videos in RSS"), h("p", null, "Private/auto playlists (Liked, Watch later) or empty playlists don't expose a feed. Open it on YouTube instead.")));
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

async function loadCuratedList() {
  const res = await send({ type: "GET_CURATED_FEEDS" });
  state.curated = res.ok ? res.feeds || [] : [];
  const valid = [...state.curated.map((f) => f.id), ALGORITHM_ID, PLAYLISTS_ID];
  if (!valid.includes(state.feedId)) {
    state.feedId = state.curated[0]?.id || ALGORITHM_ID;
    localStorage.setItem("yfn.activeFeed", state.feedId);
    return true;
  }
  return false;
}

// Re-render tabs when feeds are created/renamed/deleted in Settings
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.feedList) return;
  loadCuratedList().then((switched) => {
    renderTabs();
    if (switched) loadCurrent();
  });
});

initShortsToggle();
Promise.all([loadCuratedList(), chrome.storage.local.get("feedSort")]).then(([, r]) => {
  sortPrefs = r.feedSort || {};
  renderTabs();
  loadCurrent();
});
